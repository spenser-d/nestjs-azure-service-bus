import {
  ServiceBusTransportError,
  ServiceBusTransportErrorCode,
} from './service-bus-transport.error';

/**
 * Error thrown when message settlement (complete, abandon, defer, dead-letter) fails
 */
export class ServiceBusMessageSettlementError extends ServiceBusTransportError {
  /**
   * The settlement action that failed
   */
  public readonly action: 'complete' | 'abandon' | 'defer' | 'deadLetter';

  /**
   * Message ID of the message that failed settlement
   */
  public readonly messageId?: string;

  constructor(
    message: string,
    action: 'complete' | 'abandon' | 'defer' | 'deadLetter',
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      messageId?: string;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.MESSAGE_SETTLEMENT_FAILED, {
      ...options,
      isTransient: false,
      context: {
        ...options?.context,
        action,
        messageId: options?.messageId,
      },
    });
    this.name = 'ServiceBusMessageSettlementError';
    this.action = action;
    this.messageId = options?.messageId;
  }
}

/**
 * Error thrown when the message lock has expired
 */
export class ServiceBusMessageLockLostError extends ServiceBusTransportError {
  /**
   * Message ID of the message whose lock was lost
   */
  public readonly messageId?: string;

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      messageId?: string;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.MESSAGE_LOCK_LOST, {
      ...options,
      isTransient: false, // Lock lost is not recoverable for this message instance
      context: {
        ...options?.context,
        messageId: options?.messageId,
      },
    });
    this.name = 'ServiceBusMessageLockLostError';
    this.messageId = options?.messageId;
  }
}

/**
 * Error thrown when a message is too large to send
 */
export class ServiceBusMessageTooLargeError extends ServiceBusTransportError {
  /**
   * Size of the message in bytes
   */
  public readonly messageSize?: number;

  /**
   * Maximum allowed size in bytes
   */
  public readonly maxSize?: number;

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      messageSize?: number;
      maxSize?: number;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.MESSAGE_TOO_LARGE, {
      ...options,
      isTransient: false,
      context: {
        ...options?.context,
        messageSize: options?.messageSize,
        maxSize: options?.maxSize,
      },
    });
    this.name = 'ServiceBusMessageTooLargeError';
    this.messageSize = options?.messageSize;
    this.maxSize = options?.maxSize;
  }
}

/**
 * Error thrown when message serialization fails
 */
export class ServiceBusSerializationError extends ServiceBusTransportError {
  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.MESSAGE_SERIALIZATION_FAILED, {
      ...options,
      isTransient: false,
    });
    this.name = 'ServiceBusSerializationError';
  }
}

/**
 * Error thrown when message deserialization fails
 */
export class ServiceBusDeserializationError extends ServiceBusTransportError {
  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.MESSAGE_DESERIALIZATION_FAILED, {
      ...options,
      isTransient: false,
    });
    this.name = 'ServiceBusDeserializationError';
  }
}
