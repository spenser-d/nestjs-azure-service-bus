import { ServiceBusError } from '@azure/service-bus';
import {
  ServiceBusTransportError,
  ServiceBusTransportErrorCode,
} from '../errors/service-bus-transport.error';
import {
  ServiceBusConnectionError,
  ServiceBusAuthenticationError,
} from '../errors/connection.error';
import {
  ServiceBusMessageLockLostError,
  ServiceBusMessageTooLargeError,
} from '../errors/message-settlement.error';
import {
  ServiceBusSessionLockLostError,
  ServiceBusSessionCannotBeLockedError,
} from '../errors/session.error';
import {
  ServiceBusTimeoutError,
  ServiceBusQuotaExceededError,
  ServiceBusEntityNotFoundError,
} from '../errors/operation.error';

/**
 * Maps Azure Service Bus error codes to our custom error types
 */
const ERROR_CODE_MAP: Record<
  string,
  {
    ErrorClass: new (message: string, options?: any) => ServiceBusTransportError;
    code: ServiceBusTransportErrorCode;
  }
> = {
  MessageLockLost: {
    ErrorClass: ServiceBusMessageLockLostError,
    code: ServiceBusTransportErrorCode.MESSAGE_LOCK_LOST,
  },
  SessionLockLost: {
    ErrorClass: ServiceBusSessionLockLostError,
    code: ServiceBusTransportErrorCode.SESSION_LOCK_LOST,
  },
  SessionCannotBeLocked: {
    ErrorClass: ServiceBusSessionCannotBeLockedError,
    code: ServiceBusTransportErrorCode.SESSION_CANNOT_BE_LOCKED,
  },
  ServiceTimeout: {
    ErrorClass: ServiceBusTimeoutError,
    code: ServiceBusTransportErrorCode.OPERATION_TIMEOUT,
  },
  QuotaExceeded: {
    ErrorClass: ServiceBusQuotaExceededError,
    code: ServiceBusTransportErrorCode.QUOTA_EXCEEDED,
  },
  MessageSizeExceeded: {
    ErrorClass: ServiceBusMessageTooLargeError,
    code: ServiceBusTransportErrorCode.MESSAGE_TOO_LARGE,
  },
  MessagingEntityNotFound: {
    ErrorClass: ServiceBusEntityNotFoundError,
    code: ServiceBusTransportErrorCode.ENTITY_NOT_FOUND,
  },
  UnauthorizedAccess: {
    ErrorClass: ServiceBusAuthenticationError,
    code: ServiceBusTransportErrorCode.AUTHENTICATION_FAILED,
  },
  ServiceCommunicationProblem: {
    ErrorClass: ServiceBusConnectionError,
    code: ServiceBusTransportErrorCode.CONNECTION_FAILED,
  },
};

/**
 * Wraps an Azure Service Bus error in our custom error type
 *
 * @param error - Original error
 * @param context - Additional context to include
 * @returns Wrapped error
 */
export function wrapError(error: unknown, context?: Record<string, any>): ServiceBusTransportError {
  // Already our error type
  if (error instanceof ServiceBusTransportError) {
    return error;
  }

  // Azure SDK error
  if (isServiceBusError(error)) {
    const mapping = ERROR_CODE_MAP[error.code];

    if (mapping) {
      return new mapping.ErrorClass(error.message, {
        originalError: error,
        context,
      });
    }

    // Unknown Azure error code, wrap as generic transport error
    return new ServiceBusTransportError(error.message, ServiceBusTransportErrorCode.UNKNOWN, {
      originalError: error,
      context: { ...context, azureErrorCode: error.code },
      isTransient: isTransientError(error),
    });
  }

  // Generic Error
  if (error instanceof Error) {
    return new ServiceBusTransportError(error.message, ServiceBusTransportErrorCode.UNKNOWN, {
      originalError: error,
      context,
      isTransient: false,
    });
  }

  // Unknown error type
  return new ServiceBusTransportError(String(error), ServiceBusTransportErrorCode.UNKNOWN, {
    context,
    isTransient: false,
  });
}

/**
 * Type guard for Azure Service Bus errors
 */
export function isServiceBusError(error: unknown): error is ServiceBusError {
  return (
    error instanceof Error && 'code' in error && typeof (error as ServiceBusError).code === 'string'
  );
}

/**
 * Determines if an error is transient and the operation can be retried
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof ServiceBusTransportError) {
    return error.isTransient;
  }

  if (isServiceBusError(error)) {
    const transientCodes = [
      'ServiceTimeout',
      'ServiceCommunicationProblem',
      'GeneralError',
      'SessionCannotBeLocked', // Session might become available
    ];
    return transientCodes.includes(error.code);
  }

  return false;
}

/**
 * Serializes an error for transport
 */
export function serializeError(error: unknown): Record<string, any> {
  if (error instanceof ServiceBusTransportError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

/**
 * Deserializes an error from transport
 */
export function deserializeError(data: Record<string, any>): Error {
  const error = new Error(data.message || 'Unknown error');
  error.name = data.name || 'Error';

  if (data.code) {
    return new ServiceBusTransportError(data.message, data.code as ServiceBusTransportErrorCode, {
      isTransient: data.isTransient ?? false,
      context: data.context,
    });
  }

  return error;
}
