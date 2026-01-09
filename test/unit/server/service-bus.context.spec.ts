import { ServiceBusContext, ServiceBusContextArgs } from '../../../src/server/service-bus.context';
import { createMockMessage, createMockReceiver } from '../../mocks';
import { createMockSessionReceiver } from '../../mocks/service-bus-session-receiver.mock';
import { MESSAGE_PROPERTIES } from '../../../src/constants';
import {
  ServiceBusMessageSettlementError,
  ServiceBusSessionLockLostError,
} from '../../../src/errors';

describe('ServiceBusContext', () => {
  describe('basic getters', () => {
    it('should return the message', () => {
      const message = createMockMessage({ body: { test: 'data' } });
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      expect(ctx.getMessage()).toBe(message);
    });

    it('should return the receiver', () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      expect(ctx.getReceiver()).toBe(receiver);
    });

    it('should return the topic', () => {
      const ctx = createContext({ topic: 'my-topic' });
      expect(ctx.getTopic()).toBe('my-topic');
    });

    it('should return the subscription', () => {
      const ctx = createContext({ subscription: 'my-subscription' });
      expect(ctx.getSubscription()).toBe('my-subscription');
    });

    it('should return the pattern from message', () => {
      const message = createMockMessage({ pattern: 'order.created' });
      const ctx = createContext({ message });

      expect(ctx.getPattern()).toBe('order.created');
    });

    it('should return empty string if pattern not set', () => {
      const message = createMockMessage({ applicationProperties: {} });
      const ctx = createContext({ message });

      expect(ctx.getPattern()).toBe('');
    });

    it('should return the data (body)', () => {
      const message = createMockMessage({ body: { orderId: '123' } });
      const ctx = createContext({ message });

      expect(ctx.getData()).toEqual({ orderId: '123' });
    });

    it('should return the correlation ID', () => {
      const message = createMockMessage({ correlationId: 'corr-123' });
      const ctx = createContext({ message });

      expect(ctx.getCorrelationId()).toBe('corr-123');
    });

    it('should return the message ID', () => {
      const message = createMockMessage({ messageId: 'msg-123' });
      const ctx = createContext({ message });

      expect(ctx.getMessageId()).toBe('msg-123');
    });

    it('should return delivery count', () => {
      const message = createMockMessage({ deliveryCount: 3 });
      const ctx = createContext({ message });

      expect(ctx.getDeliveryCount()).toBe(3);
    });

    it('should return enqueued time', () => {
      const enqueuedTime = new Date('2024-01-01');
      const message = createMockMessage({ enqueuedTimeUtc: enqueuedTime });
      const ctx = createContext({ message });

      expect(ctx.getEnqueuedTime()).toEqual(enqueuedTime);
    });

    it('should return application properties', () => {
      const message = createMockMessage({
        applicationProperties: {
          [MESSAGE_PROPERTIES.NESTJS_MARKER]: true,
          customKey: 'customValue',
        },
      });
      const ctx = createContext({ message });

      expect(ctx.getApplicationProperties()).toEqual({
        [MESSAGE_PROPERTIES.NESTJS_MARKER]: true,
        customKey: 'customValue',
      });
    });

    it('should return a specific application property', () => {
      const message = createMockMessage({
        applicationProperties: { myProp: 42 },
      });
      const ctx = createContext({ message });

      expect(ctx.getApplicationProperty<number>('myProp')).toBe(42);
      expect(ctx.getApplicationProperty('nonexistent')).toBeUndefined();
    });
  });

  describe('dead letter queue', () => {
    it('should indicate if message is from DLQ', () => {
      const ctx = createContext({ isDeadLetter: true });
      expect(ctx.isFromDeadLetterQueue()).toBe(true);
    });

    it('should indicate if message is not from DLQ', () => {
      const ctx = createContext({ isDeadLetter: false });
      expect(ctx.isFromDeadLetterQueue()).toBe(false);
    });

    it('should return dead letter reason', () => {
      const message = createMockMessage({ deadLetterReason: 'MaxDeliveryCount' });
      const ctx = createContext({ message, isDeadLetter: true });

      expect(ctx.getDeadLetterReason()).toBe('MaxDeliveryCount');
    });

    it('should return dead letter error description', () => {
      const message = createMockMessage({
        deadLetterErrorDescription: 'Message exceeded max delivery count',
      });
      const ctx = createContext({ message, isDeadLetter: true });

      expect(ctx.getDeadLetterErrorDescription()).toBe('Message exceeded max delivery count');
    });
  });

  describe('settlement methods', () => {
    it('should complete message', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.complete();

      expect(receiver.completeMessage).toHaveBeenCalledWith(message);
      expect(ctx.isSettled()).toBe(true);
    });

    it('should not complete twice', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.complete();
      await ctx.complete();

      expect(receiver.completeMessage).toHaveBeenCalledTimes(1);
    });

    it('should throw on complete error', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      receiver.completeMessage.mockRejectedValueOnce(new Error('Lock expired'));
      const ctx = createContext({ message, receiver });

      await expect(ctx.complete()).rejects.toThrow(ServiceBusMessageSettlementError);
    });

    it('should abandon message', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.abandon({ propertiesToModify: { retryCount: 1 } });

      expect(receiver.abandonMessage).toHaveBeenCalledWith(message, { retryCount: 1 });
      expect(ctx.isSettled()).toBe(true);
    });

    it('should defer message', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.defer({ propertiesToModify: { reason: 'waiting' } });

      expect(receiver.deferMessage).toHaveBeenCalledWith(message, { reason: 'waiting' });
      expect(ctx.isSettled()).toBe(true);
    });

    it('should dead-letter message', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.deadLetter({
        deadLetterReason: 'Invalid format',
        deadLetterErrorDescription: 'Missing required field',
      });

      expect(receiver.deadLetterMessage).toHaveBeenCalledWith(message, {
        deadLetterReason: 'Invalid format',
        deadLetterErrorDescription: 'Missing required field',
      });
      expect(ctx.isSettled()).toBe(true);
    });

    it('should dead-letter message with default values', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.deadLetter();

      expect(receiver.deadLetterMessage).toHaveBeenCalledWith(message, {
        deadLetterReason: 'Unspecified',
        deadLetterErrorDescription: '',
      });
    });

    it('should renew message lock', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const newLockTime = new Date(Date.now() + 60000);
      receiver.renewMessageLock.mockResolvedValueOnce(newLockTime);
      const ctx = createContext({ message, receiver });

      const result = await ctx.renewLock();

      expect(receiver.renewMessageLock).toHaveBeenCalledWith(message);
      expect(result).toEqual(newLockTime);
    });
  });

  describe('session support', () => {
    it('should return session ID for session receiver', () => {
      const message = createMockMessage({ sessionId: 'session-123' });
      const receiver = createMockSessionReceiver('session-123');
      const ctx = createContext({ message, receiver });

      expect(ctx.getSessionId()).toBe('session-123');
    });

    it('should return session ID from message for non-session receiver', () => {
      const message = createMockMessage({ sessionId: 'session-from-msg' });
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      expect(ctx.getSessionId()).toBe('session-from-msg');
    });

    it('should identify session receiver', () => {
      const sessionReceiver = createMockSessionReceiver('session-123');
      const regularReceiver = createMockReceiver();

      const sessionCtx = createContext({ receiver: sessionReceiver });
      const regularCtx = createContext({ receiver: regularReceiver });

      expect(sessionCtx.isSessionReceiver()).toBe(true);
      expect(regularCtx.isSessionReceiver()).toBe(false);
    });

    it('should get session state', async () => {
      const receiver = createMockSessionReceiver('session-123');
      const stateBuffer = Buffer.from('test-state');
      receiver.getSessionState.mockResolvedValueOnce(stateBuffer);
      const ctx = createContext({ receiver });

      const state = await ctx.getSessionState();

      expect(state).toEqual(stateBuffer);
    });

    it('should return undefined for non-session receiver getSessionState', async () => {
      const receiver = createMockReceiver();
      const ctx = createContext({ receiver });

      const state = await ctx.getSessionState();

      expect(state).toBeUndefined();
    });

    it('should set session state', async () => {
      const receiver = createMockSessionReceiver('session-123');
      const ctx = createContext({ receiver });
      const newState = Buffer.from('new-state');

      await ctx.setSessionState(newState);

      expect(receiver.setSessionState).toHaveBeenCalledWith(newState);
    });

    it('should throw when setting session state on non-session receiver', async () => {
      const receiver = createMockReceiver();
      const ctx = createContext({ receiver });

      await expect(ctx.setSessionState(Buffer.from('state'))).rejects.toThrow(
        ServiceBusSessionLockLostError,
      );
    });

    it('should renew session lock', async () => {
      const receiver = createMockSessionReceiver('session-123');
      const newLockTime = new Date(Date.now() + 60000);
      receiver.renewSessionLock.mockResolvedValueOnce(newLockTime);
      const ctx = createContext({ receiver });

      const result = await ctx.renewSessionLock();

      expect(result).toEqual(newLockTime);
    });

    it('should throw when renewing session lock on non-session receiver', async () => {
      const receiver = createMockReceiver();
      const ctx = createContext({ receiver });

      await expect(ctx.renewSessionLock()).rejects.toThrow(ServiceBusSessionLockLostError);
    });

    it('should handle getSessionState errors', async () => {
      const receiver = createMockSessionReceiver('session-123');
      receiver.getSessionState.mockRejectedValueOnce(new Error('Session expired'));
      const ctx = createContext({ receiver });

      await expect(ctx.getSessionState()).rejects.toThrow();
    });

    it('should handle setSessionState errors', async () => {
      const receiver = createMockSessionReceiver('session-123');
      receiver.setSessionState.mockRejectedValueOnce(new Error('Session lock lost'));
      const ctx = createContext({ receiver });

      await expect(ctx.setSessionState(Buffer.from('state'))).rejects.toThrow();
    });

    it('should handle renewSessionLock errors', async () => {
      const receiver = createMockSessionReceiver('session-123');
      receiver.renewSessionLock.mockRejectedValueOnce(new Error('Session lock lost'));
      const ctx = createContext({ receiver });

      await expect(ctx.renewSessionLock()).rejects.toThrow();
    });

    it('should return null session state as undefined', async () => {
      const receiver = createMockSessionReceiver('session-123');
      receiver.getSessionState.mockResolvedValueOnce(null);
      const ctx = createContext({ receiver });

      const state = await ctx.getSessionState();
      expect(state).toBeUndefined();
    });
  });

  describe('settlement error handling', () => {
    it('should throw on abandon error', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      receiver.abandonMessage.mockRejectedValueOnce(new Error('Abandon failed'));
      const ctx = createContext({ message, receiver });

      await expect(ctx.abandon()).rejects.toThrow(ServiceBusMessageSettlementError);
    });

    it('should not abandon twice', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.abandon();
      await ctx.abandon();

      expect(receiver.abandonMessage).toHaveBeenCalledTimes(1);
    });

    it('should throw on defer error', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      receiver.deferMessage.mockRejectedValueOnce(new Error('Defer failed'));
      const ctx = createContext({ message, receiver });

      await expect(ctx.defer()).rejects.toThrow(ServiceBusMessageSettlementError);
    });

    it('should not defer twice', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.defer();
      await ctx.defer();

      expect(receiver.deferMessage).toHaveBeenCalledTimes(1);
    });

    it('should throw on deadLetter error', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      receiver.deadLetterMessage.mockRejectedValueOnce(new Error('Dead letter failed'));
      const ctx = createContext({ message, receiver });

      await expect(ctx.deadLetter()).rejects.toThrow(ServiceBusMessageSettlementError);
    });

    it('should not deadLetter twice', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.deadLetter();
      await ctx.deadLetter();

      expect(receiver.deadLetterMessage).toHaveBeenCalledTimes(1);
    });

    it('should throw on renewLock error', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      receiver.renewMessageLock.mockRejectedValueOnce(new Error('Lock renewal failed'));
      const ctx = createContext({ message, receiver });

      await expect(ctx.renewLock()).rejects.toThrow();
    });
  });

  describe('additional getters', () => {
    it('should return sequence number', () => {
      const message = createMockMessage({ sequenceNumber: 12345 });
      const ctx = createContext({ message });

      expect(ctx.getSequenceNumber()).toBe(BigInt(12345));
    });

    it('should return 0 for undefined sequence number', () => {
      const message = createMockMessage();
      (message as any).sequenceNumber = undefined;
      const ctx = createContext({ message });

      expect(ctx.getSequenceNumber()).toBe(BigInt(0));
    });

    it('should return locked until time', () => {
      const lockedUntil = new Date(Date.now() + 30000);
      const message = createMockMessage({ lockedUntilUtc: lockedUntil });
      const ctx = createContext({ message });

      expect(ctx.getLockedUntil()).toEqual(lockedUntil);
    });

    it('should return expires at time', () => {
      const message = createMockMessage();
      const ctx = createContext({ message });

      expect(ctx.getExpiresAt()).toBeInstanceOf(Date);
    });

    it('should return undefined message ID when not a string', () => {
      const message = createMockMessage();
      (message as any).messageId = undefined;
      const ctx = createContext({ message });

      expect(ctx.getMessageId()).toBeUndefined();
    });

    it('should return 0 for undefined delivery count', () => {
      const message = createMockMessage();
      (message as any).deliveryCount = undefined;
      const ctx = createContext({ message });

      expect(ctx.getDeliveryCount()).toBe(0);
    });

    it('should return empty application properties when undefined', () => {
      const message = createMockMessage();
      (message as any).applicationProperties = undefined;
      const ctx = createContext({ message });

      expect(ctx.getApplicationProperties()).toEqual({});
    });

    it('should handle deadLetter with propertiesToModify', async () => {
      const message = createMockMessage();
      const receiver = createMockReceiver();
      const ctx = createContext({ message, receiver });

      await ctx.deadLetter({
        deadLetterReason: 'Test',
        deadLetterErrorDescription: 'Test desc',
        propertiesToModify: { customProp: 'value' },
      });

      expect(receiver.deadLetterMessage).toHaveBeenCalledWith(message, {
        deadLetterReason: 'Test',
        deadLetterErrorDescription: 'Test desc',
        customProp: 'value',
      });
    });
  });
});

// Helper to create context with defaults
function createContext(overrides: Partial<ServiceBusContextArgs> = {}): ServiceBusContext {
  const defaults: ServiceBusContextArgs = {
    message: createMockMessage(),
    receiver: createMockReceiver(),
    topic: 'test-topic',
    subscription: 'test-subscription',
    isDeadLetter: false,
  };

  return new ServiceBusContext({ ...defaults, ...overrides });
}
