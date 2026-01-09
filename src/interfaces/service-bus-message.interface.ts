import type { ServiceBusReceivedMessage } from '@azure/service-bus';

/**
 * NestJS packet structure for outgoing requests/events
 */
export interface OutgoingPacket<T = any> {
  /**
   * Correlation ID for request-response matching
   */
  id?: string;

  /**
   * Pattern/route for message handling
   */
  pattern: any;

  /**
   * Message payload
   */
  data: T;
}

/**
 * NestJS packet structure for incoming requests/events
 */
export interface IncomingPacket<T = any> {
  /**
   * Correlation ID for request-response matching
   * Undefined for events (fire-and-forget)
   */
  id?: string;

  /**
   * Pattern/route that was matched
   */
  pattern: string;

  /**
   * Message payload
   */
  data: T;
}

/**
 * NestJS packet structure for responses
 */
export interface ResponsePacket<T = any> {
  /**
   * Correlation ID matching the request
   */
  id: string;

  /**
   * Error if the handler threw
   */
  err?: any;

  /**
   * Response data
   */
  response?: T;

  /**
   * Whether the observable stream is complete
   */
  isDisposed?: boolean;
}

/**
 * Extended Service Bus message with NestJS-specific properties
 */
export interface NestServiceBusMessage<T = any> {
  /**
   * Typed message body
   */
  body: T;

  /**
   * Application properties with NestJS metadata
   */
  applicationProperties?: {
    /**
     * Pattern/route for the message
     */
    nestjs_pattern?: string;

    /**
     * Marker to identify NestJS messages
     */
    nestjs?: boolean;

    /**
     * Whether this is a response message
     */
    nestjs_is_response?: boolean;

    /**
     * Whether the stream is disposed
     */
    nestjs_is_disposed?: boolean;

    /**
     * Serialized error
     */
    nestjs_error?: string;

    /**
     * Additional custom properties
     */
    [key: string]: string | number | boolean | Date | null | undefined;
  };
}

/**
 * Context data passed to handlers
 */
export interface ServiceBusMessageContext {
  /**
   * The original Azure Service Bus message
   */
  message: ServiceBusReceivedMessage;

  /**
   * Topic name
   */
  topic: string;

  /**
   * Subscription name
   */
  subscription: string;

  /**
   * Whether the message is from the dead letter queue
   */
  isDeadLetter: boolean;

  /**
   * Session ID (if session-enabled)
   */
  sessionId?: string;
}

/**
 * Options for dead-lettering a message
 */
export interface DeadLetterOptions {
  /**
   * Reason for dead-lettering
   */
  deadLetterReason?: string;

  /**
   * Detailed error description
   */
  deadLetterErrorDescription?: string;

  /**
   * Properties to modify on the message
   */
  propertiesToModify?: Record<string, any>;
}

/**
 * Options for abandoning a message
 */
export interface AbandonOptions {
  /**
   * Properties to modify on the message
   */
  propertiesToModify?: Record<string, any>;
}

/**
 * Options for deferring a message
 */
export interface DeferOptions {
  /**
   * Properties to modify on the message
   */
  propertiesToModify?: Record<string, any>;
}

/**
 * Message sending options
 */
export interface SendMessageOptions {
  /**
   * Target topic (overrides default)
   */
  topic?: string;

  /**
   * Session ID for session-enabled entities
   */
  sessionId?: string;

  /**
   * Message time to live in milliseconds
   */
  timeToLiveMs?: number;

  /**
   * Content type of the message body
   */
  contentType?: string;

  /**
   * Custom application properties
   */
  applicationProperties?: Record<string, string | number | boolean | Date | null>;

  /**
   * Subject/label for the message
   */
  subject?: string;
}

/**
 * Scheduled message options
 */
export interface ScheduleMessageOptions extends SendMessageOptions {
  /**
   * Scheduled enqueue time
   */
  scheduledEnqueueTime: Date;
}
