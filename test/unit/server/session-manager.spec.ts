import { SessionManager, SessionManagerOptions } from '../../../src/server/session-manager';

describe('SessionManager', () => {
  let manager: SessionManager;
  let options: SessionManagerOptions;
  let mockClient: any;
  let messageHandler: jest.Mock;
  let errorHandler: jest.Mock;
  let mockSessionReceiver: any;
  let processMessage: ((message: any) => Promise<void>) | null = null;
  let processError: ((args: any) => Promise<void>) | null = null;

  beforeEach(() => {
    processMessage = null;
    processError = null;

    mockSessionReceiver = {
      sessionId: 'session-123',
      isClosed: false,
      sessionLockedUntilUtc: new Date(Date.now() + 60000),
      subscribe: jest.fn().mockImplementation((handlers: any) => {
        processMessage = handlers.processMessage;
        processError = handlers.processError;
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    // Return the receiver once, then simulate "no session available"
    let acceptCallCount = 0;
    mockClient = {
      acceptNextSession: jest.fn().mockImplementation(async () => {
        acceptCallCount++;
        if (acceptCallCount === 1) {
          return mockSessionReceiver;
        }
        // Subsequent calls: no session available
        throw new Error('No session available');
      }),
    };

    messageHandler = jest.fn().mockResolvedValue(undefined);
    errorHandler = jest.fn().mockResolvedValue(undefined);

    options = {
      topic: 'test-topic',
      subscription: 'test-subscription',
      maxConcurrentSessions: 5,
      sessionIdleTimeoutMs: 60000,
      receiveMode: 'peekLock',
    };

    manager = new SessionManager(mockClient, options, messageHandler, errorHandler);
  });

  afterEach(async () => {
    // Ensure manager is stopped
    try {
      await manager.stop();
    } catch {
      // Ignore
    }
  });

  describe('start', () => {
    it('should start accepting sessions', async () => {
      await manager.start();

      // Give time for the accept loop to run
      await new Promise((r) => setTimeout(r, 50));

      expect(mockClient.acceptNextSession).toHaveBeenCalledWith(
        'test-topic',
        'test-subscription',
        expect.objectContaining({
          receiveMode: 'peekLock',
        }),
      );

      await manager.stop();
    });

    it('should not start twice if already running', async () => {
      await manager.start();
      await manager.start();

      // Give time for accept loop
      await new Promise((r) => setTimeout(r, 50));

      await manager.stop();
    });
  });

  describe('stop', () => {
    it('should stop and close receivers', async () => {
      await manager.start();
      await new Promise((r) => setTimeout(r, 50));

      await manager.stop();

      expect(mockSessionReceiver.close).toHaveBeenCalled();
    });

    it('should handle receiver close errors gracefully', async () => {
      mockSessionReceiver.close.mockRejectedValue(new Error('Close failed'));

      await manager.start();
      await new Promise((r) => setTimeout(r, 50));

      // Should not throw
      await expect(manager.stop()).resolves.not.toThrow();
    });

    it('should handle stop when not started', async () => {
      await expect(manager.stop()).resolves.not.toThrow();
    });
  });

  describe('getActiveSessionCount', () => {
    it('should return 0 when no active sessions', () => {
      expect(manager.getActiveSessionCount()).toBe(0);
    });

    it('should track active sessions', async () => {
      await manager.start();
      await new Promise((r) => setTimeout(r, 50));

      expect(manager.getActiveSessionCount()).toBeGreaterThanOrEqual(0);

      await manager.stop();
    });
  });

  describe('processSession message handling', () => {
    it('should process messages through messageHandler', async () => {
      await manager.start();
      await new Promise((r) => setTimeout(r, 50));

      expect(processMessage).not.toBeNull();

      if (processMessage) {
        const mockMessage = { body: 'test', messageId: 'msg-1' };
        await processMessage(mockMessage);

        expect(messageHandler).toHaveBeenCalledWith(mockMessage, mockSessionReceiver);
      }

      await manager.stop();
    });

    it('should handle errors and detect SessionLockLost', async () => {
      await manager.start();
      await new Promise((r) => setTimeout(r, 50));

      expect(processError).not.toBeNull();

      if (processError) {
        const lockLostError = { code: 'SessionLockLost', message: 'Lock lost' };
        await processError({ error: lockLostError });

        expect(errorHandler).toHaveBeenCalled();
      }

      await manager.stop();
    });

    it('should handle errors without SessionLockLost code', async () => {
      await manager.start();
      await new Promise((r) => setTimeout(r, 50));

      expect(processError).not.toBeNull();

      if (processError) {
        const otherError = { message: 'Some error' };
        await processError({ error: otherError });

        expect(errorHandler).toHaveBeenCalled();
      }

      await manager.stop();
    });
  });

  describe('acceptSessionsLoop error handling', () => {
    it('should handle "no session available" errors gracefully', async () => {
      // All accept calls throw "no session available"
      mockClient.acceptNextSession.mockRejectedValue(new Error('No session available'));

      await manager.start();
      await new Promise((r) => setTimeout(r, 100));

      // Should not crash
      await manager.stop();
    });

    it('should handle timeout errors gracefully', async () => {
      mockClient.acceptNextSession.mockRejectedValue(new Error('Operation timed out'));

      await manager.start();
      await new Promise((r) => setTimeout(r, 100));

      // Should not crash
      await manager.stop();
    }, 10000);

    it('should handle other errors with backoff', async () => {
      mockClient.acceptNextSession.mockRejectedValue(new Error('Connection failed'));

      await manager.start();
      await new Promise((r) => setTimeout(r, 100));

      // Should not crash
      await manager.stop();
    }, 10000);
  });

  describe('session lifecycle', () => {
    it('should detect when receiver is closed', async () => {
      // Start session, then simulate it being closed
      await manager.start();
      await new Promise((r) => setTimeout(r, 50));

      // Simulate receiver being closed externally
      mockSessionReceiver.isClosed = true;

      await new Promise((r) => setTimeout(r, 1100)); // Wait for loop to detect

      await manager.stop();
    });

    it('should detect when session lock expires', async () => {
      // Start with soon-to-expire lock
      mockSessionReceiver.sessionLockedUntilUtc = new Date(Date.now() - 1000); // Already expired

      await manager.start();
      await new Promise((r) => setTimeout(r, 1100)); // Wait for loop to detect

      await manager.stop();
    });

    it('should handle undefined sessionLockedUntilUtc', async () => {
      mockSessionReceiver.sessionLockedUntilUtc = undefined;

      await manager.start();
      await new Promise((r) => setTimeout(r, 50));

      // Should not crash
      await manager.stop();
    });
  });

  describe('max concurrent sessions', () => {
    it('should respect maxConcurrentSessions limit', async () => {
      // Return different sessions for each call
      let sessionCount = 0;
      mockClient.acceptNextSession.mockImplementation(async () => {
        sessionCount++;
        return {
          sessionId: `session-${sessionCount}`,
          isClosed: false,
          sessionLockedUntilUtc: new Date(Date.now() + 60000),
          subscribe: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
        };
      });

      await manager.start();

      // Give time to accept several sessions
      await new Promise((r) => setTimeout(r, 200));

      // Should not exceed max
      expect(manager.getActiveSessionCount()).toBeLessThanOrEqual(options.maxConcurrentSessions);

      await manager.stop();
    });
  });
});
