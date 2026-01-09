/**
 * Error codes for Service Bus transport errors
 */
export enum ServiceBusTransportErrorCode {
  // Connection errors
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_LOST = 'CONNECTION_LOST',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',

  // Message errors
  MESSAGE_SETTLEMENT_FAILED = 'MESSAGE_SETTLEMENT_FAILED',
  MESSAGE_LOCK_LOST = 'MESSAGE_LOCK_LOST',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
  MESSAGE_SERIALIZATION_FAILED = 'MESSAGE_SERIALIZATION_FAILED',
  MESSAGE_DESERIALIZATION_FAILED = 'MESSAGE_DESERIALIZATION_FAILED',

  // Session errors
  SESSION_LOCK_LOST = 'SESSION_LOCK_LOST',
  SESSION_CANNOT_BE_LOCKED = 'SESSION_CANNOT_BE_LOCKED',
  SESSION_TIMEOUT = 'SESSION_TIMEOUT',

  // Operation errors
  OPERATION_TIMEOUT = 'OPERATION_TIMEOUT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  ENTITY_NOT_FOUND = 'ENTITY_NOT_FOUND',

  // General
  UNKNOWN = 'UNKNOWN',
}

/**
 * Base error class for all Service Bus transport errors
 */
export class ServiceBusTransportError extends Error {
  /**
   * Error code for programmatic error handling
   */
  public readonly code: ServiceBusTransportErrorCode;

  /**
   * Original error from Azure SDK
   */
  public readonly originalError?: Error;

  /**
   * Additional context about the error
   */
  public readonly context?: Record<string, any>;

  /**
   * Whether this error is potentially transient and the operation could be retried
   */
  public readonly isTransient: boolean;

  constructor(
    message: string,
    code: ServiceBusTransportErrorCode,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      isTransient?: boolean;
    },
  ) {
    super(message);
    this.name = 'ServiceBusTransportError';
    this.code = code;
    this.originalError = options?.originalError;
    this.context = options?.context;
    this.isTransient = options?.isTransient ?? false;

    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ServiceBusTransportError);
    }

    // Include original error stack if available
    if (this.originalError?.stack) {
      this.stack = `${this.stack}\nCaused by: ${this.originalError.stack}`;
    }
  }

  /**
   * Returns a JSON representation of the error
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      isTransient: this.isTransient,
      context: this.context,
      originalError: this.originalError
        ? {
            name: this.originalError.name,
            message: this.originalError.message,
          }
        : undefined,
    };
  }
}
