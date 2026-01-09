import {
  ServiceBusTransportError,
  ServiceBusTransportErrorCode,
} from '../../../src/errors/service-bus-transport.error';
import {
  ServiceBusConnectionError,
  ServiceBusAuthenticationError,
  ServiceBusConnectionLostError,
} from '../../../src/errors/connection.error';
import {
  ServiceBusTimeoutError,
  ServiceBusQuotaExceededError,
  ServiceBusEntityNotFoundError,
} from '../../../src/errors/operation.error';
import {
  ServiceBusSessionLockLostError,
  ServiceBusSessionCannotBeLockedError,
  ServiceBusSessionTimeoutError,
} from '../../../src/errors/session.error';
import {
  ServiceBusMessageSettlementError,
  ServiceBusMessageLockLostError,
  ServiceBusMessageTooLargeError,
  ServiceBusSerializationError,
  ServiceBusDeserializationError,
} from '../../../src/errors/message-settlement.error';

describe('Error Classes', () => {
  describe('ServiceBusTransportError (base class)', () => {
    it('should create with message and code', () => {
      const error = new ServiceBusTransportError(
        'Test error',
        ServiceBusTransportErrorCode.UNKNOWN,
      );

      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ServiceBusTransportErrorCode.UNKNOWN);
      expect(error.name).toBe('ServiceBusTransportError');
      expect(error.isTransient).toBe(false);
    });

    it('should accept original error', () => {
      const originalError = new Error('Original error');
      const error = new ServiceBusTransportError(
        'Wrapped error',
        ServiceBusTransportErrorCode.UNKNOWN,
        { originalError },
      );

      expect(error.originalError).toBe(originalError);
      expect(error.stack).toContain('Caused by:');
    });

    it('should accept context', () => {
      const context = { topic: 'orders', subscription: 'processor' };
      const error = new ServiceBusTransportError(
        'Error with context',
        ServiceBusTransportErrorCode.UNKNOWN,
        { context },
      );

      expect(error.context).toEqual(context);
    });

    it('should accept isTransient option', () => {
      const error = new ServiceBusTransportError(
        'Transient error',
        ServiceBusTransportErrorCode.UNKNOWN,
        { isTransient: true },
      );

      expect(error.isTransient).toBe(true);
    });

    it('should provide toJSON method', () => {
      const originalError = new Error('Original');
      const error = new ServiceBusTransportError(
        'Test error',
        ServiceBusTransportErrorCode.UNKNOWN,
        {
          originalError,
          context: { key: 'value' },
          isTransient: true,
        },
      );

      const json = error.toJSON();
      expect(json).toEqual({
        name: 'ServiceBusTransportError',
        message: 'Test error',
        code: ServiceBusTransportErrorCode.UNKNOWN,
        isTransient: true,
        context: { key: 'value' },
        originalError: {
          name: 'Error',
          message: 'Original',
        },
      });
    });

    it('should handle toJSON without original error', () => {
      const error = new ServiceBusTransportError(
        'Test error',
        ServiceBusTransportErrorCode.UNKNOWN,
      );

      const json = error.toJSON();
      expect(json.originalError).toBeUndefined();
    });

    it('should handle original error without stack', () => {
      const originalError = new Error('Original');
      delete originalError.stack;

      const error = new ServiceBusTransportError(
        'Wrapped error',
        ServiceBusTransportErrorCode.UNKNOWN,
        { originalError },
      );

      expect(error.stack).toBeDefined();
      expect(error.stack).not.toContain('Caused by:');
    });
  });

  describe('Connection Errors', () => {
    describe('ServiceBusConnectionError', () => {
      it('should create with default transient = true', () => {
        const error = new ServiceBusConnectionError('Connection failed');

        expect(error.message).toBe('Connection failed');
        expect(error.code).toBe(ServiceBusTransportErrorCode.CONNECTION_FAILED);
        expect(error.name).toBe('ServiceBusConnectionError');
        expect(error.isTransient).toBe(true);
      });

      it('should allow overriding isTransient', () => {
        const error = new ServiceBusConnectionError('Connection failed', {
          isTransient: false,
        });

        expect(error.isTransient).toBe(false);
      });

      it('should accept original error and context', () => {
        const originalError = new Error('Network error');
        const error = new ServiceBusConnectionError('Connection failed', {
          originalError,
          context: { endpoint: 'sb://test.servicebus.windows.net' },
        });

        expect(error.originalError).toBe(originalError);
        expect(error.context).toEqual({ endpoint: 'sb://test.servicebus.windows.net' });
      });
    });

    describe('ServiceBusAuthenticationError', () => {
      it('should create with isTransient = false', () => {
        const error = new ServiceBusAuthenticationError('Auth failed');

        expect(error.message).toBe('Auth failed');
        expect(error.code).toBe(ServiceBusTransportErrorCode.AUTHENTICATION_FAILED);
        expect(error.name).toBe('ServiceBusAuthenticationError');
        expect(error.isTransient).toBe(false);
      });

      it('should accept original error and context', () => {
        const originalError = new Error('Invalid credentials');
        const error = new ServiceBusAuthenticationError('Auth failed', {
          originalError,
          context: { method: 'connection-string' },
        });

        expect(error.originalError).toBe(originalError);
        expect(error.context).toEqual({ method: 'connection-string' });
      });
    });

    describe('ServiceBusConnectionLostError', () => {
      it('should create with isTransient = true', () => {
        const error = new ServiceBusConnectionLostError('Connection lost');

        expect(error.message).toBe('Connection lost');
        expect(error.code).toBe(ServiceBusTransportErrorCode.CONNECTION_LOST);
        expect(error.name).toBe('ServiceBusConnectionLostError');
        expect(error.isTransient).toBe(true);
      });

      it('should accept original error and context', () => {
        const originalError = new Error('Socket closed');
        const error = new ServiceBusConnectionLostError('Connection lost', {
          originalError,
          context: { reconnectAttempt: 3 },
        });

        expect(error.originalError).toBe(originalError);
        expect(error.context).toEqual({ reconnectAttempt: 3 });
      });
    });
  });

  describe('Operation Errors', () => {
    describe('ServiceBusTimeoutError', () => {
      it('should create with isTransient = true', () => {
        const error = new ServiceBusTimeoutError('Operation timed out');

        expect(error.message).toBe('Operation timed out');
        expect(error.code).toBe(ServiceBusTransportErrorCode.OPERATION_TIMEOUT);
        expect(error.name).toBe('ServiceBusTimeoutError');
        expect(error.isTransient).toBe(true);
      });

      it('should store timeout and operation info', () => {
        const error = new ServiceBusTimeoutError('Operation timed out', {
          timeoutMs: 30000,
          operation: 'send',
        });

        expect(error.timeoutMs).toBe(30000);
        expect(error.operation).toBe('send');
        expect(error.context).toEqual({
          timeoutMs: 30000,
          operation: 'send',
        });
      });

      it('should merge context with operation info', () => {
        const error = new ServiceBusTimeoutError('Operation timed out', {
          timeoutMs: 30000,
          operation: 'send',
          context: { topic: 'orders' },
        });

        expect(error.context).toEqual({
          topic: 'orders',
          timeoutMs: 30000,
          operation: 'send',
        });
      });
    });

    describe('ServiceBusQuotaExceededError', () => {
      it('should create with isTransient = false', () => {
        const error = new ServiceBusQuotaExceededError('Quota exceeded');

        expect(error.message).toBe('Quota exceeded');
        expect(error.code).toBe(ServiceBusTransportErrorCode.QUOTA_EXCEEDED);
        expect(error.name).toBe('ServiceBusQuotaExceededError');
        expect(error.isTransient).toBe(false);
      });

      it('should store quota type', () => {
        const error = new ServiceBusQuotaExceededError('Quota exceeded', {
          quotaType: 'message-count',
        });

        expect(error.quotaType).toBe('message-count');
        expect(error.context).toEqual({ quotaType: 'message-count' });
      });

      it('should merge context with quota type', () => {
        const error = new ServiceBusQuotaExceededError('Quota exceeded', {
          quotaType: 'message-count',
          context: { currentCount: 10000 },
        });

        expect(error.context).toEqual({
          currentCount: 10000,
          quotaType: 'message-count',
        });
      });
    });

    describe('ServiceBusEntityNotFoundError', () => {
      it('should create with isTransient = false', () => {
        const error = new ServiceBusEntityNotFoundError('Entity not found');

        expect(error.message).toBe('Entity not found');
        expect(error.code).toBe(ServiceBusTransportErrorCode.ENTITY_NOT_FOUND);
        expect(error.name).toBe('ServiceBusEntityNotFoundError');
        expect(error.isTransient).toBe(false);
      });

      it('should store entity name and type', () => {
        const error = new ServiceBusEntityNotFoundError('Topic not found', {
          entityName: 'orders',
          entityType: 'topic',
        });

        expect(error.entityName).toBe('orders');
        expect(error.entityType).toBe('topic');
        expect(error.context).toEqual({
          entityName: 'orders',
          entityType: 'topic',
        });
      });

      it('should handle subscription entity type', () => {
        const error = new ServiceBusEntityNotFoundError('Subscription not found', {
          entityName: 'processor',
          entityType: 'subscription',
          context: { topic: 'orders' },
        });

        expect(error.entityType).toBe('subscription');
        expect(error.context).toEqual({
          topic: 'orders',
          entityName: 'processor',
          entityType: 'subscription',
        });
      });

      it('should handle queue entity type', () => {
        const error = new ServiceBusEntityNotFoundError('Queue not found', {
          entityName: 'my-queue',
          entityType: 'queue',
        });

        expect(error.entityType).toBe('queue');
      });
    });
  });

  describe('Session Errors', () => {
    describe('ServiceBusSessionLockLostError', () => {
      it('should create with isTransient = true', () => {
        const error = new ServiceBusSessionLockLostError('Session lock lost');

        expect(error.message).toBe('Session lock lost');
        expect(error.code).toBe(ServiceBusTransportErrorCode.SESSION_LOCK_LOST);
        expect(error.name).toBe('ServiceBusSessionLockLostError');
        expect(error.isTransient).toBe(true);
      });

      it('should store session ID', () => {
        const error = new ServiceBusSessionLockLostError('Session lock lost', {
          sessionId: 'session-123',
        });

        expect(error.sessionId).toBe('session-123');
        expect(error.context).toEqual({ sessionId: 'session-123' });
      });

      it('should merge context with session ID', () => {
        const error = new ServiceBusSessionLockLostError('Session lock lost', {
          sessionId: 'session-123',
          context: { subscription: 'processor' },
        });

        expect(error.context).toEqual({
          subscription: 'processor',
          sessionId: 'session-123',
        });
      });
    });

    describe('ServiceBusSessionCannotBeLockedError', () => {
      it('should create with isTransient = true', () => {
        const error = new ServiceBusSessionCannotBeLockedError('Cannot lock session');

        expect(error.message).toBe('Cannot lock session');
        expect(error.code).toBe(ServiceBusTransportErrorCode.SESSION_CANNOT_BE_LOCKED);
        expect(error.name).toBe('ServiceBusSessionCannotBeLockedError');
        expect(error.isTransient).toBe(true);
      });

      it('should store session ID', () => {
        const error = new ServiceBusSessionCannotBeLockedError('Cannot lock session', {
          sessionId: 'session-456',
        });

        expect(error.sessionId).toBe('session-456');
        expect(error.context).toEqual({ sessionId: 'session-456' });
      });

      it('should accept original error', () => {
        const originalError = new Error('Session already locked');
        const error = new ServiceBusSessionCannotBeLockedError('Cannot lock session', {
          originalError,
          sessionId: 'session-456',
        });

        expect(error.originalError).toBe(originalError);
      });
    });

    describe('ServiceBusSessionTimeoutError', () => {
      it('should create with isTransient = true', () => {
        const error = new ServiceBusSessionTimeoutError('Session timeout');

        expect(error.message).toBe('Session timeout');
        expect(error.code).toBe(ServiceBusTransportErrorCode.SESSION_TIMEOUT);
        expect(error.name).toBe('ServiceBusSessionTimeoutError');
        expect(error.isTransient).toBe(true);
      });

      it('should store session ID and timeout', () => {
        const error = new ServiceBusSessionTimeoutError('Session timeout', {
          sessionId: 'session-789',
          timeoutMs: 60000,
        });

        expect(error.sessionId).toBe('session-789');
        expect(error.timeoutMs).toBe(60000);
        expect(error.context).toEqual({
          sessionId: 'session-789',
          timeoutMs: 60000,
        });
      });

      it('should merge context with session info', () => {
        const error = new ServiceBusSessionTimeoutError('Session timeout', {
          sessionId: 'session-789',
          timeoutMs: 60000,
          context: { operation: 'receive' },
        });

        expect(error.context).toEqual({
          operation: 'receive',
          sessionId: 'session-789',
          timeoutMs: 60000,
        });
      });
    });
  });

  describe('Message Settlement Errors', () => {
    describe('ServiceBusMessageSettlementError', () => {
      it('should create with required action', () => {
        const error = new ServiceBusMessageSettlementError('Settlement failed', 'complete');

        expect(error.message).toBe('Settlement failed');
        expect(error.code).toBe(ServiceBusTransportErrorCode.MESSAGE_SETTLEMENT_FAILED);
        expect(error.name).toBe('ServiceBusMessageSettlementError');
        expect(error.action).toBe('complete');
        expect(error.isTransient).toBe(false);
      });

      it.each(['complete', 'abandon', 'defer', 'deadLetter'] as const)(
        'should handle action: %s',
        (action) => {
          const error = new ServiceBusMessageSettlementError(`${action} failed`, action);

          expect(error.action).toBe(action);
        },
      );

      it('should store message ID', () => {
        const error = new ServiceBusMessageSettlementError('Settlement failed', 'complete', {
          messageId: 'msg-123',
        });

        expect(error.messageId).toBe('msg-123');
        expect(error.context).toEqual({
          action: 'complete',
          messageId: 'msg-123',
        });
      });

      it('should accept original error', () => {
        const originalError = new Error('Lock expired');
        const error = new ServiceBusMessageSettlementError('Settlement failed', 'complete', {
          originalError,
        });

        expect(error.originalError).toBe(originalError);
      });
    });

    describe('ServiceBusMessageLockLostError', () => {
      it('should create with isTransient = false', () => {
        const error = new ServiceBusMessageLockLostError('Lock lost');

        expect(error.message).toBe('Lock lost');
        expect(error.code).toBe(ServiceBusTransportErrorCode.MESSAGE_LOCK_LOST);
        expect(error.name).toBe('ServiceBusMessageLockLostError');
        expect(error.isTransient).toBe(false);
      });

      it('should store message ID', () => {
        const error = new ServiceBusMessageLockLostError('Lock lost', {
          messageId: 'msg-456',
        });

        expect(error.messageId).toBe('msg-456');
        expect(error.context).toEqual({ messageId: 'msg-456' });
      });

      it('should accept original error and context', () => {
        const originalError = new Error('Lock token expired');
        const error = new ServiceBusMessageLockLostError('Lock lost', {
          originalError,
          context: { subscription: 'processor' },
          messageId: 'msg-456',
        });

        expect(error.originalError).toBe(originalError);
        expect(error.context).toEqual({
          subscription: 'processor',
          messageId: 'msg-456',
        });
      });
    });

    describe('ServiceBusMessageTooLargeError', () => {
      it('should create with isTransient = false', () => {
        const error = new ServiceBusMessageTooLargeError('Message too large');

        expect(error.message).toBe('Message too large');
        expect(error.code).toBe(ServiceBusTransportErrorCode.MESSAGE_TOO_LARGE);
        expect(error.name).toBe('ServiceBusMessageTooLargeError');
        expect(error.isTransient).toBe(false);
      });

      it('should store message size and max size', () => {
        const error = new ServiceBusMessageTooLargeError('Message too large', {
          messageSize: 300000,
          maxSize: 256000,
        });

        expect(error.messageSize).toBe(300000);
        expect(error.maxSize).toBe(256000);
        expect(error.context).toEqual({
          messageSize: 300000,
          maxSize: 256000,
        });
      });

      it('should merge context with size info', () => {
        const error = new ServiceBusMessageTooLargeError('Message too large', {
          messageSize: 300000,
          maxSize: 256000,
          context: { topic: 'orders' },
        });

        expect(error.context).toEqual({
          topic: 'orders',
          messageSize: 300000,
          maxSize: 256000,
        });
      });
    });

    describe('ServiceBusSerializationError', () => {
      it('should create with isTransient = false', () => {
        const error = new ServiceBusSerializationError('Serialization failed');

        expect(error.message).toBe('Serialization failed');
        expect(error.code).toBe(ServiceBusTransportErrorCode.MESSAGE_SERIALIZATION_FAILED);
        expect(error.name).toBe('ServiceBusSerializationError');
        expect(error.isTransient).toBe(false);
      });

      it('should accept original error', () => {
        const originalError = new TypeError('Cannot serialize undefined');
        const error = new ServiceBusSerializationError('Serialization failed', {
          originalError,
        });

        expect(error.originalError).toBe(originalError);
      });

      it('should accept context', () => {
        const error = new ServiceBusSerializationError('Serialization failed', {
          context: { dataType: 'circular-object' },
        });

        expect(error.context).toEqual({ dataType: 'circular-object' });
      });
    });

    describe('ServiceBusDeserializationError', () => {
      it('should create with isTransient = false', () => {
        const error = new ServiceBusDeserializationError('Deserialization failed');

        expect(error.message).toBe('Deserialization failed');
        expect(error.code).toBe(ServiceBusTransportErrorCode.MESSAGE_DESERIALIZATION_FAILED);
        expect(error.name).toBe('ServiceBusDeserializationError');
        expect(error.isTransient).toBe(false);
      });

      it('should accept original error', () => {
        const originalError = new SyntaxError('Unexpected token');
        const error = new ServiceBusDeserializationError('Deserialization failed', {
          originalError,
        });

        expect(error.originalError).toBe(originalError);
      });

      it('should accept context', () => {
        const error = new ServiceBusDeserializationError('Deserialization failed', {
          context: { messageId: 'msg-789', body: 'invalid-json' },
        });

        expect(error.context).toEqual({
          messageId: 'msg-789',
          body: 'invalid-json',
        });
      });
    });
  });

  describe('ServiceBusTransportErrorCode enum', () => {
    it('should have all expected error codes', () => {
      expect(ServiceBusTransportErrorCode.CONNECTION_FAILED).toBe('CONNECTION_FAILED');
      expect(ServiceBusTransportErrorCode.CONNECTION_LOST).toBe('CONNECTION_LOST');
      expect(ServiceBusTransportErrorCode.AUTHENTICATION_FAILED).toBe('AUTHENTICATION_FAILED');
      expect(ServiceBusTransportErrorCode.MESSAGE_SETTLEMENT_FAILED).toBe(
        'MESSAGE_SETTLEMENT_FAILED',
      );
      expect(ServiceBusTransportErrorCode.MESSAGE_LOCK_LOST).toBe('MESSAGE_LOCK_LOST');
      expect(ServiceBusTransportErrorCode.MESSAGE_TOO_LARGE).toBe('MESSAGE_TOO_LARGE');
      expect(ServiceBusTransportErrorCode.MESSAGE_SERIALIZATION_FAILED).toBe(
        'MESSAGE_SERIALIZATION_FAILED',
      );
      expect(ServiceBusTransportErrorCode.MESSAGE_DESERIALIZATION_FAILED).toBe(
        'MESSAGE_DESERIALIZATION_FAILED',
      );
      expect(ServiceBusTransportErrorCode.SESSION_LOCK_LOST).toBe('SESSION_LOCK_LOST');
      expect(ServiceBusTransportErrorCode.SESSION_CANNOT_BE_LOCKED).toBe(
        'SESSION_CANNOT_BE_LOCKED',
      );
      expect(ServiceBusTransportErrorCode.SESSION_TIMEOUT).toBe('SESSION_TIMEOUT');
      expect(ServiceBusTransportErrorCode.OPERATION_TIMEOUT).toBe('OPERATION_TIMEOUT');
      expect(ServiceBusTransportErrorCode.QUOTA_EXCEEDED).toBe('QUOTA_EXCEEDED');
      expect(ServiceBusTransportErrorCode.ENTITY_NOT_FOUND).toBe('ENTITY_NOT_FOUND');
      expect(ServiceBusTransportErrorCode.UNKNOWN).toBe('UNKNOWN');
    });
  });
});
