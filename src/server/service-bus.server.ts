import {
  ServiceBusClient as AzureServiceBusClient,
  ServiceBusReceiver,
  ServiceBusSessionReceiver,
  ServiceBusReceivedMessage,
  ProcessErrorArgs,
} from '@azure/service-bus';
import { Server, CustomTransportStrategy } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { Observable, isObservable, of, lastValueFrom } from 'rxjs';

import { SERVICE_BUS_TRANSPORT, SERVICE_BUS_DEFAULTS, ServiceBusServerStatus } from '../constants';
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
interface ServiceBusServerEvents {
  error: (err: Error) => void;
  connected: () => void;
  disconnected: () => void;
}

/**
 * NestJS microservice server for Azure Service Bus
 * Supports multiple subscriptions, sessions, and dead-letter queue handling
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

    // Initialize serializers
    this.serviceBusSerializer =
      (this.options.serializer as ServiceBusSerializer) ?? createServiceBusSerializer();
    this.serviceBusDeserializer =
      (this.options.deserializer as ServiceBusDeserializer) ?? createServiceBusDeserializer();

    // Set NestJS serializers for compatibility
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
      this.emit('connected');

      callback();
    } catch (error) {
      this.status = ServiceBusServerStatus.DISCONNECTED;
      this.emit('error', wrapError(error));
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
    this.emit('disconnected');
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
   * Emits an event to registered listeners
   */
  private emit<EventKey extends keyof ServiceBusServerEvents>(
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
    if (this.options.connectionString) {
      this.client = new AzureServiceBusClient(
        this.options.connectionString,
        this.options.clientOptions,
      );
    } else if (this.options.fullyQualifiedNamespace && this.options.credential) {
      this.client = new AzureServiceBusClient(
        this.options.fullyQualifiedNamespace,
        this.options.credential,
        this.options.clientOptions,
      );
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
    const startPromises = this.options.subscriptions.map((config) =>
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

    const manager = new SubscriptionManager(
      this.client!,
      {
        topic: config.topic,
        subscription: config.subscription,
        sessionEnabled: config.sessionEnabled ?? this.options.sessionEnabled ?? false,
        receiveMode:
          config.receiveMode ?? this.options.receiveMode ?? SERVICE_BUS_DEFAULTS.RECEIVE_MODE,
        maxConcurrentCalls:
          config.maxConcurrentCalls ??
          this.options.maxConcurrentCalls ??
          SERVICE_BUS_DEFAULTS.MAX_CONCURRENT_CALLS,
        maxConcurrentSessions:
          config.maxConcurrentSessions ??
          this.options.maxConcurrentSessions ??
          SERVICE_BUS_DEFAULTS.MAX_CONCURRENT_SESSIONS,
        sessionIdleTimeoutMs:
          config.sessionIdleTimeoutMs ??
          this.options.sessionIdleTimeoutMs ??
          SERVICE_BUS_DEFAULTS.SESSION_IDLE_TIMEOUT_MS,
        handleDeadLetter: config.handleDeadLetter ?? false,
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

    // Find the handler for this pattern
    const handler = this.getHandlerByPattern(pattern);

    if (!handler) {
      this.serverLogger.warn(`No handler found for pattern: ${pattern}`);
      // Complete messages with no handler to prevent re-delivery
      try {
        await receiver.completeMessage(message);
      } catch {
        // Ignore
      }
      return;
    }

    // Create context
    const ctx = new ServiceBusContext({
      message,
      receiver,
      topic: config.topic,
      subscription: config.subscription,
      isDeadLetter,
    });

    // Determine auto-complete/dead-letter settings
    const autoComplete =
      config.autoComplete ?? this.options.autoComplete ?? SERVICE_BUS_DEFAULTS.AUTO_COMPLETE;
    const autoDeadLetter =
      config.autoDeadLetter ?? this.options.autoDeadLetter ?? SERVICE_BUS_DEFAULTS.AUTO_DEAD_LETTER;

    try {
      // Check if this is an event handler (no response expected)
      if (handler.isEventHandler) {
        await this.handleEventMessage(pattern, packet, ctx);
      } else {
        // Request-response pattern
        await this.handleRequestResponse(packet, ctx, handler, message.replyTo);
      }

      // Auto-complete if enabled and not already settled
      if (autoComplete && !ctx.isSettled()) {
        await ctx.complete();
      }
    } catch (error) {
      this.serverLogger.error(`Error handling message: ${(error as Error).message}`);

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
   * Handles event messages (fire-and-forget)
   */
  private async handleEventMessage(
    pattern: string,
    packet: IncomingPacket,
    ctx: ServiceBusContext,
  ): Promise<void> {
    await this.handleEvent(pattern, packet, ctx);
  }

  /**
   * Handles request-response pattern
   */
  private async handleRequestResponse(
    packet: IncomingPacket,
    ctx: ServiceBusContext,
    handler: { (data: any, ctx?: any): Promise<any> },
    replyTo?: string,
  ): Promise<void> {
    // Get result from handler
    const result = await handler(packet.data, ctx);

    // If there's a replyTo address and a correlation ID, send response
    if (replyTo && packet.id) {
      const response$ = this.transformResultToObservable(result);
      await this.sendResponse(response$, replyTo, packet.id);
    }
  }

  /**
   * Transforms a result to an Observable
   */
  protected transformResultToObservable<T>(result: T | Promise<T> | Observable<T>): Observable<T> {
    if (isObservable(result)) {
      return result;
    }
    if (result instanceof Promise) {
      return new Observable((subscriber) => {
        result
          .then((value) => {
            subscriber.next(value);
            subscriber.complete();
          })
          .catch((err) => subscriber.error(err));
      });
    }
    return of(result);
  }

  /**
   * Sends a response back to the client
   */
  private async sendResponse(
    response$: Observable<any>,
    replyTo: string,
    correlationId: string,
  ): Promise<void> {
    // Parse reply topic from replyTo
    // Expected format: topic/subscriptions/subscription or just topic
    const parts = replyTo.split('/subscriptions/');
    const replyTopic = parts[0];

    if (!replyTopic) {
      this.serverLogger.warn(`Invalid replyTo format: ${replyTo}`);
      return;
    }

    // Create sender for reply topic
    const sender = this.client!.createSender(replyTopic);

    try {
      let lastValue: any;
      let hasError = false;
      let error: any;

      // Collect response values
      try {
        lastValue = await lastValueFrom(response$);
      } catch (err) {
        hasError = true;
        error = err;
      }

      // Serialize and send response
      const responseMessage = this.serviceBusSerializer.serialize({
        id: correlationId,
        response: hasError ? undefined : lastValue,
        err: hasError ? error : undefined,
        isDisposed: true,
      });

      await sender.sendMessages(responseMessage);
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

    this.emit(
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
