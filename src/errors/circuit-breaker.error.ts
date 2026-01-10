import {
  ServiceBusTransportError,
  ServiceBusTransportErrorCode,
} from './service-bus-transport.error';

/**
 * Error thrown when the circuit breaker is open and operations are blocked
 *
 * @example
 * ```typescript
 * try {
 *   await client.send('pattern', data);
 * } catch (error) {
 *   if (error instanceof ServiceBusCircuitOpenError) {
 *     // Circuit is open, wait before retrying
 *     console.log(`Circuit open, retry after ${error.resetTimeoutMs}ms`);
 *   }
 * }
 * ```
 */
export class ServiceBusCircuitOpenError extends ServiceBusTransportError {
  /**
   * Time in milliseconds until the circuit will attempt to reset
   */
  public readonly resetTimeoutMs: number;

  /**
   * Number of consecutive failures that triggered the circuit to open
   */
  public readonly failureCount: number;

  constructor(
    message: string,
    options?: {
      resetTimeoutMs?: number;
      failureCount?: number;
      context?: Record<string, any>;
    },
  ) {
    super(message, ServiceBusTransportErrorCode.CIRCUIT_OPEN, {
      context: options?.context,
      isTransient: true, // Circuit will eventually close
    });

    this.name = 'ServiceBusCircuitOpenError';
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30000;
    this.failureCount = options?.failureCount ?? 0;
  }

  /**
   * Returns a JSON representation of the error
   */
  override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      resetTimeoutMs: this.resetTimeoutMs,
      failureCount: this.failureCount,
    };
  }
}
