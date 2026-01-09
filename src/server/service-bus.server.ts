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
import { Logger } from '@nestjs/common';

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
import { ServiceBusConnectionError } from '../errors';

/**
 * Events emitted by the server
 */
export interface ServiceBusServerEvents {
  error: (err: Error) => void;
  connected: () => void;
  disconnected: () => void;
}

/**
 * NestJS microservice server for Azure Service Bus
 * Supports multiple subscriptions, sessions, and dead-letter queue handling
 *
 * Follows NestJS microservices conventions (aligned with ServerRMQ patterns)
 */
export class ServiceBusServer extends Server implements CustomTransportStrategy {
  public readonly transportId = SERVICE_BUS_TRANSPORT;

  protected readonly serviceBusSerializer: ServiceBusSerializer;
  protected readonly serviceBusDeserializer: ServiceBusDeserializer;
  protected status: ServiceBusServerStatus = ServiceBusServerStatus.DISCONNECTED;

  private client: AzureServiceBusClient | null = null;
  private readonly subscriptionManagers = new Map<string, SubscriptionManager>();
  private readonly eventListeners = new Map<string, Set<(...args: any[]) => void>>();
  private readonly serverLogger = new Logger(ServiceBusServer.name);

  constructor(private readonly options: ServiceBusServerOptions) {
    super();

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

    this.status = ServiceBusServerStatus.DISCONNECTED;
    this.emitEvent('disconnected');
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
    // Check if it's a NestJS message
    if (!this.serviceBusDeserializer.isNestJsMessage(message)) {
      this.serverLogger.warn('Received non-NestJS message, skipping');
      // Complete non-NestJS messages to prevent re-delivery
      try {
        await receiver.completeMessage(message);
      } catch {
        // Ignore settlement errors for non-NestJS messages
      }
      return;
    }

    // Check if it's a response (shouldn't happen on server, but just in case)
    if (this.serviceBusDeserializer.isResponseMessage(message)) {
      this.serverLogger.warn('Received response message on server, skipping');
      try {
        await receiver.completeMessage(message);
      } catch {
        // Ignore
      }
      return;
    }

    // Deserialize the message
    const packet = this.serviceBusDeserializer.deserialize(message) as IncomingPacket;
    const pattern = packet.pattern;

    // Create context
    const ctx = new ServiceBusContext({
      message,
      receiver,
      topic: config.topic,
      subscription: config.subscription,
      isDeadLetter,
    });

    // Check if this is an event (no correlation ID) - handle differently
    if (!packet.id) {
      return this.handleEventMessage(pattern, packet, ctx, receiver, config);
    }

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
      } catch {
        // Ignore
      }
      return;
    }

    // Handle request-response
    await this.handleRequestResponse(packet, ctx, handler, message.replyTo, receiver, config);
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
      } catch {
        // Ignore
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
