import {
  ServiceBusClient as AzureServiceBusClient,
  ServiceBusReceiver,
  ServiceBusSessionReceiver,
  ServiceBusReceivedMessage,
  ProcessErrorArgs,
} from '@azure/service-bus';
import {
  Server,
  CustomTransportStrategy,
  WritePacket,
  MessageHandler,
} from '@nestjs/microservices';
import { Logger, OnApplicationShutdown } from '@nestjs/common';

import {
  SERVICE_BUS_TRANSPORT,
  SERVICE_BUS_DEFAULTS,
  ServiceBusServerStatus,
  NO_MESSAGE_HANDLER,
} from '../constants';
import type { ServiceBusServerOptions, SubscriptionConfig, IncomingPacket } from '../interfaces';
import { ServiceBusContext } from './service-bus.context';
import { SubscriptionManager } from './subscription-manager';
import {
  ServiceBusSerializer,
  createServiceBusSerializer,
} from '../serializers/service-bus.serializer';
import {
  ServiceBusDeserializer,
  createServiceBusDeserializer,
} from '../serializers/service-bus.deserializer';
import { wrapError } from '../utils/error.utils';
import { createSubscriptionKey } from '../utils/pattern.utils';
import { ConnectionManager, CircuitState } from '../utils/connection-manager';
import { ServiceBusConnectionError } from '../errors';
import { ServiceBusMetricsService } from '../observability/metrics.service';
import { ServiceBusTracingService } from '../observability/tracing.service';
import { validateServerOptions } from '../utils/validation.utils';

/**
 * Events emitted by the server
 */
export interface ServiceBusServerEvents {
  error: (err: Error) => void;
  connected: () => void;
  disconnected: () => void;
  reconnecting: () => void;
}

/**
 * NestJS microservice server for Azure Service Bus
 * Supports multiple subscriptions, sessions, and dead-letter queue handling
 *
 * Follows NestJS microservices conventions (aligned with ServerRMQ patterns)
 */
export class ServiceBusServer
  extends Server
  implements CustomTransportStrategy, OnApplicationShutdown
{
  public readonly transportId = SERVICE_BUS_TRANSPORT;

  protected readonly serviceBusSerializer: ServiceBusSerializer;
  protected readonly serviceBusDeserializer: ServiceBusDeserializer;
  protected status: ServiceBusServerStatus = ServiceBusServerStatus.DISCONNECTED;

  private client: AzureServiceBusClient | null = null;
  private readonly subscriptionManagers = new Map<string, SubscriptionManager>();
  private readonly eventListeners = new Map<string, Set<(...args: any[]) => void>>();
  private readonly serverLogger = new Logger(ServiceBusServer.name);
  private readonly connectionManager: ConnectionManager;
  private readonly metricsService: ServiceBusMetricsService | null = null;
  private readonly tracingService: ServiceBusTracingService | null = null;
  private inFlightCount = 0;
  private isShuttingDown = false;

  constructor(private readonly options: ServiceBusServerOptions) {
    super();

    // Validate options early to fail fast with helpful error messages
    validateServerOptions(options);

    // Initialize connection manager for resilience
    this.connectionManager = new ConnectionManager({
      name: 'ServiceBusServer',
      reconnect: this.options.reconnect,
      circuitBreaker: this.options.circuitBreaker,
    });

    // Forward connection manager events
    this.setupConnectionManagerEvents();

    // Initialize observability services if configured
    const observability = this.getOptionsProp(this.options, 'observability');
    if (observability) {
      if (observability.metrics) {
        this.metricsService = new ServiceBusMetricsService(observability.metrics);
      }
      if (observability.tracing) {
        this.tracingService = new ServiceBusTracingService(observability.tracing);
      }
    }

    // Initialize Service Bus specific serializers
    this.serviceBusSerializer =
      (this.getOptionsProp(this.options, 'serializer') as ServiceBusSerializer) ??
      createServiceBusSerializer();
    this.serviceBusDeserializer =
      (this.getOptionsProp(this.options, 'deserializer') as ServiceBusDeserializer) ??
      createServiceBusDeserializer();

    // Set NestJS base class serializers for compatibility
    this.initializeSerializer(this.options);
    this.initializeDeserializer(this.options);
  }

  /**
   * Sets up event forwarding from connection manager
   */
  private setupConnectionManagerEvents(): void {
    this.connectionManager.on('reconnect:start', () => {
      this.status = ServiceBusServerStatus.RECONNECTING;
      this.emitEvent('reconnecting');
    });

    this.connectionManager.on('reconnect:success', () => {
      this.status = ServiceBusServerStatus.CONNECTED;
      this.emitEvent('connected');
    });

    this.connectionManager.on('reconnect:failed', (error) => {
      this.emitEvent('error', error);
    });

    this.connectionManager.on('reconnect:exhausted', () => {
      this.status = ServiceBusServerStatus.DISCONNECTED;
      this.emitEvent('disconnected');
    });

    this.connectionManager.on('circuit:open', () => {
      this.serverLogger.warn('Circuit breaker opened - message processing may be affected');
    });

    this.connectionManager.on('circuit:close', () => {
      this.serverLogger.log('Circuit breaker closed - normal operation resumed');
    });
  }

  /**
   * Starts the server and begins listening for messages
   */
  async listen(callback: () => void): Promise<void> {
    try {
      this.status = ServiceBusServerStatus.CONNECTING;

      // Create Azure Service Bus client
      await this.createClient();

      // Start subscription managers
      await this.startSubscriptionManagers();

      this.status = ServiceBusServerStatus.CONNECTED;
      this.metricsService?.updateConnectionStatus(true);
      this.emitEvent('connected');

      callback();
    } catch (error) {
      this.status = ServiceBusServerStatus.DISCONNECTED;
      this.emitEvent('error', wrapError(error));
      throw error;
    }
  }

  /**
   * Stops the server and closes all connections
   */
  async close(): Promise<void> {
    this.status = ServiceBusServerStatus.CLOSING;

    // Cancel any ongoing reconnection
    this.connectionManager.cancelReconnect();

    // Stop all subscription managers
    const stopPromises = Array.from(this.subscriptionManagers.values()).map((manager) =>
      manager.stop().catch((err) => {
        this.serverLogger.warn(`Error stopping subscription manager: ${err.message}`);
      }),
    );
    await Promise.all(stopPromises);
    this.subscriptionManagers.clear();

    // Close the client
    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    // Cleanup connection manager
    this.connectionManager.destroy();

    this.status = ServiceBusServerStatus.DISCONNECTED;
    this.metricsService?.updateConnectionStatus(false);
    this.emitEvent('disconnected');

    // Clear event listeners AFTER emitting disconnected to prevent memory leaks
    this.eventListeners.clear();
  }

  /**
   * Called by NestJS when the application is shutting down
   * Implements OnApplicationShutdown for proper lifecycle management
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.serverLogger.log(`Received shutdown signal: ${signal || 'unknown'}`);
    await this.gracefulClose();
  }

  /**
   * Gracefully closes the server with drain period
   * 1. Stops accepting new messages
   * 2. Waits for in-flight messages to complete
   * 3. Closes all resources
   */
  async gracefulClose(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.serverLogger.log('Starting graceful shutdown...');

    const drainTimeout =
      this.getOptionsProp(this.options, 'drainTimeoutMs') ??
      SERVICE_BUS_DEFAULTS.SHUTDOWN.DRAIN_TIMEOUT_MS;
    const gracePeriod =
      this.getOptionsProp(this.options, 'gracePeriodMs') ??
      SERVICE_BUS_DEFAULTS.SHUTDOWN.GRACE_PERIOD_MS;

    // Step 1: Stop all subscription managers to prevent new messages
    // This must happen FIRST to prevent an indefinite shutdown
    this.serverLogger.log('Stopping subscription managers...');
    const stopPromises = Array.from(this.subscriptionManagers.values()).map((manager) =>
      manager.stop().catch((err) => {
        this.serverLogger.warn(
          `Error stopping subscription manager during shutdown: ${err.message}`,
        );
      }),
    );
    await Promise.all(stopPromises);
    this.subscriptionManagers.clear();
    this.serverLogger.log('Subscription managers stopped');

    // Step 2: Wait for in-flight messages to complete (with timeout)
    if (this.inFlightCount > 0) {
      this.serverLogger.log(`Waiting for ${this.inFlightCount} in-flight messages to complete...`);

      const drainStart = Date.now();
      while (this.inFlightCount > 0 && Date.now() - drainStart < drainTimeout) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (this.inFlightCount > 0) {
        this.serverLogger.warn(
          `Drain timeout reached with ${this.inFlightCount} messages still in-flight`,
        );
      } else {
        this.serverLogger.log('All in-flight messages completed');
      }
    }

    // Step 3: Grace period before final cleanup
    if (gracePeriod > 0) {
      this.serverLogger.log(`Waiting ${gracePeriod}ms grace period...`);
      await new Promise((resolve) => setTimeout(resolve, gracePeriod));
    }

    // Step 4: Close remaining resources (client, connection manager)
    // Note: Subscription managers already stopped above, so close() will skip them
    await this.closeResources();
    this.serverLogger.log('Graceful shutdown complete');
  }

  /**
   * Closes remaining resources after subscriptions are stopped
   * Used by gracefulClose to avoid re-stopping subscriptions
   */
  private async closeResources(): Promise<void> {
    this.status = ServiceBusServerStatus.CLOSING;

    // Cancel any ongoing reconnection
    this.connectionManager.cancelReconnect();

    // Close the client
    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    // Cleanup connection manager
    this.connectionManager.destroy();

    this.status = ServiceBusServerStatus.DISCONNECTED;
    this.metricsService?.updateConnectionStatus(false);
    this.emitEvent('disconnected');

    // Clear event listeners AFTER emitting disconnected to prevent memory leaks
    this.eventListeners.clear();
  }

  /**
   * Increments the in-flight message count
   * Called when starting to process a message
   */
  private startProcessing(): void {
    this.inFlightCount++;
  }

  /**
   * Decrements the in-flight message count
   * Called when finished processing a message
   */
  private endProcessing(): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
  }

  /**
   * Gets the current in-flight message count
   */
  getInFlightCount(): number {
    return this.inFlightCount;
  }

  /**
   * Gets the current circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.connectionManager.getCircuitState();
  }

  /**
   * Manually resets the circuit breaker
   */
  resetCircuit(): void {
    this.connectionManager.resetCircuit();
  }

  /**
   * Returns the underlying Azure Service Bus client
   */
  getClient(): AzureServiceBusClient {
    if (!this.client) {
      throw new ServiceBusConnectionError('Client not initialized. Call listen() first.');
    }
    return this.client;
  }

  /**
   * Gets the current connection status
   */
  getStatus(): ServiceBusServerStatus {
    return this.status;
  }

  /**
   * Registers event listeners on the server
   */
  on<EventKey extends keyof ServiceBusServerEvents>(
    event: EventKey,
    callback: ServiceBusServerEvents[EventKey],
  ): this {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
    return this;
  }

  /**
   * Removes an event listener
   */
  off<EventKey extends keyof ServiceBusServerEvents>(
    event: EventKey,
    callback: ServiceBusServerEvents[EventKey],
  ): this {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
    return this;
  }

  /**
   * Emits an event to registered listeners
   */
  private emitEvent<EventKey extends keyof ServiceBusServerEvents>(
    event: EventKey,
    ...args: Parameters<ServiceBusServerEvents[EventKey]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (err) {
          this.serverLogger.error(`Error in event listener: ${(err as Error).message}`);
        }
      });
    }
  }

  /**
   * Creates the Azure Service Bus client
   */
  private async createClient(): Promise<void> {
    const connectionString = this.getOptionsProp(this.options, 'connectionString');
    const fullyQualifiedNamespace = this.getOptionsProp(this.options, 'fullyQualifiedNamespace');
    const credential = this.getOptionsProp(this.options, 'credential');
    const clientOptions = this.getOptionsProp(this.options, 'clientOptions');

    if (connectionString) {
      this.client = new AzureServiceBusClient(connectionString, clientOptions);
    } else if (fullyQualifiedNamespace && credential) {
      this.client = new AzureServiceBusClient(fullyQualifiedNamespace, credential, clientOptions);
    } else {
      throw new ServiceBusConnectionError(
        'Either connectionString or fullyQualifiedNamespace with credential is required',
      );
    }
  }

  /**
   * Starts subscription managers for all configured subscriptions
   */
  private async startSubscriptionManagers(): Promise<void> {
    const subscriptions = this.getOptionsProp(this.options, 'subscriptions') ?? [];
    const startPromises = subscriptions.map((config: SubscriptionConfig) =>
      this.startSubscriptionManager(config),
    );
    await Promise.all(startPromises);
  }

  /**
   * Starts a subscription manager for a single subscription
   */
  private async startSubscriptionManager(config: SubscriptionConfig): Promise<void> {
    const key = createSubscriptionKey(config.topic, config.subscription);

    if (this.subscriptionManagers.has(key)) {
      this.serverLogger.warn(`Subscription manager already exists for ${key}`);
      return;
    }

    // Use getOptionsProp for all option extraction (NestJS convention)
    const sessionEnabled =
      this.getOptionsProp(config, 'sessionEnabled') ??
      this.getOptionsProp(this.options, 'sessionEnabled') ??
      false;
    const receiveMode =
      this.getOptionsProp(config, 'receiveMode') ??
      this.getOptionsProp(this.options, 'receiveMode') ??
      SERVICE_BUS_DEFAULTS.RECEIVE_MODE;
    const maxConcurrentCalls =
      this.getOptionsProp(config, 'maxConcurrentCalls') ??
      this.getOptionsProp(this.options, 'maxConcurrentCalls') ??
      SERVICE_BUS_DEFAULTS.MAX_CONCURRENT_CALLS;
    const maxConcurrentSessions =
      this.getOptionsProp(config, 'maxConcurrentSessions') ??
      this.getOptionsProp(this.options, 'maxConcurrentSessions') ??
      SERVICE_BUS_DEFAULTS.MAX_CONCURRENT_SESSIONS;
    const sessionIdleTimeoutMs =
      this.getOptionsProp(config, 'sessionIdleTimeoutMs') ??
      this.getOptionsProp(this.options, 'sessionIdleTimeoutMs') ??
      SERVICE_BUS_DEFAULTS.SESSION_IDLE_TIMEOUT_MS;
    const handleDeadLetter = this.getOptionsProp(config, 'handleDeadLetter') ?? false;

    const manager = new SubscriptionManager(
      this.client!,
      {
        topic: config.topic,
        subscription: config.subscription,
        sessionEnabled,
        receiveMode,
        maxConcurrentCalls,
        maxConcurrentSessions,
        sessionIdleTimeoutMs,
        handleDeadLetter,
      },
      (message, receiver, isDeadLetter) =>
        this.handleMessage(message, receiver, config, isDeadLetter),
      (args) => this.handleSubscriptionError(args, config),
    );

    this.subscriptionManagers.set(key, manager);
    await manager.start();
  }

  /**
   * Handles an incoming message
   * Follows NestJS ServerRMQ message handling pattern
   */
  private async handleMessage(
    message: ServiceBusReceivedMessage,
    receiver: ServiceBusReceiver | ServiceBusSessionReceiver,
    config: SubscriptionConfig,
    isDeadLetter: boolean,
  ): Promise<void> {
    // Skip processing if shutting down
    if (this.isShuttingDown) {
      this.serverLogger.debug('Skipping message processing during shutdown');
      return;
    }

    // Track in-flight messages for graceful shutdown
    this.startProcessing();

    try {
      await this.processMessage(message, receiver, config, isDeadLetter);
      // Record success for circuit breaker
      this.connectionManager.recordSuccess();
    } catch (error) {
      // Record failure for circuit breaker
      this.connectionManager.recordFailure(error as Error);
      throw error;
    } finally {
      this.endProcessing();
    }
  }

  /**
   * Internal message processing logic
   */
  private async processMessage(
    message: ServiceBusReceivedMessage,
    receiver: ServiceBusReceiver | ServiceBusSessionReceiver,
    config: SubscriptionConfig,
    isDeadLetter: boolean,
  ): Promise<void> {
    // Check if it's a NestJS message
    if (!this.serviceBusDeserializer.isNestJsMessage(message)) {
      this.serverLogger.warn('Received non-NestJS message, skipping');
      // Complete non-NestJS messages to prevent re-delivery
      try {
        await receiver.completeMessage(message);
      } catch (err) {
        this.serverLogger.debug(`Failed to complete non-NestJS message: ${(err as Error).message}`);
      }
      return;
    }

    // Check if it's a response (shouldn't happen on server, but just in case)
    if (this.serviceBusDeserializer.isResponseMessage(message)) {
      this.serverLogger.warn('Received response message on server, skipping');
      try {
        await receiver.completeMessage(message);
      } catch (err) {
        this.serverLogger.debug(`Failed to complete response message: ${(err as Error).message}`);
      }
      return;
    }

    // Deserialize the message
    const packet = this.serviceBusDeserializer.deserialize(message) as IncomingPacket;
    const pattern = packet.pattern;
    const patternStr = typeof pattern === 'string' ? pattern : JSON.stringify(pattern);

    // Record message received
    this.metricsService?.recordMessageReceived(config.topic, config.subscription, patternStr);

    // Extract trace context and start processing span
    const parentContext = this.tracingService?.extractContext(message);
    const span =
      this.tracingService?.startProcessSpan(
        patternStr,
        config.topic,
        config.subscription,
        parentContext,
      ) ?? null;
    const startTime = Date.now();

    // Create context with observability hooks
    const ctx = new ServiceBusContext({
      message,
      receiver,
      topic: config.topic,
      subscription: config.subscription,
      isDeadLetter,
    });

    try {
      // Check if this is an event (no correlation ID) - handle differently
      if (!packet.id) {
        await this.handleEventMessage(pattern, packet, ctx, receiver, config);
      } else {
        // Request-response pattern - find handler
        const handler = this.getHandlerByPattern(pattern);

        if (!handler) {
          // NestJS convention: send error response to client when no handler found
          this.serverLogger.warn(`No handler found for pattern: ${pattern}`);

          // Send error response back to client (if replyTo is specified)
          if (message.replyTo) {
            const noHandlerPacket: WritePacket = {
              err: NO_MESSAGE_HANDLER,
              response: undefined,
              isDisposed: true,
            };
            await this.sendMessage(noHandlerPacket, message.replyTo, packet.id);
          }

          // Complete message to prevent redelivery
          try {
            await receiver.completeMessage(message);
          } catch (err) {
            this.serverLogger.debug(
              `Failed to complete no-handler message: ${(err as Error).message}`,
            );
          }
        } else {
          // Handle request-response
          await this.handleRequestResponse(packet, ctx, handler, message.replyTo, receiver, config);
        }
      }

      // Record success metrics
      this.metricsService?.recordHandleLatency(
        Date.now() - startTime,
        config.topic,
        config.subscription,
      );
      if (ctx.isSettled()) {
        this.metricsService?.recordMessageCompleted(config.topic, config.subscription);
      }
      this.tracingService?.endSpan(span);
    } catch (error) {
      // Record failure metrics
      this.metricsService?.recordMessageFailed(
        config.topic,
        config.subscription,
        (error as Error).name,
      );
      this.metricsService?.recordHandleLatency(
        Date.now() - startTime,
        config.topic,
        config.subscription,
      );
      this.tracingService?.endSpan(span, error as Error);
      throw error;
    }
  }

  /**
   * Handles event messages (fire-and-forget)
   * Follows NestJS Server.handleEvent() convention with NACK behavior for no handler
   */
  private async handleEventMessage(
    pattern: string,
    packet: IncomingPacket,
    ctx: ServiceBusContext,
    receiver: ServiceBusReceiver | ServiceBusSessionReceiver,
    config: SubscriptionConfig,
  ): Promise<void> {
    const handler = this.getHandlerByPattern(pattern);

    // NestJS convention: if no handler for event, log warning and complete/abandon
    if (!handler) {
      this.serverLogger.warn(`No event handler found for pattern: ${pattern}`);
      // Complete to prevent redelivery (unlike RMQ NACK, Service Bus doesn't have same semantics)
      try {
        await receiver.completeMessage(ctx.getMessage());
      } catch (err) {
        this.serverLogger.debug(
          `Failed to complete no-event-handler message: ${(err as Error).message}`,
        );
      }
      return;
    }

    // Determine auto-complete settings
    const autoComplete =
      this.getOptionsProp(config, 'autoComplete') ??
      this.getOptionsProp(this.options, 'autoComplete') ??
      SERVICE_BUS_DEFAULTS.AUTO_COMPLETE;
    const autoDeadLetter =
      this.getOptionsProp(config, 'autoDeadLetter') ??
      this.getOptionsProp(this.options, 'autoDeadLetter') ??
      SERVICE_BUS_DEFAULTS.AUTO_DEAD_LETTER;

    try {
      // Use base class handleEvent (NestJS convention)
      await this.handleEvent(pattern, packet, ctx);

      // Auto-complete if enabled and not already settled
      if (autoComplete && !ctx.isSettled()) {
        await ctx.complete();
      }
    } catch (error) {
      this.serverLogger.error(`Error handling event: ${(error as Error).message}`);

      // Auto dead-letter on error if enabled
      if (autoDeadLetter && !ctx.isSettled()) {
        try {
          await ctx.deadLetter({
            deadLetterReason: 'HandlerError',
            deadLetterErrorDescription: (error as Error).message,
          });
        } catch (dlError) {
          this.serverLogger.error(`Failed to dead-letter message: ${(dlError as Error).message}`);
        }
      }

      throw error;
    }
  }

  /**
   * Handles request-response pattern
   * Uses base class send() method for proper streaming support (NestJS convention)
   */
  private async handleRequestResponse(
    packet: IncomingPacket,
    ctx: ServiceBusContext,
    handler: MessageHandler,
    replyTo: string | undefined,
    _receiver: ServiceBusReceiver | ServiceBusSessionReceiver,
    config: SubscriptionConfig,
  ): Promise<void> {
    // Determine auto-complete settings
    const autoComplete =
      this.getOptionsProp(config, 'autoComplete') ??
      this.getOptionsProp(this.options, 'autoComplete') ??
      SERVICE_BUS_DEFAULTS.AUTO_COMPLETE;
    const autoDeadLetter =
      this.getOptionsProp(config, 'autoDeadLetter') ??
      this.getOptionsProp(this.options, 'autoDeadLetter') ??
      SERVICE_BUS_DEFAULTS.AUTO_DEAD_LETTER;

    try {
      // Get result from handler
      const result = await handler(packet.data, ctx);

      // If there's a replyTo address and a correlation ID, send response
      if (replyTo && packet.id) {
        // Use base class transformToObservable (NestJS convention)
        const response$ = this.transformToObservable(result);

        // Use base class send() method with publish callback (NestJS convention)
        // This properly handles streaming multiple values
        const publish = async (data: WritePacket) => {
          await this.sendMessage(data, replyTo, packet.id!);
        };

        if (response$) {
          this.send(response$, publish);
        }
      }

      // Auto-complete if enabled and not already settled
      if (autoComplete && !ctx.isSettled()) {
        await ctx.complete();
      }
    } catch (error) {
      this.serverLogger.error(`Error handling message: ${(error as Error).message}`);

      // Send error response to client if replyTo exists
      if (replyTo && packet.id) {
        const errorPacket: WritePacket = {
          err: error,
          response: undefined,
          isDisposed: true,
        };
        try {
          await this.sendMessage(errorPacket, replyTo, packet.id);
        } catch (sendError) {
          this.serverLogger.error(`Failed to send error response: ${(sendError as Error).message}`);
        }
      }

      // Auto dead-letter on error if enabled
      if (autoDeadLetter && !ctx.isSettled()) {
        try {
          await ctx.deadLetter({
            deadLetterReason: 'HandlerError',
            deadLetterErrorDescription: (error as Error).message,
          });
        } catch (dlError) {
          this.serverLogger.error(`Failed to dead-letter message: ${(dlError as Error).message}`);
        }
      }

      throw error;
    }
  }

  /**
   * Sends a message to the reply topic
   * Follows NestJS ServerRMQ.sendMessage() pattern
   */
  private async sendMessage(
    message: WritePacket,
    replyTo: string,
    correlationId: string,
  ): Promise<void> {
    // Check if client is still connected
    if (!this.client) {
      this.serverLogger.warn('Cannot send message: client is not connected');
      return;
    }

    // Parse reply topic from replyTo
    // Expected format: topic/subscriptions/subscription or just topic
    const parts = replyTo.split('/subscriptions/');
    const replyTopic = parts[0];

    if (!replyTopic) {
      this.serverLogger.warn(`Invalid replyTo format: ${replyTo}`);
      return;
    }

    // Serialize outgoing response using base class serializer pattern
    const outgoingResponse = this.serviceBusSerializer.serialize({
      id: correlationId,
      response: message.response,
      err: message.err,
      isDisposed: message.isDisposed,
    });

    // Create sender for reply topic
    const sender = this.client.createSender(replyTopic);

    try {
      await sender.sendMessages(outgoingResponse);
    } finally {
      await sender.close();
    }
  }

  /**
   * Handles errors from the subscription
   */
  private async handleSubscriptionError(
    args: ProcessErrorArgs,
    config: SubscriptionConfig,
  ): Promise<void> {
    this.serverLogger.error(
      `Error from ${config.topic}/${config.subscription}: ${args.error.message}`,
      args.error.stack,
    );

    this.emitEvent(
      'error',
      wrapError(args.error, {
        topic: config.topic,
        subscription: config.subscription,
        errorSource: args.errorSource,
      }) as Error,
    );
  }

  /**
   * Gets subscription manager info for debugging
   */
  getSubscriptionManagersInfo(): Array<{
    topic: string;
    subscription: string;
    sessionEnabled: boolean;
    activeSessionCount?: number;
    handleDeadLetter: boolean;
  }> {
    return Array.from(this.subscriptionManagers.values()).map((manager) => manager.getInfo());
  }
}
