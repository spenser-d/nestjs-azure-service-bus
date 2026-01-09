import {
  ReplyQueueManager,
  ReplyQueueManagerOptions,
} from '../../../src/client/reply-queue-manager';
import { ServiceBusTimeoutError } from '../../../src/errors';

// Mock Azure SDK
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockSubscribe = jest.fn();
const mockReceiver = {
  subscribe: mockSubscribe,
  close: mockClose,
};

const mockCreateReceiver = jest.fn().mockReturnValue(mockReceiver);
const mockServiceBusClient = {
  createReceiver: mockCreateReceiver,
} as any;

describe('ReplyQueueManager', () => {
  let manager: ReplyQueueManager;
  let options: ReplyQueueManagerOptions;
  let processMessage: (message: any) => Promise<void>;
  let processError: (args: { error: Error }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    options = {
      replyTopic: 'test-topic',
      replySubscription: 'test-subscription',
      requestTimeout: 30000,
    };

    manager = new ReplyQueueManager(mockServiceBusClient, options);

    // Capture the handlers passed to subscribe
    mockSubscribe.mockImplementation((handlers, _opts) => {
      processMessage = handlers.processMessage;
      processError = handlers.processError;
      return { close: mockClose };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start', () => {
    it('should create receiver and start subscription', async () => {
      await manager.start();

      expect(mockCreateReceiver).toHaveBeenCalledWith('test-topic', 'test-subscription', {
        receiveMode: 'receiveAndDelete',
      });
      expect(mockSubscribe).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should close subscription and receiver', async () => {
      await manager.start();
      await manager.stop();

      expect(mockClose).toHaveBeenCalledTimes(2); // subscription and receiver
    });

    it('should cancel all pending requests', async () => {
      await manager.start();

      const callback = jest.fn();
      manager.registerPendingRequest('req-1', callback);
      manager.registerPendingRequest('req-2', callback);

      expect(manager.getPendingRequestCount()).toBe(2);

      await manager.stop();

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'req-1',
          err: expect.any(Error),
          isDisposed: true,
        }),
      );
      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should handle stop when not started', async () => {
      await expect(manager.stop()).resolves.not.toThrow();
    });
  });

  describe('getReplyTo', () => {
    it('should return the reply-to address', () => {
      const replyTo = manager.getReplyTo();
      expect(replyTo).toBe('test-topic/subscriptions/test-subscription');
    });
  });

  describe('registerPendingRequest', () => {
    it('should register a pending request', () => {
      const callback = jest.fn();
      manager.registerPendingRequest('correlation-123', callback);

      expect(manager.hasPendingRequests()).toBe(true);
      expect(manager.getPendingRequestCount()).toBe(1);
    });

    it('should return cleanup function', () => {
      const callback = jest.fn();
      const cleanup = manager.registerPendingRequest('correlation-123', callback);

      expect(typeof cleanup).toBe('function');
      expect(manager.getPendingRequestCount()).toBe(1);

      cleanup();

      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should handle timeout', async () => {
      const callback = jest.fn();
      manager.registerPendingRequest('correlation-123', callback, 1000);

      expect(callback).not.toHaveBeenCalled();

      // Advance timer past timeout
      jest.advanceTimersByTime(1001);

      expect(callback).toHaveBeenCalledWith({
        id: 'correlation-123',
        err: expect.any(ServiceBusTimeoutError),
        isDisposed: true,
      });
      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should use default timeout when not specified', async () => {
      const callback = jest.fn();
      manager.registerPendingRequest('correlation-123', callback);

      // Advance timer to just before default timeout
      jest.advanceTimersByTime(29999);
      expect(callback).not.toHaveBeenCalled();

      // Advance past default timeout (30000ms)
      jest.advanceTimersByTime(2);
      expect(callback).toHaveBeenCalled();
    });

    it('should clear timeout on cleanup', () => {
      const callback = jest.fn();
      const cleanup = manager.registerPendingRequest('correlation-123', callback, 1000);

      cleanup();

      // Advance timer past timeout
      jest.advanceTimersByTime(1001);

      // Callback should not be called since we cleaned up
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle cleanup called multiple times', () => {
      const callback = jest.fn();
      const cleanup = manager.registerPendingRequest('correlation-123', callback);

      cleanup();
      cleanup(); // Second call should be safe

      expect(manager.getPendingRequestCount()).toBe(0);
    });
  });

  describe('hasPendingRequests', () => {
    it('should return false when no pending requests', () => {
      expect(manager.hasPendingRequests()).toBe(false);
    });

    it('should return true when there are pending requests', () => {
      manager.registerPendingRequest('req-1', jest.fn());
      expect(manager.hasPendingRequests()).toBe(true);
    });
  });

  describe('getPendingRequestCount', () => {
    it('should return 0 when no pending requests', () => {
      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should return correct count', () => {
      manager.registerPendingRequest('req-1', jest.fn());
      manager.registerPendingRequest('req-2', jest.fn());
      manager.registerPendingRequest('req-3', jest.fn());

      expect(manager.getPendingRequestCount()).toBe(3);
    });
  });

  describe('handleResponse (via processMessage)', () => {
    beforeEach(async () => {
      await manager.start();
    });

    it('should invoke callback when response matches pending request', async () => {
      const callback = jest.fn();
      manager.registerPendingRequest('correlation-123', callback);

      await processMessage({
        correlationId: 'correlation-123',
        body: { result: 'success' },
        applicationProperties: {},
      });

      // Deserializer returns { data, id, pattern } format
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { result: 'success' },
          id: 'correlation-123',
        }),
      );
      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should ignore messages without correlation ID', async () => {
      const callback = jest.fn();
      manager.registerPendingRequest('correlation-123', callback);

      await processMessage({
        body: { response: 'data' },
        applicationProperties: {},
      });

      expect(callback).not.toHaveBeenCalled();
      expect(manager.getPendingRequestCount()).toBe(1);
    });

    it('should ignore messages with no matching pending request', async () => {
      const callback = jest.fn();
      manager.registerPendingRequest('correlation-123', callback);

      await processMessage({
        correlationId: 'different-correlation',
        body: { response: 'data' },
        applicationProperties: {},
      });

      expect(callback).not.toHaveBeenCalled();
      expect(manager.getPendingRequestCount()).toBe(1);
    });

    it('should handle deserialization errors', async () => {
      const callback = jest.fn();
      manager.registerPendingRequest('correlation-123', callback);

      // Pass invalid message structure to trigger deserialization error
      await processMessage({
        correlationId: 'correlation-123',
        // Missing body - might cause issues in deserializer
        body: undefined,
        applicationProperties: {},
      });

      // Callback should still be called (with error or result depending on deserializer behavior)
      expect(callback).toHaveBeenCalled();
      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should clear timeout when response is received', async () => {
      const callback = jest.fn();
      manager.registerPendingRequest('correlation-123', callback, 1000);

      await processMessage({
        correlationId: 'correlation-123',
        body: { response: 'data' },
        applicationProperties: {},
      });

      // Advance timer past timeout
      jest.advanceTimersByTime(1001);

      // Callback should only be called once (for the response, not timeout)
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('processError handler', () => {
    it('should log errors without crashing', async () => {
      await manager.start();

      // Should not throw
      await expect(processError({ error: new Error('Test error') })).resolves.not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    beforeEach(async () => {
      await manager.start();
    });

    it('should handle multiple concurrent requests', async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      manager.registerPendingRequest('req-1', callback1);
      manager.registerPendingRequest('req-2', callback2);
      manager.registerPendingRequest('req-3', callback3);

      expect(manager.getPendingRequestCount()).toBe(3);

      await processMessage({
        correlationId: 'req-2',
        body: { result: 'second' },
        applicationProperties: {},
      });

      expect(callback2).toHaveBeenCalled();
      expect(callback1).not.toHaveBeenCalled();
      expect(callback3).not.toHaveBeenCalled();
      expect(manager.getPendingRequestCount()).toBe(2);

      await processMessage({
        correlationId: 'req-1',
        body: { result: 'first' },
        applicationProperties: {},
      });

      expect(callback1).toHaveBeenCalled();
      expect(manager.getPendingRequestCount()).toBe(1);
    });

    it('should handle request timeout followed by late response', async () => {
      const callback = jest.fn();
      manager.registerPendingRequest('req-late', callback, 100);

      // Advance past timeout
      jest.advanceTimersByTime(101);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(ServiceBusTimeoutError),
        }),
      );

      // Late response arrives
      await processMessage({
        correlationId: 'req-late',
        body: { result: 'late' },
        applicationProperties: {},
      });

      // Callback should not be called again
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should handle request cancelled before response', async () => {
      const callback = jest.fn();
      const cleanup = manager.registerPendingRequest('req-cancel', callback);

      cleanup();

      // Response arrives after cancellation
      await processMessage({
        correlationId: 'req-cancel',
        body: { result: 'cancelled' },
        applicationProperties: {},
      });

      // Callback should not be called
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
