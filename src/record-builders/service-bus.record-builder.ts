/**
 * Options that can be set per-message using ServiceBusRecord
 * Follows the NestJS RmqRecordOptions pattern
 */
export interface ServiceBusRecordOptions {
  /**
   * Session ID for session-enabled entities
   */
  sessionId?: string;

  /**
   * Partition key for message grouping (transaction scenarios)
   */
  partitionKey?: string;

  /**
   * Custom correlation ID (auto-generated for request-response if not provided)
   */
  correlationId?: string;

  /**
   * Content type of the message body
   * @default 'application/json'
   */
  contentType?: string;

  /**
   * Subject/label for the message
   */
  subject?: string;

  /**
   * Time to live in milliseconds
   */
  timeToLiveMs?: number;

  /**
   * Scheduled delivery time (UTC)
   */
  scheduledEnqueueTimeUtc?: Date;

  /**
   * Custom message ID
   */
  messageId?: string;

  /**
   * Reply-to address for request-response
   */
  replyTo?: string;

  /**
   * Reply-to session ID
   */
  replyToSessionId?: string;

  /**
   * Custom application properties
   */
  applicationProperties?: Record<string, string | number | boolean | Date | null>;
}

/**
 * Record wrapper for messages with per-message options
 * Follows the NestJS RmqRecord pattern for consistent API
 *
 * @example
 * ```typescript
 * // Create a record with options
 * const record = new ServiceBusRecord(
 *   { orderId: '12345', amount: 99.99 },
 *   { sessionId: 'user-abc', timeToLiveMs: 60000 }
 * );
 *
 * // Use with client
 * client.send('process-order', record).subscribe();
 * client.emit('order-created', record);
 * ```
 */
export class ServiceBusRecord<TData = any> {
  constructor(
    public readonly data: TData,
    public readonly options?: ServiceBusRecordOptions,
  ) {}
}

/**
 * Builder for creating ServiceBusRecord instances
 * Provides a fluent API for setting message options
 *
 * @example
 * ```typescript
 * const record = new ServiceBusRecordBuilder<OrderData>()
 *   .setData({ orderId: '12345', amount: 99.99 })
 *   .setSessionId('user-abc')
 *   .setTimeToLive(60000)
 *   .setApplicationProperties({ priority: 'high', region: 'us-west' })
 *   .build();
 *
 * client.send('process-order', record).subscribe();
 * ```
 */
export class ServiceBusRecordBuilder<TData = any> {
  private data?: TData;
  private options: ServiceBusRecordOptions = {};

  constructor(data?: TData) {
    this.data = data;
  }

  /**
   * Sets the message data/payload
   */
  setData(data: TData): this {
    this.data = data;
    return this;
  }

  /**
   * Sets all options at once
   */
  setOptions(options: ServiceBusRecordOptions): this {
    this.options = { ...this.options, ...options };
    return this;
  }

  /**
   * Sets the session ID for session-enabled entities
   */
  setSessionId(sessionId: string): this {
    this.options.sessionId = sessionId;
    return this;
  }

  /**
   * Sets the partition key for message grouping
   */
  setPartitionKey(partitionKey: string): this {
    this.options.partitionKey = partitionKey;
    return this;
  }

  /**
   * Sets a custom correlation ID
   */
  setCorrelationId(correlationId: string): this {
    this.options.correlationId = correlationId;
    return this;
  }

  /**
   * Sets the content type of the message body
   */
  setContentType(contentType: string): this {
    this.options.contentType = contentType;
    return this;
  }

  /**
   * Sets the subject/label for the message
   */
  setSubject(subject: string): this {
    this.options.subject = subject;
    return this;
  }

  /**
   * Sets the time to live in milliseconds
   */
  setTimeToLive(timeToLiveMs: number): this {
    this.options.timeToLiveMs = timeToLiveMs;
    return this;
  }

  /**
   * Sets the scheduled delivery time (UTC)
   */
  setScheduledEnqueueTime(scheduledEnqueueTimeUtc: Date): this {
    this.options.scheduledEnqueueTimeUtc = scheduledEnqueueTimeUtc;
    return this;
  }

  /**
   * Sets a custom message ID
   */
  setMessageId(messageId: string): this {
    this.options.messageId = messageId;
    return this;
  }

  /**
   * Sets the reply-to address
   */
  setReplyTo(replyTo: string): this {
    this.options.replyTo = replyTo;
    return this;
  }

  /**
   * Sets the reply-to session ID
   */
  setReplyToSessionId(replyToSessionId: string): this {
    this.options.replyToSessionId = replyToSessionId;
    return this;
  }

  /**
   * Sets custom application properties
   * Merges with any existing application properties
   */
  setApplicationProperties(props: Record<string, string | number | boolean | Date | null>): this {
    this.options.applicationProperties = {
      ...this.options.applicationProperties,
      ...props,
    };
    return this;
  }

  /**
   * Adds a single application property
   */
  addApplicationProperty(key: string, value: string | number | boolean | Date | null): this {
    this.options.applicationProperties = {
      ...this.options.applicationProperties,
      [key]: value,
    };
    return this;
  }

  /**
   * Builds and returns the ServiceBusRecord instance
   */
  build(): ServiceBusRecord<TData> {
    return new ServiceBusRecord(this.data as TData, this.options);
  }
}
