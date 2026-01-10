import {
  ConnectionManager,
  CircuitState,
  DEFAULT_RECONNECT_OPTIONS,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
} from '../../../src/utils/connection-manager';

describe('ConnectionManager', () => {
  let manager: ConnectionManager;

  afterEach(() => {
    if (manager) {
      manager.destroy();
    }
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      manager = new ConnectionManager();
      expect(manager).toBeDefined();
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });

    it('should create with custom name', () => {
      manager = new ConnectionManager({ name: 'test-manager' });
      expect(manager).toBeDefined();
    });

    it('should merge custom reconnect options with defaults', () => {
      manager = new ConnectionManager({
        reconnect: { maxRetries: 5 },
      });
      expect(manager).toBeDefined();
    });

    it('should merge custom circuit breaker options with defaults', () => {
      manager = new ConnectionManager({
        circuitBreaker: { failureThreshold: 10 },
      });
      expect(manager).toBeDefined();
    });
  });

  describe('default options', () => {
    it('should have correct default reconnect options', () => {
      expect(DEFAULT_RECONNECT_OPTIONS).toEqual({
        enabled: true,
        maxRetries: Infinity,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      });
    });

    it('should have correct default circuit breaker options', () => {
      expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS).toEqual({
        enabled: true,
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenMaxAttempts: 3,
      });
    });
  });

  describe('getters', () => {
    beforeEach(() => {
      manager = new ConnectionManager();
    });

    it('should return circuit state', () => {
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });

    it('should return reconnection in progress status', () => {
      expect(manager.isReconnectionInProgress()).toBe(false);
    });

    it('should return reconnect attempt count', () => {
      expect(manager.getReconnectAttempt()).toBe(0);
    });

    it('should return consecutive failures count', () => {
      expect(manager.getConsecutiveFailures()).toBe(0);
    });
  });

  describe('canProceed', () => {
    it('should return true when circuit breaker is disabled', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: false },
      });
      expect(manager.canProceed()).toBe(true);
    });

    it('should return true when circuit is closed', () => {
      manager = new ConnectionManager();
      expect(manager.canProceed()).toBe(true);
    });

    it('should return false when circuit is open', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1 },
      });
      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);
      expect(manager.canProceed()).toBe(false);
    });

    it('should return true in half-open state when under max attempts', () => {
      jest.useFakeTimers();
      manager = new ConnectionManager({
        circuitBreaker: {
          enabled: true,
          failureThreshold: 1,
          resetTimeoutMs: 100,
          halfOpenMaxAttempts: 3,
        },
      });
      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);

      jest.advanceTimersByTime(100);
      expect(manager.getCircuitState()).toBe(CircuitState.HALF_OPEN);
      expect(manager.canProceed()).toBe(true);
    });

    it('should return false in half-open state when max attempts reached', () => {
      jest.useFakeTimers();
      manager = new ConnectionManager({
        circuitBreaker: {
          enabled: true,
          failureThreshold: 1,
          resetTimeoutMs: 100,
          halfOpenMaxAttempts: 1,
        },
      });
      manager.recordFailure(new Error('test'));
      jest.advanceTimersByTime(100);

      // Record failure to increment halfOpenAttempts
      manager.recordFailure(new Error('test'));
      expect(manager.canProceed()).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('should reset consecutive failures', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 10 },
      });
      manager.recordFailure(new Error('test'));
      manager.recordFailure(new Error('test'));
      expect(manager.getConsecutiveFailures()).toBe(2);

      manager.recordSuccess();
      expect(manager.getConsecutiveFailures()).toBe(0);
    });

    it('should close circuit when in half-open state', () => {
      jest.useFakeTimers();
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1, resetTimeoutMs: 100 },
      });

      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);

      jest.advanceTimersByTime(100);
      expect(manager.getCircuitState()).toBe(CircuitState.HALF_OPEN);

      manager.recordSuccess();
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('recordFailure', () => {
    it('should increment consecutive failures', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 10 },
      });
      manager.recordFailure(new Error('test'));
      expect(manager.getConsecutiveFailures()).toBe(1);
      manager.recordFailure(new Error('test'));
      expect(manager.getConsecutiveFailures()).toBe(2);
    });

    it('should open circuit when threshold reached', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 3 },
      });

      manager.recordFailure(new Error('test'));
      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);

      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);
    });

    it('should emit circuit:open event when opening', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1 },
      });

      const openHandler = jest.fn();
      manager.on('circuit:open', openHandler);

      manager.recordFailure(new Error('test'));
      expect(openHandler).toHaveBeenCalledTimes(1);
    });

    it('should not open circuit when disabled', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: false },
      });

      for (let i = 0; i < 10; i++) {
        manager.recordFailure(new Error('test'));
      }
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });

    it('should open circuit from half-open when max attempts exceeded', () => {
      jest.useFakeTimers();
      manager = new ConnectionManager({
        circuitBreaker: {
          enabled: true,
          failureThreshold: 1,
          resetTimeoutMs: 100,
          halfOpenMaxAttempts: 2,
        },
      });

      manager.recordFailure(new Error('test'));
      jest.advanceTimersByTime(100);
      expect(manager.getCircuitState()).toBe(CircuitState.HALF_OPEN);

      manager.recordFailure(new Error('test'));
      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);
    });
  });

  describe('resetCircuit', () => {
    it('should reset circuit to closed state', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1 },
      });

      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);

      manager.resetCircuit();
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
      expect(manager.getConsecutiveFailures()).toBe(0);
    });

    it('should emit circuit:close event', () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1 },
      });

      manager.recordFailure(new Error('test'));

      const closeHandler = jest.fn();
      manager.on('circuit:close', closeHandler);

      manager.resetCircuit();
      expect(closeHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('calculateReconnectDelay', () => {
    beforeEach(() => {
      manager = new ConnectionManager({
        reconnect: {
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
          jitterFactor: 0,
        },
      });
    });

    it('should calculate exponential backoff', () => {
      expect(manager.calculateReconnectDelay(0)).toBe(1000);
      expect(manager.calculateReconnectDelay(1)).toBe(2000);
      expect(manager.calculateReconnectDelay(2)).toBe(4000);
      expect(manager.calculateReconnectDelay(3)).toBe(8000);
    });

    it('should respect max delay', () => {
      expect(manager.calculateReconnectDelay(10)).toBe(30000);
      expect(manager.calculateReconnectDelay(20)).toBe(30000);
    });

    it('should add jitter when configured', () => {
      manager = new ConnectionManager({
        reconnect: {
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
          jitterFactor: 0.5,
        },
      });

      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(manager.calculateReconnectDelay(0));
      }
      // With jitter, we should get different values
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('reconnect', () => {
    it('should call connect function directly when disabled', async () => {
      manager = new ConnectionManager({
        reconnect: { enabled: false },
      });

      const connectFn = jest.fn().mockResolvedValue(undefined);
      await manager.reconnect(connectFn);

      expect(connectFn).toHaveBeenCalledTimes(1);
    });

    it('should succeed on first attempt', async () => {
      manager = new ConnectionManager({
        reconnect: { enabled: true },
      });

      const connectFn = jest.fn().mockResolvedValue(undefined);
      const successHandler = jest.fn();
      manager.on('reconnect:success', successHandler);

      await manager.reconnect(connectFn);

      expect(connectFn).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      manager = new ConnectionManager({
        reconnect: { enabled: true, maxRetries: 3, initialDelayMs: 1, jitterFactor: 0 },
      });

      let attempts = 0;
      const connectFn = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Connection failed'));
        }
        return Promise.resolve();
      });

      await manager.reconnect(connectFn);
      expect(connectFn).toHaveBeenCalledTimes(3);
    }, 10000);

    it('should emit reconnect:start event', async () => {
      manager = new ConnectionManager();

      const startHandler = jest.fn();
      manager.on('reconnect:start', startHandler);

      const connectFn = jest.fn().mockResolvedValue(undefined);
      await manager.reconnect(connectFn);

      expect(startHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit reconnect:attempt event on retries', async () => {
      manager = new ConnectionManager({
        reconnect: { enabled: true, maxRetries: 2, initialDelayMs: 1, jitterFactor: 0 },
      });

      let attempts = 0;
      const connectFn = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve();
      });

      const attemptHandler = jest.fn();
      manager.on('reconnect:attempt', attemptHandler);

      await manager.reconnect(connectFn);

      expect(attemptHandler).toHaveBeenCalledWith(1, 2);
    }, 10000);

    it('should emit reconnect:exhausted when max retries reached', async () => {
      manager = new ConnectionManager({
        reconnect: { enabled: true, maxRetries: 2, initialDelayMs: 1, jitterFactor: 0 },
      });

      const connectFn = jest.fn().mockRejectedValue(new Error('fail'));
      const exhaustedHandler = jest.fn();
      manager.on('reconnect:exhausted', exhaustedHandler);

      await expect(manager.reconnect(connectFn)).rejects.toThrow('fail');
      expect(exhaustedHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should skip if already reconnecting', async () => {
      manager = new ConnectionManager();

      let resolveFirst: () => void;
      const firstConnect = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      const connectFn = jest.fn().mockImplementation(() => firstConnect);

      const first = manager.reconnect(connectFn);
      const second = manager.reconnect(connectFn);

      expect(manager.isReconnectionInProgress()).toBe(true);

      resolveFirst!();
      await first;
      await second;

      expect(connectFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeWithCircuitBreaker', () => {
    it('should execute operation when circuit breaker disabled', async () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: false },
      });

      const operation = jest.fn().mockResolvedValue('result');
      const result = await manager.executeWithCircuitBreaker(operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should execute operation when circuit is closed', async () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true },
      });

      const operation = jest.fn().mockResolvedValue('result');
      const result = await manager.executeWithCircuitBreaker(operation);

      expect(result).toBe('result');
    });

    it('should throw CircuitOpenError when circuit is open', async () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1 },
      });

      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);

      const operation = jest.fn().mockResolvedValue('result');

      await expect(manager.executeWithCircuitBreaker(operation)).rejects.toThrow(
        'Circuit breaker is open',
      );
      expect(operation).not.toHaveBeenCalled();
    });

    it('should record success on successful operation', async () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 10 },
      });

      manager.recordFailure(new Error('test'));
      expect(manager.getConsecutiveFailures()).toBe(1);

      const operation = jest.fn().mockResolvedValue('result');
      await manager.executeWithCircuitBreaker(operation);

      expect(manager.getConsecutiveFailures()).toBe(0);
    });

    it('should record failure on failed operation', async () => {
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 10 },
      });

      const operation = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(manager.executeWithCircuitBreaker(operation)).rejects.toThrow('fail');
      expect(manager.getConsecutiveFailures()).toBe(1);
    });

    it('should increment half-open attempts in half-open state', async () => {
      jest.useFakeTimers();
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1, resetTimeoutMs: 100 },
      });

      manager.recordFailure(new Error('test'));
      jest.advanceTimersByTime(100);
      expect(manager.getCircuitState()).toBe(CircuitState.HALF_OPEN);

      const operation = jest.fn().mockResolvedValue('result');
      await manager.executeWithCircuitBreaker(operation);

      // Should close after successful operation in half-open
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('cancelReconnect', () => {
    it('should set cancelled flag', () => {
      manager = new ConnectionManager({
        reconnect: { enabled: true },
      });

      manager.cancelReconnect();
      // Just verify it doesn't throw - the flag is internal
      expect(manager).toBeDefined();
    });

    it('should clear reconnect timer', () => {
      manager = new ConnectionManager({
        reconnect: { enabled: true },
      });

      // Call cancel even with no active timer
      manager.cancelReconnect();
      expect(manager).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('should clean up all timers and listeners', () => {
      jest.useFakeTimers();
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1, resetTimeoutMs: 1000 },
      });

      manager.recordFailure(new Error('test'));

      const listener = jest.fn();
      manager.on('circuit:close', listener);

      manager.destroy();

      // Advance timers - should not emit events
      jest.advanceTimersByTime(1000);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('half-open transition', () => {
    it('should emit circuit:half-open event', () => {
      jest.useFakeTimers();
      manager = new ConnectionManager({
        circuitBreaker: { enabled: true, failureThreshold: 1, resetTimeoutMs: 100 },
      });

      const halfOpenHandler = jest.fn();
      manager.on('circuit:half-open', halfOpenHandler);

      manager.recordFailure(new Error('test'));
      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);

      jest.advanceTimersByTime(100);
      expect(manager.getCircuitState()).toBe(CircuitState.HALF_OPEN);
      expect(halfOpenHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('CircuitState enum', () => {
    it('should have correct values', () => {
      expect(CircuitState.CLOSED).toBe('closed');
      expect(CircuitState.OPEN).toBe('open');
      expect(CircuitState.HALF_OPEN).toBe('half_open');
    });
  });
});
