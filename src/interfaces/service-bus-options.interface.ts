import type { TokenCredential } from '@azure/identity';
import type { ServiceBusClientOptions as AzureClientOptions } from '@azure/service-bus';
import type { Deserializer, Serializer } from '@nestjs/microservices';

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
