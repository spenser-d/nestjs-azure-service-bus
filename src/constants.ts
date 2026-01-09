/**
 * Unique transport identifier for Azure Service Bus
 */
export const SERVICE_BUS_TRANSPORT = Symbol('SERVICE_BUS_TRANSPORT');

/**
 * Error message when no handler is found for a pattern
 * Matches NestJS convention from @nestjs/microservices
 */
export const NO_MESSAGE_HANDLER =
  'There is no matching message handler defined in the remote service.';

/**
 * Injection tokens
 */
export const SERVICE_BUS_CLIENT_INSTANCE = Symbol('SERVICE_BUS_CLIENT_INSTANCE');
export const SERVICE_BUS_OPTIONS = Symbol('SERVICE_BUS_OPTIONS');

/**
 * Default configuration values
 */
export const SERVICE_BUS_DEFAULTS = {
  /**
   * Maximum number of concurrent calls per subscription
   */
  MAX_CONCURRENT_CALLS: 1,

  /**
   * Maximum number of concurrent sessions
   */
  MAX_CONCURRENT_SESSIONS: 1,

  /**
   * Session idle timeout in milliseconds (60 seconds)
   */
  SESSION_IDLE_TIMEOUT_MS: 60000,

  /**
   * Request-response timeout in milliseconds (30 seconds)
   */
  REQUEST_TIMEOUT_MS: 30000,

  /**
   * Auto-complete messages after successful handler execution
   */
  AUTO_COMPLETE: true,

  /**
   * Auto dead-letter messages on handler errors
   */
  AUTO_DEAD_LETTER: false,

  /**
   * Receive mode for messages
   */
  RECEIVE_MODE: 'peekLock' as const,

  /**
   * Retry options
   */
  RETRY: {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 30000,
    MAX_RETRY_DELAY_MS: 120000,
    MODE: 'exponential' as const,
  },
} as const;

/**
 * Application properties keys used in Service Bus messages
 */
export const MESSAGE_PROPERTIES = {
  /**
   * Pattern property name in applicationProperties
   */
  PATTERN: 'nestjs_pattern',

  /**
   * Marker to identify NestJS messages
   */
  NESTJS_MARKER: 'nestjs',

  /**
   * Response marker
   */
  IS_RESPONSE: 'nestjs_is_response',

  /**
   * Stream disposed marker
   */
  IS_DISPOSED: 'nestjs_is_disposed',

  /**
   * Error property
   */
  ERROR: 'nestjs_error',
} as const;

/**
 * Metadata keys for decorators
 */
export const METADATA_KEYS = {
  /**
   * Subscription configuration metadata
   */
  SUBSCRIPTION: 'service_bus_subscription',

  /**
   * Dead letter handler metadata
   */
  DEAD_LETTER_HANDLER: 'service_bus_dead_letter_handler',

  /**
   * Pattern handler extras
   */
  HANDLER_EXTRAS: 'service_bus_handler_extras',
} as const;

/**
 * Server connection status
 */
export enum ServiceBusServerStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  CLOSING = 'closing',
}

/**
 * Client connection status
 */
export enum ServiceBusClientStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  CLOSING = 'closing',
}
