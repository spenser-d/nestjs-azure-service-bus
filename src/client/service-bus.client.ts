import { ServiceBusClient as AzureServiceBusClient, ServiceBusSender } from '@azure/service-bus';
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
 * NestJS microservice client for Azure Service Bus
 * Supports request-response and event patterns
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

  constructor(private readonly options: ServiceBusClientOptions) {
    super();

    this.clientId = generateClientId();

    // Initialize serializers
    this.serviceBusSerializer =
      (this.options.serializer as ServiceBusSerializer) ?? createServiceBusSerializer();
    this.serviceBusDeserializer =
      (this.options.deserializer as ServiceBusDeserializer) ?? createServiceBusDeserializer();

    // Set NestJS serializers
    this.initializeSerializer(this.options);
    this.initializeDeserializer(this.options);
  }

  /**
   * Connects to Azure Service Bus
   */
  async connect(): Promise<AzureServiceBusClient> {
    if (this.client) {
      return this.client;
    }

    this.status = ServiceBusClientStatus.CONNECTING;

    try {
      // Create Azure Service Bus client
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

      // Start reply queue manager for request-response pattern
      await this.startReplyQueueManager();

      this.status = ServiceBusClientStatus.CONNECTED;
      this.logger.log('Connected to Azure Service Bus');

      return this.client;
    } catch (error) {
      this.status = ServiceBusClientStatus.DISCONNECTED;
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

    const topic = options?.topic ?? this.options.topic;
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
   * Cancels a scheduled message
   */
  async cancelScheduledMessage(sequenceNumber: Long, topic?: string): Promise<void> {
    await this.connect();

    const targetTopic = topic ?? this.options.topic;
    const sender = await this.getOrCreateSender(targetTopic);

    await sender.cancelScheduledMessages(sequenceNumber);
  }

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

    const topic = this.options.topic;
    const sender = await this.getOrCreateSender(topic);

    const message = this.serviceBusSerializer.serialize({
      pattern: packet.pattern,
      data: packet.data,
    });

    await sender.sendMessages(message);
  }

  /**
   * Async implementation of publish for request-response
   */
  private async publishAsync(
    packet: ReadPacket,
    correlationId: string,
    callback: (packet: WritePacket) => void,
  ): Promise<void> {
    await this.connect();

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
      this.options.requestTimeout,
    );

    try {
      // Send the request
      const topic = this.options.topic;
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
    const replyTopic = this.options.replyTopic ?? this.options.topic;
    const replySubscription = this.options.replySubscription ?? `reply-${this.clientId}`;

    this.replyQueueManager = new ReplyQueueManager(this.client!, {
      replyTopic,
      replySubscription,
      requestTimeout: this.options.requestTimeout ?? SERVICE_BUS_DEFAULTS.REQUEST_TIMEOUT_MS,
    });

    await this.replyQueueManager.start();
  }
}
