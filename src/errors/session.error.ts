import {
  ServiceBusTransportError,
  ServiceBusTransportErrorCode,
} from './service-bus-transport.error';

/**
 * Error thrown when the session lock has expired
 */
export class ServiceBusSessionLockLostError extends ServiceBusTransportError {
  /**
   * Session ID of the session whose lock was lost
   */
  public readonly sessionId?: string;

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      sessionId?: string;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.SESSION_LOCK_LOST, {
      ...options,
      isTransient: true, // Session can be re-acquired
      context: {
        ...options?.context,
        sessionId: options?.sessionId,
      },
    });
    this.name = 'ServiceBusSessionLockLostError';
    this.sessionId = options?.sessionId;
  }
}

/**
 * Error thrown when a session cannot be locked (e.g., already locked by another receiver)
 */
export class ServiceBusSessionCannotBeLockedError extends ServiceBusTransportError {
  /**
   * Session ID that could not be locked
   */
  public readonly sessionId?: string;

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      sessionId?: string;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.SESSION_CANNOT_BE_LOCKED, {
      ...options,
      isTransient: true, // Session might become available later
      context: {
        ...options?.context,
        sessionId: options?.sessionId,
      },
    });
    this.name = 'ServiceBusSessionCannotBeLockedError';
    this.sessionId = options?.sessionId;
  }
}

/**
 * Error thrown when a session operation times out
 */
export class ServiceBusSessionTimeoutError extends ServiceBusTransportError {
  /**
   * Session ID that timed out
   */
  public readonly sessionId?: string;

  /**
   * Timeout value in milliseconds
   */
  public readonly timeoutMs?: number;

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      sessionId?: string;
      timeoutMs?: number;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.SESSION_TIMEOUT, {
      ...options,
      isTransient: true,
      context: {
        ...options?.context,
        sessionId: options?.sessionId,
        timeoutMs: options?.timeoutMs,
      },
    });
    this.name = 'ServiceBusSessionTimeoutError';
    this.sessionId = options?.sessionId;
    this.timeoutMs = options?.timeoutMs;
  }
}
