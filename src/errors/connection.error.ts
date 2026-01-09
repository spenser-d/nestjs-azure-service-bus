import {
  ServiceBusTransportError,
  ServiceBusTransportErrorCode,
} from './service-bus-transport.error';

/**
 * Error thrown when a connection to Azure Service Bus fails
 */
export class ServiceBusConnectionError extends ServiceBusTransportError {
  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
      isTransient?: boolean;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.CONNECTION_FAILED, {
      ...options,
      isTransient: options?.isTransient ?? true, // Connection errors are usually transient
    });
    this.name = 'ServiceBusConnectionError';
  }
}

/**
 * Error thrown when authentication to Azure Service Bus fails
 */
export class ServiceBusAuthenticationError extends ServiceBusTransportError {
  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.AUTHENTICATION_FAILED, {
      ...options,
      isTransient: false, // Auth errors are not transient
    });
    this.name = 'ServiceBusAuthenticationError';
  }
}

/**
 * Error thrown when the connection to Azure Service Bus is lost
 */
export class ServiceBusConnectionLostError extends ServiceBusTransportError {
  constructor(
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, any>;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.CONNECTION_LOST, {
      ...options,
      isTransient: true,
    });
    this.name = 'ServiceBusConnectionLostError';
  }
}
