import {
  normalizePattern,
  parsePattern,
  patternsMatch,
  createSubscriptionKey,
} from '../../../src/utils/pattern.utils';
import {
  wrapError,
  isServiceBusError,
  isTransientError,
  serializeError,
  deserializeError,
} from '../../../src/utils/error.utils';
import {
  ServiceBusTransportError,
  ServiceBusTransportErrorCode,
} from '../../../src/errors/service-bus-transport.error';
import { ServiceBusConnectionError } from '../../../src/errors/connection.error';
import { ServiceBusMessageLockLostError } from '../../../src/errors/message-settlement.error';
import {
  ServiceBusSessionLockLostError,
  ServiceBusSessionCannotBeLockedError,
} from '../../../src/errors/session.error';
import {
  ServiceBusTimeoutError,
  ServiceBusQuotaExceededError,
  ServiceBusEntityNotFoundError,
} from '../../../src/errors/operation.error';

// Mock Azure SDK ServiceBusError
class MockServiceBusError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'ServiceBusError';
  }
}

describe('Pattern Utils', () => {
  describe('normalizePattern', () => {
    it('should return string patterns as-is', () => {
      expect(normalizePattern('order.created')).toBe('order.created');
      expect(normalizePattern('user.updated')).toBe('user.updated');
    });

    it('should stringify object patterns', () => {
      const pattern = { cmd: 'getOrder' };
      const result = normalizePattern(pattern);
      expect(result).toBe(JSON.stringify({ cmd: 'getOrder' }));
    });

    it('should sort object keys for consistent serialization', () => {
      const pattern1 = { b: 2, a: 1 };
      const pattern2 = { a: 1, b: 2 };

      expect(normalizePattern(pattern1)).toBe(normalizePattern(pattern2));
      expect(normalizePattern(pattern1)).toBe('{"a":1,"b":2}');
    });

    it('should handle nested objects', () => {
      const pattern = { outer: { b: 2, a: 1 }, key: 'value' };
      const result = normalizePattern(pattern);
      expect(result).toBe('{"key":"value","outer":{"a":1,"b":2}}');
    });

    it('should convert non-string/non-object values to strings', () => {
      expect(normalizePattern(123)).toBe('123');
      expect(normalizePattern(true)).toBe('true');
      expect(normalizePattern(undefined)).toBe('undefined');
    });

    it('should handle null', () => {
      expect(normalizePattern(null)).toBe('null');
    });

    it('should handle arrays within objects', () => {
      const pattern = { tags: ['a', 'b'], cmd: 'test' };
      const result = normalizePattern(pattern);
      expect(result).toBe('{"cmd":"test","tags":["a","b"]}');
    });
  });

  describe('parsePattern', () => {
    it('should parse valid JSON objects', () => {
      const json = '{"cmd":"getOrder"}';
      expect(parsePattern(json)).toEqual({ cmd: 'getOrder' });
    });

    it('should return string patterns as-is', () => {
      expect(parsePattern('order.created')).toBe('order.created');
    });

    it('should handle invalid JSON gracefully', () => {
      expect(parsePattern('not-json')).toBe('not-json');
      expect(parsePattern('{ invalid')).toBe('{ invalid');
    });

    it('should return primitive JSON values as strings', () => {
      // Numbers and booleans parsed from JSON are returned as the original string
      expect(parsePattern('123')).toBe('123');
      expect(parsePattern('true')).toBe('true');
      expect(parsePattern('"string"')).toBe('"string"');
    });

    it('should handle nested JSON objects', () => {
      const json = '{"outer":{"inner":"value"}}';
      expect(parsePattern(json)).toEqual({ outer: { inner: 'value' } });
    });
  });

  describe('patternsMatch', () => {
    it('should match identical string patterns', () => {
      expect(patternsMatch('order.created', 'order.created')).toBe(true);
    });

    it('should not match different string patterns', () => {
      expect(patternsMatch('order.created', 'order.updated')).toBe(false);
    });

    it('should match identical object patterns', () => {
      expect(patternsMatch({ cmd: 'test' }, { cmd: 'test' })).toBe(true);
    });

    it('should match object patterns with different key orders', () => {
      expect(patternsMatch({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    });

    it('should not match different object patterns', () => {
      expect(patternsMatch({ cmd: 'test' }, { cmd: 'other' })).toBe(false);
    });

    it('should not match string and object patterns', () => {
      expect(patternsMatch('test', { cmd: 'test' })).toBe(false);
    });
  });

  describe('createSubscriptionKey', () => {
    it('should create key for regular subscription', () => {
      expect(createSubscriptionKey('orders', 'processor')).toBe('orders/processor');
    });

    it('should create key for dead letter queue', () => {
      expect(createSubscriptionKey('orders', 'processor', true)).toBe(
        'orders/processor/$deadletter',
      );
    });

    it('should default isDeadLetter to false', () => {
      expect(createSubscriptionKey('events', 'handler')).toBe('events/handler');
      expect(createSubscriptionKey('events', 'handler', false)).toBe('events/handler');
    });
  });
});

describe('Error Utils', () => {
  describe('isServiceBusError', () => {
    it('should return true for Azure SDK errors', () => {
      const error = new MockServiceBusError('Test', 'MessageLockLost');
      expect(isServiceBusError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Test');
      expect(isServiceBusError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(isServiceBusError('string')).toBe(false);
      expect(isServiceBusError(null)).toBe(false);
      expect(isServiceBusError(undefined)).toBe(false);
      expect(isServiceBusError(123)).toBe(false);
    });

    it('should return false for objects with non-string code', () => {
      const error = new Error('Test');
      (error as any).code = 123;
      expect(isServiceBusError(error)).toBe(false);
    });
  });

  describe('wrapError', () => {
    it('should return ServiceBusTransportError as-is', () => {
      const original = new ServiceBusTransportError('Test', ServiceBusTransportErrorCode.UNKNOWN);
      expect(wrapError(original)).toBe(original);
    });

    it('should wrap MessageLockLost error', () => {
      const azureError = new MockServiceBusError('Lock lost', 'MessageLockLost');
      const wrapped = wrapError(azureError);

      expect(wrapped).toBeInstanceOf(ServiceBusMessageLockLostError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.MESSAGE_LOCK_LOST);
      expect(wrapped.originalError).toBe(azureError);
    });

    it('should wrap SessionLockLost error', () => {
      const azureError = new MockServiceBusError('Session lock lost', 'SessionLockLost');
      const wrapped = wrapError(azureError);

      expect(wrapped).toBeInstanceOf(ServiceBusSessionLockLostError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.SESSION_LOCK_LOST);
    });

    it('should wrap SessionCannotBeLocked error', () => {
      const azureError = new MockServiceBusError('Cannot lock', 'SessionCannotBeLocked');
      const wrapped = wrapError(azureError);

      expect(wrapped).toBeInstanceOf(ServiceBusSessionCannotBeLockedError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.SESSION_CANNOT_BE_LOCKED);
    });

    it('should wrap ServiceTimeout error', () => {
      const azureError = new MockServiceBusError('Timeout', 'ServiceTimeout');
      const wrapped = wrapError(azureError);

      expect(wrapped).toBeInstanceOf(ServiceBusTimeoutError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.OPERATION_TIMEOUT);
    });

    it('should wrap QuotaExceeded error', () => {
      const azureError = new MockServiceBusError('Quota exceeded', 'QuotaExceeded');
      const wrapped = wrapError(azureError);

      expect(wrapped).toBeInstanceOf(ServiceBusQuotaExceededError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.QUOTA_EXCEEDED);
    });

    it('should wrap MessageSizeExceeded error', () => {
      const azureError = new MockServiceBusError('Too large', 'MessageSizeExceeded');
      const wrapped = wrapError(azureError);

      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.MESSAGE_TOO_LARGE);
    });

    it('should wrap MessagingEntityNotFound error', () => {
      const azureError = new MockServiceBusError('Not found', 'MessagingEntityNotFound');
      const wrapped = wrapError(azureError);

      expect(wrapped).toBeInstanceOf(ServiceBusEntityNotFoundError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.ENTITY_NOT_FOUND);
    });

    it('should wrap UnauthorizedAccess error', () => {
      const azureError = new MockServiceBusError('Unauthorized', 'UnauthorizedAccess');
      const wrapped = wrapError(azureError);

      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.AUTHENTICATION_FAILED);
    });

    it('should wrap ServiceCommunicationProblem error', () => {
      const azureError = new MockServiceBusError('Communication', 'ServiceCommunicationProblem');
      const wrapped = wrapError(azureError);

      expect(wrapped).toBeInstanceOf(ServiceBusConnectionError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.CONNECTION_FAILED);
    });

    it('should wrap unknown Azure error codes', () => {
      const azureError = new MockServiceBusError('Unknown', 'UnknownCode');
      const wrapped = wrapError(azureError);

      expect(wrapped).toBeInstanceOf(ServiceBusTransportError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.UNKNOWN);
      expect(wrapped.context).toEqual({ azureErrorCode: 'UnknownCode' });
    });

    it('should wrap generic Error', () => {
      const error = new Error('Generic error');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(ServiceBusTransportError);
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.UNKNOWN);
      expect(wrapped.originalError).toBe(error);
      expect(wrapped.isTransient).toBe(false);
    });

    it('should wrap unknown types', () => {
      const wrapped = wrapError('string error');

      expect(wrapped).toBeInstanceOf(ServiceBusTransportError);
      expect(wrapped.message).toBe('string error');
      expect(wrapped.code).toBe(ServiceBusTransportErrorCode.UNKNOWN);
    });

    it('should include context in wrapped errors', () => {
      const error = new Error('Test');
      const context = { topic: 'orders', subscription: 'processor' };
      const wrapped = wrapError(error, context);

      expect(wrapped.context).toEqual(context);
    });

    it('should include context for Azure errors with known codes', () => {
      const azureError = new MockServiceBusError('Lock lost', 'MessageLockLost');
      const context = { topic: 'orders' };
      const wrapped = wrapError(azureError, context);

      // MessageLockLostError stores messageId separately from context
      // The passed context should be included in the wrapped error's context
      expect(wrapped.context).toMatchObject(context);
    });
  });

  describe('isTransientError', () => {
    it('should return isTransient from ServiceBusTransportError', () => {
      const transientError = new ServiceBusTransportError(
        'Test',
        ServiceBusTransportErrorCode.UNKNOWN,
        { isTransient: true },
      );
      expect(isTransientError(transientError)).toBe(true);

      const nonTransientError = new ServiceBusTransportError(
        'Test',
        ServiceBusTransportErrorCode.UNKNOWN,
        { isTransient: false },
      );
      expect(isTransientError(nonTransientError)).toBe(false);
    });

    it('should identify transient Azure error codes', () => {
      expect(isTransientError(new MockServiceBusError('t', 'ServiceTimeout'))).toBe(true);
      expect(isTransientError(new MockServiceBusError('t', 'ServiceCommunicationProblem'))).toBe(
        true,
      );
      expect(isTransientError(new MockServiceBusError('t', 'GeneralError'))).toBe(true);
      expect(isTransientError(new MockServiceBusError('t', 'SessionCannotBeLocked'))).toBe(true);
    });

    it('should identify non-transient Azure error codes', () => {
      expect(isTransientError(new MockServiceBusError('t', 'MessageLockLost'))).toBe(false);
      expect(isTransientError(new MockServiceBusError('t', 'UnauthorizedAccess'))).toBe(false);
      expect(isTransientError(new MockServiceBusError('t', 'QuotaExceeded'))).toBe(false);
    });

    it('should return false for non-ServiceBus errors', () => {
      expect(isTransientError(new Error('Test'))).toBe(false);
      expect(isTransientError('string')).toBe(false);
      expect(isTransientError(null)).toBe(false);
    });
  });

  describe('serializeError', () => {
    it('should serialize ServiceBusTransportError using toJSON', () => {
      const error = new ServiceBusTransportError(
        'Test error',
        ServiceBusTransportErrorCode.UNKNOWN,
        { isTransient: true, context: { key: 'value' } },
      );

      const serialized = serializeError(error);

      expect(serialized).toEqual({
        name: 'ServiceBusTransportError',
        message: 'Test error',
        code: ServiceBusTransportErrorCode.UNKNOWN,
        isTransient: true,
        context: { key: 'value' },
        originalError: undefined,
      });
    });

    it('should serialize regular Error', () => {
      const error = new Error('Regular error');
      error.stack = 'stack trace';

      const serialized = serializeError(error);

      expect(serialized).toEqual({
        name: 'Error',
        message: 'Regular error',
        stack: 'stack trace',
      });
    });

    it('should serialize non-Error values', () => {
      expect(serializeError('string error')).toEqual({ message: 'string error' });
      expect(serializeError(123)).toEqual({ message: '123' });
      expect(serializeError(null)).toEqual({ message: 'null' });
    });
  });

  describe('deserializeError', () => {
    it('should create ServiceBusTransportError when code is present', () => {
      const data = {
        message: 'Test error',
        code: ServiceBusTransportErrorCode.CONNECTION_FAILED,
        isTransient: true,
        context: { key: 'value' },
      };

      const error = deserializeError(data);

      expect(error).toBeInstanceOf(ServiceBusTransportError);
      expect((error as ServiceBusTransportError).code).toBe(
        ServiceBusTransportErrorCode.CONNECTION_FAILED,
      );
      expect((error as ServiceBusTransportError).isTransient).toBe(true);
      expect((error as ServiceBusTransportError).context).toEqual({ key: 'value' });
    });

    it('should create regular Error when no code is present', () => {
      const data = {
        name: 'TypeError',
        message: 'Type error',
      };

      const error = deserializeError(data);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('TypeError');
      expect(error.message).toBe('Type error');
    });

    it('should handle missing message', () => {
      const error = deserializeError({});

      expect(error.message).toBe('Unknown error');
      expect(error.name).toBe('Error');
    });

    it('should handle missing name', () => {
      const data = { message: 'Test' };
      const error = deserializeError(data);

      expect(error.name).toBe('Error');
    });

    it('should default isTransient to false when code is present', () => {
      const data = {
        message: 'Test',
        code: ServiceBusTransportErrorCode.UNKNOWN,
      };

      const error = deserializeError(data) as ServiceBusTransportError;

      expect(error.isTransient).toBe(false);
    });
  });
});
