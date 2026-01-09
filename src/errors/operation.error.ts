import {
  ServiceBusTransportError,
  ServiceBusTransportErrorCode,
} from './service-bus-transport.error';

/**
 * Error thrown when an operation times out
 */
export class ServiceBusTimeoutError extends ServiceBusTransportError {
  /**
   * Timeout value in milliseconds
   */
  public readonly timeoutMs?: number;

  /**
   * Operation that timed out
   */
  public readonly operation?: string;

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      timeoutMs?: number;
      operation?: string;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.OPERATION_TIMEOUT, {
      ...options,
      isTransient: true,
      context: {
        ...options?.context,
        timeoutMs: options?.timeoutMs,
        operation: options?.operation,
      },
    });
    this.name = 'ServiceBusTimeoutError';
    this.timeoutMs = options?.timeoutMs;
    this.operation = options?.operation;
  }
}

/**
 * Error thrown when a quota is exceeded
 */
export class ServiceBusQuotaExceededError extends ServiceBusTransportError {
  /**
   * The quota that was exceeded
   */
  public readonly quotaType?: string;

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      quotaType?: string;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.QUOTA_EXCEEDED, {
      ...options,
      isTransient: false, // Quota exceeded requires resolution
      context: {
        ...options?.context,
        quotaType: options?.quotaType,
      },
    });
    this.name = 'ServiceBusQuotaExceededError';
    this.quotaType = options?.quotaType;
  }
}

/**
 * Error thrown when a Service Bus entity (queue, topic, subscription) is not found
 */
export class ServiceBusEntityNotFoundError extends ServiceBusTransportError {
  /**
   * Name of the entity that was not found
   */
  public readonly entityName?: string;

  /**
   * Type of the entity (queue, topic, subscription)
   */
  public readonly entityType?: 'queue' | 'topic' | 'subscription';

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      entityName?: string;
      entityType?: 'queue' | 'topic' | 'subscription';
    },
  ) {
    super(message, ServiceBusTransportErrorCode.ENTITY_NOT_FOUND, {
      ...options,
      isTransient: false,
      context: {
        ...options?.context,
        entityName: options?.entityName,
        entityType: options?.entityType,
      },
    });
    this.name = 'ServiceBusEntityNotFoundError';
    this.entityName = options?.entityName;
    this.entityType = options?.entityType;
  }
}
