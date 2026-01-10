import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { ReconnectOptions, CircuitBreakerOptions } from '../interfaces';

// Re-export types for convenience
export type { ReconnectOptions, CircuitBreakerOptions };

/**
 * Connection manager options
 */
export interface ConnectionManagerOptions {
  /**
   * Name for logging purposes
   */
  name?: string;

  /**
   * Reconnection options
   */
  reconnect?: ReconnectOptions;

  /**
   * Circuit breaker options
   */
  circuitBreaker?: CircuitBreakerOptions;
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  /** Circuit is closed, operations proceed normally */
  CLOSED = 'closed',
  /** Circuit is open, operations are rejected immediately */
  OPEN = 'open',
  /** Circuit is testing if operations can succeed */
  HALF_OPEN = 'half_open',
}

/**
 * Events emitted by ConnectionManager
 */
export interface ConnectionManagerEvents {
  'reconnect:start': () => void;
  'reconnect:attempt': (attempt: number, delay: number) => void;
  'reconnect:success': () => void;
  'reconnect:failed': (error: Error) => void;
  'reconnect:exhausted': () => void;
  'circuit:open': () => void;
  'circuit:half-open': () => void;
  'circuit:close': () => void;
}

/**
 * Default reconnection options
 */
export const DEFAULT_RECONNECT_OPTIONS: Required<ReconnectOptions> = {
  enabled: true,
  maxRetries: Infinity,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Default circuit breaker options
 */
export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: Required<CircuitBreakerOptions> = {
  enabled: true,
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 3,
};

/**
 * Manages connection resilience with auto-reconnection and circuit breaker patterns
 *
 * @example
 * ```typescript
 * const manager = new ConnectionManager({
 *   name: 'service-bus-client',
 *   reconnect: { enabled: true, maxRetries: 10 },
 *   circuitBreaker: { enabled: true, failureThreshold: 5 },
 * });
 *
 * manager.on('reconnect:success', () => console.log('Reconnected!'));
 * manager.on('circuit:open', () => console.log('Circuit opened!'));
 *
 * await manager.executeWithResilience(async () => {
 *   await client.connect();
 * });
 * ```
 */
export class ConnectionManager extends EventEmitter {
  private readonly logger: Logger;
  private readonly reconnectOptions: Required<ReconnectOptions>;
  private readonly circuitBreakerOptions: Required<CircuitBreakerOptions>;

  // Reconnection state
  private reconnectAttempt = 0;
  private isReconnecting = false;
  private reconnectCancelled = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Circuit breaker state
  private circuitState: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private halfOpenAttempts = 0;
  private circuitResetTimer: NodeJS.Timeout | null = null;

  constructor(options: ConnectionManagerOptions = {}) {
    super();
    this.logger = new Logger(options.name || 'ConnectionManager');

    this.reconnectOptions = {
      ...DEFAULT_RECONNECT_OPTIONS,
      ...options.reconnect,
    };

    this.circuitBreakerOptions = {
      ...DEFAULT_CIRCUIT_BREAKER_OPTIONS,
      ...options.circuitBreaker,
    };
  }

  /**
   * Gets the current circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  /**
   * Gets whether a reconnection is currently in progress
   */
  isReconnectionInProgress(): boolean {
    return this.isReconnecting;
  }

  /**
   * Gets the current reconnection attempt number
   */
  getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  /**
   * Gets the number of consecutive failures
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Checks if operations can proceed based on circuit breaker state
   */
  canProceed(): boolean {
    if (!this.circuitBreakerOptions.enabled) {
      return true;
    }

    switch (this.circuitState) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.HALF_OPEN:
        return this.halfOpenAttempts < this.circuitBreakerOptions.halfOpenMaxAttempts;
      case CircuitState.OPEN:
        return false;
    }
  }

  /**
   * Records a successful operation
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;

    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.closeCircuit();
    }
  }

  /**
   * Records a failed operation
   */
  recordFailure(_error?: Error): void {
    this.consecutiveFailures++;

    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.circuitBreakerOptions.halfOpenMaxAttempts) {
        this.openCircuit();
      }
    } else if (
      this.circuitBreakerOptions.enabled &&
      this.consecutiveFailures >= this.circuitBreakerOptions.failureThreshold
    ) {
      this.openCircuit();
    }
  }

  /**
   * Opens the circuit breaker
   */
  private openCircuit(): void {
    if (this.circuitState === CircuitState.OPEN) {
      return;
    }

    this.circuitState = CircuitState.OPEN;
    this.logger.warn(
      `Circuit breaker opened after ${this.consecutiveFailures} consecutive failures`,
    );
    this.emit('circuit:open');

    // Schedule transition to half-open
    this.scheduleHalfOpen();
  }

  /**
   * Transitions to half-open state
   */
  private scheduleHalfOpen(): void {
    if (this.circuitResetTimer) {
      clearTimeout(this.circuitResetTimer);
    }

    this.circuitResetTimer = setTimeout(() => {
      this.circuitState = CircuitState.HALF_OPEN;
      this.halfOpenAttempts = 0;
      this.logger.log('Circuit breaker transitioned to half-open state');
      this.emit('circuit:half-open');
    }, this.circuitBreakerOptions.resetTimeoutMs);
  }

  /**
   * Closes the circuit breaker
   */
  private closeCircuit(): void {
    if (this.circuitResetTimer) {
      clearTimeout(this.circuitResetTimer);
      this.circuitResetTimer = null;
    }

    this.circuitState = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.halfOpenAttempts = 0;
    this.logger.log('Circuit breaker closed');
    this.emit('circuit:close');
  }

  /**
   * Manually resets the circuit breaker to closed state
   */
  resetCircuit(): void {
    this.closeCircuit();
  }

  /**
   * Calculates the delay for the next reconnection attempt with exponential backoff and jitter
   */
  calculateReconnectDelay(attempt: number): number {
    const { initialDelayMs, maxDelayMs, backoffMultiplier, jitterFactor } = this.reconnectOptions;

    // Calculate base delay with exponential backoff
    const baseDelay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);

    // Add jitter to prevent thundering herd
    const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);

    return Math.max(0, Math.round(baseDelay + jitter));
  }

  /**
   * Executes a reconnection with retry logic
   *
   * @param connectFn - Async function that performs the connection
   * @returns Promise that resolves when connected or rejects when retries exhausted
   */
  async reconnect(connectFn: () => Promise<void>): Promise<void> {
    if (!this.reconnectOptions.enabled) {
      await connectFn();
      return;
    }

    if (this.isReconnecting) {
      this.logger.debug('Reconnection already in progress, skipping');
      return;
    }

    this.isReconnecting = true;
    this.reconnectCancelled = false;
    this.reconnectAttempt = 0;

    this.emit('reconnect:start');

    try {
      while (!this.reconnectCancelled && this.reconnectAttempt < this.reconnectOptions.maxRetries) {
        try {
          // Check circuit breaker
          if (!this.canProceed()) {
            const waitTime = this.circuitBreakerOptions.resetTimeoutMs;
            this.logger.debug(`Circuit open, waiting ${waitTime}ms before retry`);
            await this.sleep(waitTime);
            continue;
          }

          await connectFn();

          // Success!
          this.recordSuccess();
          this.reconnectAttempt = 0;
          this.logger.log('Reconnection successful');
          this.emit('reconnect:success');
          return;
        } catch (error) {
          this.recordFailure(error as Error);
          this.reconnectAttempt++;

          if (this.reconnectCancelled) {
            break;
          }

          if (this.reconnectAttempt >= this.reconnectOptions.maxRetries) {
            this.logger.error(`Reconnection failed after ${this.reconnectAttempt} attempts`);
            this.emit('reconnect:exhausted');
            throw error;
          }

          const delay = this.calculateReconnectDelay(this.reconnectAttempt);
          this.logger.warn(
            `Reconnection attempt ${this.reconnectAttempt} failed, retrying in ${delay}ms: ${(error as Error).message}`,
          );
          this.emit('reconnect:attempt', this.reconnectAttempt, delay);

          await this.sleep(delay);
        }
      }

      if (this.reconnectCancelled) {
        this.logger.log('Reconnection cancelled');
        return;
      }

      throw new Error('Reconnection failed: max retries exhausted');
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Executes an operation with circuit breaker protection
   *
   * @param operation - Async function to execute
   * @returns Promise with the operation result
   * @throws CircuitOpenError if circuit is open
   */
  async executeWithCircuitBreaker<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.circuitBreakerOptions.enabled) {
      return operation();
    }

    if (!this.canProceed()) {
      const error = new Error(
        `Circuit breaker is open. Operations blocked for ${this.circuitBreakerOptions.resetTimeoutMs}ms`,
      );
      error.name = 'CircuitOpenError';
      throw error;
    }

    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    }
  }

  /**
   * Cancels any ongoing reconnection attempt
   */
  cancelReconnect(): void {
    this.reconnectCancelled = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Cleans up all timers and resets state
   */
  destroy(): void {
    this.cancelReconnect();
    if (this.circuitResetTimer) {
      clearTimeout(this.circuitResetTimer);
      this.circuitResetTimer = null;
    }
    this.removeAllListeners();
  }

  /**
   * Sleeps for the specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.reconnectTimer = setTimeout(resolve, ms);
    });
  }
}
