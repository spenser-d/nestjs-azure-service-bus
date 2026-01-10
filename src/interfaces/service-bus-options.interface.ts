import type { TokenCredential } from '@azure/identity';
import type { ServiceBusClientOptions as AzureClientOptions } from '@azure/service-bus';
import type { Deserializer, Serializer } from '@nestjs/microservices';

/**
 * Options for automatic reconnection
 */
export interface ReconnectOptions {
  /**
   * Whether auto-reconnection is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum number of reconnection attempts
   * @default Infinity
   */
  maxRetries?: number;

  /**
   * Initial delay between reconnection attempts in milliseconds
   * @default 1000
   */
  initialDelayMs?: number;

  /**
   * Maximum delay between reconnection attempts in milliseconds
   * @default 30000
   */
  maxDelayMs?: number;

  /**
   * Multiplier for exponential backoff
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Jitter factor (0-1) to add randomness to delays
   * @default 0.1
   */
  jitterFactor?: number;
}

/**
 * Options for circuit breaker pattern
 */
export interface CircuitBreakerOptions {
  /**
   * Whether circuit breaker is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Number of consecutive failures before opening the circuit
   * @default 5
   */
  failureThreshold?: number;

  /**
   * Time in milliseconds to wait before attempting to close the circuit
   * @default 30000
   */
  resetTimeoutMs?: number;

  /**
   * Maximum number of attempts in half-open state before fully opening
   * @default 3
   */
  halfOpenMaxAttempts?: number;
}

/**
 * Options for OpenTelemetry observability
 */
export interface ObservabilityOptions {
  /**
   * Enable OpenTelemetry metrics collection
   * Set to true to use default meter, or provide custom options
   * Only activates if @opentelemetry/api is available
   * @default false
   */
  metrics?: boolean | MetricsOptions;

  /**
   * Enable OpenTelemetry distributed tracing
   * Set to true to use default tracer, or provide custom options
   * Only activates if @opentelemetry/api is available
   * @default false
   */
  tracing?: boolean | TracingOptions;
}

/**
 * Options for metrics collection
 */
export interface MetricsOptions {
  /**
   * Custom meter name for metrics
   * @default 'nestjs-azure-service-bus'
   */
  meterName?: string;

  /**
   * Prefix for all metric names
   * @default 'service_bus'
   */
  prefix?: string;
}

/**
 * Options for distributed tracing
 */
export interface TracingOptions {
  /**
   * Custom tracer name for tracing
   * @default 'nestjs-azure-service-bus'
   */
  tracerName?: string;
}

/**
 * Retry options for Service Bus operations
 */
export interface ServiceBusRetryOptions {
  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Delay between retries in milliseconds
   * @default 30000
   */
  retryDelayInMs?: number;

  /**
   * Maximum delay between retries in milliseconds (for exponential backoff)
   * @default 120000
   */
  maxRetryDelayInMs?: number;

  /**
   * Retry mode: 'fixed' or 'exponential'
   * @default 'exponential'
   */
  mode?: 'fixed' | 'exponential';

  /**
   * Timeout for each operation in milliseconds
   * @default 60000
   */
  timeoutInMs?: number;
}

/**
 * Configuration for a single subscription
 */
export interface SubscriptionConfig {
  /**
   * Topic name to subscribe to
   */
  topic: string;

  /**
   * Subscription name within the topic
   */
  subscription: string;

  /**
   * Whether sessions are enabled for this subscription
   * @default false
   */
  sessionEnabled?: boolean;

  /**
   * Receive mode: 'peekLock' (default) or 'receiveAndDelete'
   * @default 'peekLock'
   */
  receiveMode?: 'peekLock' | 'receiveAndDelete';

  /**
   * Whether to also listen on the dead letter queue
   * @default false
   */
  handleDeadLetter?: boolean;

  /**
   * Maximum number of concurrent calls for this subscription
   * Overrides the global setting
   */
  maxConcurrentCalls?: number;

  /**
   * Maximum number of concurrent sessions (when sessionEnabled is true)
   * Overrides the global setting
   */
  maxConcurrentSessions?: number;

  /**
   * Session idle timeout in milliseconds
   * Overrides the global setting
   */
  sessionIdleTimeoutMs?: number;

  /**
   * Auto-complete messages after successful handler execution
   * Overrides the global setting
   */
  autoComplete?: boolean;

  /**
   * Auto dead-letter messages on handler errors
   * Overrides the global setting
   */
  autoDeadLetter?: boolean;
}

/**
 * Server options for Azure Service Bus transporter
 */
export interface ServiceBusServerOptions {
  /**
   * Connection string for Azure Service Bus
   * Required if fullyQualifiedNamespace is not provided
   */
  connectionString?: string;

  /**
   * Fully qualified namespace (e.g., 'mynamespace.servicebus.windows.net')
   * Required if connectionString is not provided
   */
  fullyQualifiedNamespace?: string;

  /**
   * Token credential for Azure AD authentication
   * Required when using fullyQualifiedNamespace
   */
  credential?: TokenCredential;

  /**
   * Subscription configurations
   * At least one subscription is required
   */
  subscriptions: SubscriptionConfig[];

  /**
   * Default receive mode for all subscriptions
   * @default 'peekLock'
   */
  receiveMode?: 'peekLock' | 'receiveAndDelete';

  /**
   * Auto-complete messages after successful handler execution
   * @default true
   */
  autoComplete?: boolean;

  /**
   * Auto dead-letter messages on handler errors
   * @default false
   */
  autoDeadLetter?: boolean;

  /**
   * Maximum number of concurrent calls per subscription
   * @default 1
   */
  maxConcurrentCalls?: number;

  /**
   * Whether sessions are enabled by default
   * @default false
   */
  sessionEnabled?: boolean;

  /**
   * Maximum number of concurrent sessions
   * @default 1
   */
  maxConcurrentSessions?: number;

  /**
   * Session idle timeout in milliseconds
   * @default 60000
   */
  sessionIdleTimeoutMs?: number;

  /**
   * Retry options for Service Bus operations
   */
  retryOptions?: ServiceBusRetryOptions;

  /**
   * Additional Azure Service Bus client options
   */
  clientOptions?: Omit<AzureClientOptions, 'retryOptions'>;

  /**
   * Custom message serializer
   */
  serializer?: Serializer;

  /**
   * Custom message deserializer
   */
  deserializer?: Deserializer;

  /**
   * Auto-reconnection options
   * Enables automatic reconnection when connection is lost
   */
  reconnect?: ReconnectOptions;

  /**
   * Circuit breaker options
   * Prevents cascade failures during outages
   */
  circuitBreaker?: CircuitBreakerOptions;

  /**
   * OpenTelemetry observability options
   * Enables metrics and distributed tracing
   */
  observability?: ObservabilityOptions;

  /**
   * Drain timeout during shutdown in milliseconds
   * Time to wait for in-flight messages to complete
   * @default 30000
   */
  drainTimeoutMs?: number;

  /**
   * Grace period after stopping receivers in milliseconds
   * Additional time to wait before closing the client
   * @default 5000
   */
  gracePeriodMs?: number;
}

/**
 * Client options for Azure Service Bus transporter
 */
export interface ServiceBusClientOptions {
  /**
   * Connection string for Azure Service Bus
   * Required if fullyQualifiedNamespace is not provided
   */
  connectionString?: string;

  /**
   * Fully qualified namespace (e.g., 'mynamespace.servicebus.windows.net')
   * Required if connectionString is not provided
   */
  fullyQualifiedNamespace?: string;

  /**
   * Token credential for Azure AD authentication
   * Required when using fullyQualifiedNamespace
   */
  credential?: TokenCredential;

  /**
   * Default topic for sending messages
   */
  topic: string;

  /**
   * Reply topic for request-response pattern
   * @default same as topic
   */
  replyTopic?: string;

  /**
   * Reply subscription for receiving responses
   * @default auto-generated unique name
   */
  replySubscription?: string;

  /**
   * Whether the reply subscription uses sessions
   * @default false
   */
  replySessionEnabled?: boolean;

  /**
   * Timeout for request-response operations in milliseconds
   * @default 30000
   */
  requestTimeout?: number;

  /**
   * Retry options for Service Bus operations
   */
  retryOptions?: ServiceBusRetryOptions;

  /**
   * Additional Azure Service Bus client options
   */
  clientOptions?: Omit<AzureClientOptions, 'retryOptions'>;

  /**
   * Custom message serializer
   */
  serializer?: Serializer;

  /**
   * Custom message deserializer
   */
  deserializer?: Deserializer;

  /**
   * Auto-reconnection options
   * Enables automatic reconnection when connection is lost
   */
  reconnect?: ReconnectOptions;

  /**
   * Circuit breaker options
   * Prevents cascade failures during outages
   */
  circuitBreaker?: CircuitBreakerOptions;

  /**
   * OpenTelemetry observability options
   * Enables metrics and distributed tracing
   */
  observability?: ObservabilityOptions;
}

/**
 * Options for registering multiple clients
 */
export interface ServiceBusClientModuleOptions extends ServiceBusClientOptions {
  /**
   * Injection token name for the client
   */
  name: string | symbol;
}

/**
 * Async options for ServiceBusClientModule
 */
export interface ServiceBusClientModuleAsyncOptions {
  /**
   * Injection token name for the client
   */
  name: string | symbol;

  /**
   * Optional imports for the factory
   */
  imports?: any[];

  /**
   * Factory function to create options
   */
  useFactory: (...args: any[]) => Promise<ServiceBusClientOptions> | ServiceBusClientOptions;

  /**
   * Dependencies to inject into the factory
   */
  inject?: any[];
}
