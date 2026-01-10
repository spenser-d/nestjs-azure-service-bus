import type {
  ServiceBusClientOptions,
  ServiceBusServerOptions,
  SubscriptionConfig,
} from '../interfaces';

/**
 * Validation errors with helpful messages
 */
export class ServiceBusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceBusValidationError';
  }
}

/**
 * Validates a Service Bus connection string format
 * Connection strings should contain Endpoint, SharedAccessKeyName, and SharedAccessKey
 * OR EntityPath for queue-specific connections
 */
export function validateConnectionString(
  connectionString: string | undefined,
  context: string,
): void {
  if (!connectionString) return; // Optional if using fullyQualifiedNamespace

  if (typeof connectionString !== 'string') {
    throw new ServiceBusValidationError(`${context}: connectionString must be a string`);
  }

  if (!connectionString.includes('Endpoint=')) {
    throw new ServiceBusValidationError(
      `${context}: connectionString must contain 'Endpoint=' - check your Service Bus connection string format`,
    );
  }
}

/**
 * Validates a fully qualified namespace
 * Should be in format: namespace.servicebus.windows.net
 */
export function validateFullyQualifiedNamespace(
  namespace: string | undefined,
  context: string,
): void {
  if (!namespace) return; // Optional if using connectionString

  if (typeof namespace !== 'string') {
    throw new ServiceBusValidationError(`${context}: fullyQualifiedNamespace must be a string`);
  }

  if (!namespace.includes('.')) {
    throw new ServiceBusValidationError(
      `${context}: fullyQualifiedNamespace should be in format 'namespace.servicebus.windows.net'`,
    );
  }
}

/**
 * Validates a topic or subscription name
 * Azure Service Bus entity names:
 * - Must be 1-260 characters
 * - Can contain alphanumeric, periods, hyphens, underscores
 * - Cannot start or end with special characters
 */
export function validateEntityName(
  name: string | undefined,
  entityType: string,
  context: string,
): void {
  if (!name) {
    throw new ServiceBusValidationError(`${context}: ${entityType} is required`);
  }

  if (typeof name !== 'string') {
    throw new ServiceBusValidationError(`${context}: ${entityType} must be a string`);
  }

  if (name.length === 0 || name.length > 260) {
    throw new ServiceBusValidationError(
      `${context}: ${entityType} must be between 1 and 260 characters`,
    );
  }

  // Basic check for obviously invalid characters
  if (/[\s<>*%&:\\?+/]/.test(name)) {
    throw new ServiceBusValidationError(
      `${context}: ${entityType} contains invalid characters. Avoid spaces and characters: < > * % & : \\ ? + /`,
    );
  }
}

/**
 * Validates a timeout value in milliseconds
 */
export function validateTimeout(
  value: number | undefined,
  name: string,
  context: string,
  minValue = 0,
): void {
  if (value === undefined) return; // Optional, will use default

  if (typeof value !== 'number' || isNaN(value)) {
    throw new ServiceBusValidationError(`${context}: ${name} must be a number`);
  }

  if (value <= minValue) {
    throw new ServiceBusValidationError(`${context}: ${name} must be greater than ${minValue}ms`);
  }

  if (!Number.isFinite(value)) {
    throw new ServiceBusValidationError(`${context}: ${name} must be a finite number`);
  }
}

/**
 * Validates a positive integer
 */
export function validatePositiveInteger(
  value: number | undefined,
  name: string,
  context: string,
): void {
  if (value === undefined) return; // Optional, will use default

  if (typeof value !== 'number' || isNaN(value)) {
    throw new ServiceBusValidationError(`${context}: ${name} must be a number`);
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new ServiceBusValidationError(`${context}: ${name} must be a positive integer`);
  }
}

/**
 * Validates ServiceBusClientOptions
 */
export function validateClientOptions(options: ServiceBusClientOptions): void {
  const context = 'ServiceBusClientOptions';

  // Must have either connectionString or fullyQualifiedNamespace + credential
  if (!options.connectionString && !options.fullyQualifiedNamespace) {
    throw new ServiceBusValidationError(
      `${context}: Either connectionString or fullyQualifiedNamespace is required`,
    );
  }

  if (options.fullyQualifiedNamespace && !options.credential) {
    throw new ServiceBusValidationError(
      `${context}: credential is required when using fullyQualifiedNamespace`,
    );
  }

  // Validate connection options
  validateConnectionString(options.connectionString, context);
  validateFullyQualifiedNamespace(options.fullyQualifiedNamespace, context);

  // Validate topic
  validateEntityName(options.topic, 'topic', context);

  // Validate optional timeouts
  validateTimeout(options.requestTimeout, 'requestTimeout', context, 0);

  // Validate reconnect options if provided
  if (options.reconnect) {
    validateTimeout(options.reconnect.initialDelayMs, 'reconnect.initialDelayMs', context, 0);
    validateTimeout(options.reconnect.maxDelayMs, 'reconnect.maxDelayMs', context, 0);
    validatePositiveInteger(options.reconnect.maxRetries, 'reconnect.maxRetries', context);
  }

  // Validate circuit breaker options if provided
  if (options.circuitBreaker) {
    validatePositiveInteger(
      options.circuitBreaker.failureThreshold,
      'circuitBreaker.failureThreshold',
      context,
    );
    validateTimeout(
      options.circuitBreaker.resetTimeoutMs,
      'circuitBreaker.resetTimeoutMs',
      context,
      0,
    );
  }
}

/**
 * Validates a subscription configuration
 */
export function validateSubscriptionConfig(config: SubscriptionConfig, index: number): void {
  const context = `ServiceBusServerOptions.subscriptions[${index}]`;

  validateEntityName(config.topic, 'topic', context);
  validateEntityName(config.subscription, 'subscription', context);

  validatePositiveInteger(config.maxConcurrentCalls, 'maxConcurrentCalls', context);
  validatePositiveInteger(config.maxConcurrentSessions, 'maxConcurrentSessions', context);
  validateTimeout(config.sessionIdleTimeoutMs, 'sessionIdleTimeoutMs', context, 0);
}

/**
 * Validates ServiceBusServerOptions
 */
export function validateServerOptions(options: ServiceBusServerOptions): void {
  const context = 'ServiceBusServerOptions';

  // Must have either connectionString or fullyQualifiedNamespace + credential
  if (!options.connectionString && !options.fullyQualifiedNamespace) {
    throw new ServiceBusValidationError(
      `${context}: Either connectionString or fullyQualifiedNamespace is required`,
    );
  }

  if (options.fullyQualifiedNamespace && !options.credential) {
    throw new ServiceBusValidationError(
      `${context}: credential is required when using fullyQualifiedNamespace`,
    );
  }

  // Validate connection options
  validateConnectionString(options.connectionString, context);
  validateFullyQualifiedNamespace(options.fullyQualifiedNamespace, context);

  // Validate subscriptions
  if (!options.subscriptions || options.subscriptions.length === 0) {
    throw new ServiceBusValidationError(`${context}: At least one subscription is required`);
  }

  options.subscriptions.forEach((config, index) => {
    validateSubscriptionConfig(config, index);
  });

  // Validate optional settings
  validatePositiveInteger(options.maxConcurrentCalls, 'maxConcurrentCalls', context);
  validatePositiveInteger(options.maxConcurrentSessions, 'maxConcurrentSessions', context);
  validateTimeout(options.sessionIdleTimeoutMs, 'sessionIdleTimeoutMs', context, 0);
  validateTimeout(options.drainTimeoutMs, 'drainTimeoutMs', context, 0);
  validateTimeout(options.gracePeriodMs, 'gracePeriodMs', context, 0);

  // Validate reconnect options if provided
  if (options.reconnect) {
    validateTimeout(options.reconnect.initialDelayMs, 'reconnect.initialDelayMs', context, 0);
    validateTimeout(options.reconnect.maxDelayMs, 'reconnect.maxDelayMs', context, 0);
    validatePositiveInteger(options.reconnect.maxRetries, 'reconnect.maxRetries', context);
  }

  // Validate circuit breaker options if provided
  if (options.circuitBreaker) {
    validatePositiveInteger(
      options.circuitBreaker.failureThreshold,
      'circuitBreaker.failureThreshold',
      context,
    );
    validateTimeout(
      options.circuitBreaker.resetTimeoutMs,
      'circuitBreaker.resetTimeoutMs',
      context,
      0,
    );
  }
}
