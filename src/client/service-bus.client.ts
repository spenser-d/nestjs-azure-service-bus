import {
  ServiceBusClient as AzureServiceBusClient,
  ServiceBusSender,
  ServiceBusReceivedMessage,
  ServiceBusMessageBatch,
  ServiceBusReceiver,
  ServiceBusSessionReceiver,
  ServiceBusRuleManager,
  CreateMessageBatchOptions,
} from '@azure/service-bus';
import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import Long from 'long';

import { SERVICE_BUS_DEFAULTS, ServiceBusClientStatus } from '../constants';
import type { ServiceBusClientOptions, SendMessageOptions } from '../interfaces';
import { ReplyQueueManager } from './reply-queue-manager';
import {
  ServiceBusSerializer,
  createServiceBusSerializer,
} from '../serializers/service-bus.serializer';
import {
  ServiceBusDeserializer,
  createServiceBusDeserializer,
} from '../serializers/service-bus.deserializer';
import { ServiceBusConnectionError } from '../errors';

/**
 * Generates a unique client ID for reply subscriptions
 */
function generateClientId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Events emitted by the client
 */
export interface ServiceBusClientEvents {
  connected: () => void;
  disconnected: (error?: Error) => void;
  reconnecting: () => void;
  error: (error: Error) => void;
}

/**
 * Options for peeking messages
 */
export interface PeekMessagesOptions {
  /**
   * Sequence number to start peeking from
   */
  fromSequenceNumber?: bigint;
  /**
   * Sub-queue type to peek from
   */
  subQueueType?: 'deadLetter' | 'transferDeadLetter';
}

/**
 * Options for receiving deferred messages
 */
export interface ReceiveDeferredMessagesOptions {
  /**
   * Session ID (required for session-enabled subscriptions)
   */
  sessionId?: string;
}

/**
 * NestJS microservice client for Azure Service Bus
 * Supports request-response and event patterns with full Azure Service Bus feature support
 *
 * Follows NestJS ClientProxy conventions (aligned with ClientRMQ patterns)
 */
export class ServiceBusClientProxy extends ClientProxy {
  protected readonly logger = new Logger(ServiceBusClientProxy.name);
  protected readonly serviceBusSerializer: ServiceBusSerializer;
  protected readonly serviceBusDeserializer: ServiceBusDeserializer;

  private client: AzureServiceBusClient | null = null;
  private senders = new Map<string, ServiceBusSender>();
  private replyQueueManager: ReplyQueueManager | null = null;
  private status: ServiceBusClientStatus = ServiceBusClientStatus.DISCONNECTED;
  private readonly clientId: string;
  private readonly eventListeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(private readonly options: ServiceBusClientOptions) {
    super();

    this.clientId = generateClientId();

    // Initialize serializers using getOptionsProp pattern (NestJS convention)
    this.serviceBusSerializer =
      (this.getOptionsProp(this.options, 'serializer') as ServiceBusSerializer) ??
      createServiceBusSerializer();
    this.serviceBusDeserializer =
      (this.getOptionsProp(this.options, 'deserializer') as ServiceBusDeserializer) ??
      createServiceBusDeserializer();

    // Set NestJS base class serializers
    this.initializeSerializer(this.options);
    this.initializeDeserializer(this.options);
  }

  // ============ CONNECTION MANAGEMENT ============

  /**
   * Connects to Azure Service Bus
   */
  async connect(): Promise<AzureServiceBusClient> {
    if (this.client) {
      return this.client;
    }

    this.status = ServiceBusClientStatus.CONNECTING;

    try {
      const connectionString = this.getOptionsProp(this.options, 'connectionString');
      const fullyQualifiedNamespace = this.getOptionsProp(this.options, 'fullyQualifiedNamespace');
      const credential = this.getOptionsProp(this.options, 'credential');
      const clientOptions = this.getOptionsProp(this.options, 'clientOptions');

      // Create Azure Service Bus client
      if (connectionString) {
        this.client = new AzureServiceBusClient(connectionString, clientOptions);
      } else if (fullyQualifiedNamespace && credential) {
        this.client = new AzureServiceBusClient(fullyQualifiedNamespace, credential, clientOptions);
      } else {
        throw new ServiceBusConnectionError(
          'Either connectionString or fullyQualifiedNamespace with credential is required',
        );
      }

      // Start reply queue manager for request-response pattern
      await this.startReplyQueueManager();

      this.status = ServiceBusClientStatus.CONNECTED;
      this.emitEvent('connected');
      this.logger.log('Connected to Azure Service Bus');

      return this.client;
    } catch (error) {
      this.status = ServiceBusClientStatus.DISCONNECTED;
      this.emitEvent('error', error as Error);
      this.emitEvent('disconnected', error as Error);
      throw error;
    }
  }

  /**
   * Closes all connections
   */
  async close(): Promise<void> {
    this.status = ServiceBusClientStatus.CLOSING;

    // Stop reply queue manager
    if (this.replyQueueManager) {
      await this.replyQueueManager.stop();
      this.replyQueueManager = null;
    }

    // Close all senders
    const closePromises = Array.from(this.senders.values()).map((sender) =>
      sender.close().catch((err) => {
        this.logger.warn(`Error closing sender: ${err.message}`);
      }),
    );
    await Promise.all(closePromises);
    this.senders.clear();

    // Close client
    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    this.status = ServiceBusClientStatus.DISCONNECTED;
    this.emitEvent('disconnected');
    this.logger.log('Disconnected from Azure Service Bus');
  }

  /**
   * Gets the current connection status
   */
  getStatus(): ServiceBusClientStatus {
    return this.status;
  }

  /**
   * Returns the underlying Azure Service Bus client
   */
  getClient(): AzureServiceBusClient {
    if (!this.client) {
      throw new ServiceBusConnectionError('Client not connected. Call connect() first.');
    }
    return this.client;
  }

  // ============ EVENT EMITTER PATTERN ============

  /**
   * Registers an event listener
   */
  on<K extends keyof ServiceBusClientEvents>(event: K, callback: ServiceBusClientEvents[K]): this {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
    return this;
  }

  /**
   * Removes an event listener
   */
  off<K extends keyof ServiceBusClientEvents>(event: K, callback: ServiceBusClientEvents[K]): this {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
    return this;
  }

  /**
   * Emits an event to registered listeners
   */
  private emitEvent<K extends keyof ServiceBusClientEvents>(
    event: K,
    ...args: Parameters<ServiceBusClientEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (err) {
          this.logger.error(`Error in event listener: ${(err as Error).message}`);
        }
      });
    }
  }

  // ============ CORE MESSAGING ============

  /**
   * Implements the publish method for request-response pattern
   * Called by NestJS when using send()
   */
  protected publish(
    partialPacket: ReadPacket,
    callback: (packet: WritePacket) => void,
  ): () => void {
    // Generate unique correlation ID
    const correlationId = this.generateCorrelationId();

    // Start async operation
    this.publishAsync(partialPacket, correlationId, callback).catch((err) => {
      callback({ err, isDisposed: true });
    });

    // Return cleanup function
    return () => {
      // Cleanup will be handled by the reply queue manager
    };
  }

  /**
   * Implements the dispatchEvent method for fire-and-forget pattern
   * Called by NestJS when using emit()
   */
  protected async dispatchEvent(packet: ReadPacket): Promise<any> {
    await this.connect();

    const topic = this.getOptionsProp(this.options, 'topic');
    const sender = await this.getOrCreateSender(topic);

    const message = this.serviceBusSerializer.serialize({
      pattern: packet.pattern,
      data: packet.data,
    });

    await sender.sendMessages(message);
  }

  // ============ SCHEDULED MESSAGES ============

  /**
   * Schedules a message for future delivery
   */
  async scheduleMessage<T = any>(
    pattern: any,
    data: T,
    scheduledEnqueueTime: Date,
    options?: SendMessageOptions,
  ): Promise<Long> {
    await this.connect();

    const topic = options?.topic ?? this.getOptionsProp(this.options, 'topic');
    const sender = await this.getOrCreateSender(topic);

    const message = this.serviceBusSerializer.serialize({
      pattern,
      data,
      options,
    });

    const [sequenceNumber] = await sender.scheduleMessages(message, scheduledEnqueueTime);
    return sequenceNumber;
  }

  /**
   * Schedules multiple messages for future delivery
   */
  async scheduleMessages<T = any>(
    pattern: any,
    messages: T[],
    scheduledEnqueueTime: Date,
    options?: SendMessageOptions,
  ): Promise<Long[]> {
    await this.connect();

    const topic = options?.topic ?? this.getOptionsProp(this.options, 'topic');
    const sender = await this.getOrCreateSender(topic);

    const serializedMessages = messages.map((data) =>
      this.serviceBusSerializer.serialize({
        pattern,
        data,
        options,
      }),
    );

    return sender.scheduleMessages(serializedMessages, scheduledEnqueueTime);
  }

  /**
   * Cancels a scheduled message
   */
  async cancelScheduledMessage(sequenceNumber: Long, topic?: string): Promise<void> {
    await this.connect();

    const targetTopic = topic ?? this.getOptionsProp(this.options, 'topic');
    const sender = await this.getOrCreateSender(targetTopic);

    await sender.cancelScheduledMessages(sequenceNumber);
  }

  /**
   * Cancels multiple scheduled messages
   */
  async cancelScheduledMessages(sequenceNumbers: Long[], topic?: string): Promise<void> {
    await this.connect();

    const targetTopic = topic ?? this.getOptionsProp(this.options, 'topic');
    const sender = await this.getOrCreateSender(targetTopic);

    await sender.cancelScheduledMessages(sequenceNumbers);
  }

  // ============ BATCH OPERATIONS ============

  /**
   * Creates a message batch for efficient sending of multiple messages
   *
   * @example
   * ```typescript
   * const batch = await client.createMessageBatch('orders');
   * for (const order of orders) {
   *   if (!batch.tryAddMessage(client.serializeMessage('create-order', order))) {
   *     await client.sendBatch(batch);
   *     batch = await client.createMessageBatch('orders');
   *     batch.tryAddMessage(client.serializeMessage('create-order', order));
   *   }
   * }
   * await client.sendBatch(batch);
   * ```
   */
  async createMessageBatch(
    topic?: string,
    options?: CreateMessageBatchOptions,
  ): Promise<ServiceBusMessageBatch> {
    await this.connect();
    const targetTopic = topic ?? this.getOptionsProp(this.options, 'topic');
    const sender = await this.getOrCreateSender(targetTopic);
    return sender.createMessageBatch(options);
  }

  /**
   * Sends a pre-built message batch
   */
  async sendBatch(batch: ServiceBusMessageBatch, topic?: string): Promise<void> {
    await this.connect();
    const targetTopic = topic ?? this.getOptionsProp(this.options, 'topic');
    const sender = await this.getOrCreateSender(targetTopic);
    await sender.sendMessages(batch);
  }

  /**
   * Sends multiple messages at once (array)
   * For very large batches, consider using createMessageBatch instead
   */
  async sendMany<T = any>(
    pattern: any,
    messages: T[],
    options?: SendMessageOptions,
  ): Promise<void> {
    await this.connect();
    const topic = options?.topic ?? this.getOptionsProp(this.options, 'topic');
    const sender = await this.getOrCreateSender(topic);

    const serializedMessages = messages.map((data) =>
      this.serviceBusSerializer.serialize({ pattern, data, options }),
    );

    await sender.sendMessages(serializedMessages);
  }

  /**
   * Serializes a message for use with batch operations
   * Use this when building batches with createMessageBatch
   */
  serializeMessage<T = any>(pattern: any, data: T, options?: SendMessageOptions) {
    return this.serviceBusSerializer.serialize({ pattern, data, options });
  }

  // ============ PEEK/BROWSE OPERATIONS ============

  /**
   * Peeks messages without consuming them (read-only)
   * Peeked messages cannot be settled (completed/abandoned/etc.)
   *
   * @example
   * ```typescript
   * // Preview first 10 messages
   * const messages = await client.peekMessages('orders', 'processor', 10);
   * for (const msg of messages) {
   *   console.log('Preview:', msg.body);
   * }
   * ```
   */
  async peekMessages(
    topic: string,
    subscription: string,
    maxMessageCount: number,
    options?: PeekMessagesOptions,
  ): Promise<ServiceBusReceivedMessage[]> {
    await this.connect();

    const receiver = this.client!.createReceiver(topic, subscription, {
      receiveMode: 'peekLock',
      subQueueType: options?.subQueueType,
    });

    try {
      return await receiver.peekMessages(maxMessageCount, {
        fromSequenceNumber: options?.fromSequenceNumber
          ? Long.fromString(options.fromSequenceNumber.toString())
          : undefined,
      });
    } finally {
      await receiver.close();
    }
  }

  /**
   * Peeks messages from the dead letter queue
   */
  async peekDeadLetterMessages(
    topic: string,
    subscription: string,
    maxMessageCount: number,
    fromSequenceNumber?: bigint,
  ): Promise<ServiceBusReceivedMessage[]> {
    return this.peekMessages(topic, subscription, maxMessageCount, {
      fromSequenceNumber,
      subQueueType: 'deadLetter',
    });
  }

  // ============ DEFERRED MESSAGE OPERATIONS ============

  /**
   * Receives deferred messages by their sequence numbers
   * Messages must have been previously deferred using ctx.defer()
   *
   * @example
   * ```typescript
   * // Retrieve deferred messages by sequence number
   * const messages = await client.receiveDeferredMessages(
   *   'orders',
   *   'processor',
   *   [sequenceNumber1, sequenceNumber2]
   * );
   * ```
   */
  async receiveDeferredMessages(
    topic: string,
    subscription: string,
    sequenceNumbers: bigint[],
    options?: ReceiveDeferredMessagesOptions,
  ): Promise<ServiceBusReceivedMessage[]> {
    await this.connect();

    let receiver: ServiceBusReceiver | ServiceBusSessionReceiver;

    if (options?.sessionId) {
      receiver = await this.client!.acceptSession(topic, subscription, options.sessionId);
    } else {
      receiver = this.client!.createReceiver(topic, subscription);
    }

    try {
      const longSequenceNumbers = sequenceNumbers.map((sn) => Long.fromString(sn.toString()));
      return await receiver.receiveDeferredMessages(longSequenceNumbers);
    } finally {
      await receiver.close();
    }
  }

  // ============ RULE MANAGEMENT ============

  /**
   * Creates a rule manager for a subscription
   * Requires only Listen permissions (vs Manage for ServiceBusAdminService)
   *
   * @example
   * ```typescript
   * const ruleManager = client.createRuleManager('orders', 'high-priority');
   *
   * // Add a filter rule
   * await ruleManager.createRule('priority-filter', {
   *   sqlExpression: "priority = 'high'"
   * });
   *
   * // List rules
   * for await (const rule of ruleManager.listRules()) {
   *   console.log(rule.name);
   * }
   * ```
   */
  createRuleManager(topic: string, subscription: string): ServiceBusRuleManager {
    if (!this.client) {
      throw new ServiceBusConnectionError('Client not connected. Call connect() first.');
    }
    return this.client.createRuleManager(topic, subscription);
  }

  // ============ SESSION OPERATIONS ============

  /**
   * Accepts a specific session for processing
   * Returns a session receiver that can be used to receive messages for that session
   */
  async acceptSession(
    topic: string,
    subscription: string,
    sessionId: string,
  ): Promise<ServiceBusSessionReceiver> {
    await this.connect();
    return this.client!.acceptSession(topic, subscription, sessionId);
  }

  /**
   * Accepts the next available session for processing
   * Useful for round-robin session processing
   */
  async acceptNextSession(topic: string, subscription: string): Promise<ServiceBusSessionReceiver> {
    await this.connect();
    return this.client!.acceptNextSession(topic, subscription);
  }

  // ============ PRIVATE METHODS ============

  /**
   * Async implementation of publish for request-response
   */
  private async publishAsync(
    packet: ReadPacket,
    correlationId: string,
    callback: (packet: WritePacket) => void,
  ): Promise<void> {
    await this.connect();

    const requestTimeout = this.getOptionsProp(this.options, 'requestTimeout');

    // Register for response
    const cleanup = this.replyQueueManager!.registerPendingRequest(
      correlationId,
      (response) => {
        callback({
          err: response.err,
          response: response.response,
          isDisposed: response.isDisposed,
        });
      },
      requestTimeout,
    );

    try {
      // Send the request
      const topic = this.getOptionsProp(this.options, 'topic');
      const sender = await this.getOrCreateSender(topic);

      const message = this.serviceBusSerializer.serialize({
        pattern: packet.pattern,
        data: packet.data,
        id: correlationId,
      });

      // Set replyTo header
      message.replyTo = this.replyQueueManager!.getReplyTo();

      await sender.sendMessages(message);
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  /**
   * Generates a unique correlation ID
   */
  private generateCorrelationId(): string {
    return `${this.clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Gets or creates a sender for the specified topic
   */
  private async getOrCreateSender(topic: string): Promise<ServiceBusSender> {
    if (!this.senders.has(topic)) {
      const sender = this.client!.createSender(topic);
      this.senders.set(topic, sender);
    }
    return this.senders.get(topic)!;
  }

  /**
   * Starts the reply queue manager
   */
  private async startReplyQueueManager(): Promise<void> {
    const topic = this.getOptionsProp(this.options, 'topic');
    const replyTopic = this.getOptionsProp(this.options, 'replyTopic') ?? topic;
    const replySubscription =
      this.getOptionsProp(this.options, 'replySubscription') ?? `reply-${this.clientId}`;
    const requestTimeout =
      this.getOptionsProp(this.options, 'requestTimeout') ??
      SERVICE_BUS_DEFAULTS.REQUEST_TIMEOUT_MS;

    this.replyQueueManager = new ReplyQueueManager(this.client!, {
      replyTopic,
      replySubscription,
      requestTimeout,
    });

    await this.replyQueueManager.start();
  }
}
