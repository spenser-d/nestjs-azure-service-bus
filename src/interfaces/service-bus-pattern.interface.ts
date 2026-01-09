/**
 * Subscription decorator options
 */
export interface SubscriptionPatternOptions {
  /**
   * Override topic for this handler
   */
  topic?: string;

  /**
   * Override subscription for this handler
   */
  subscription?: string;

  /**
   * Whether sessions are enabled for this handler
   */
  sessionEnabled?: boolean;

  /**
   * Auto-complete setting for this handler
   */
  autoComplete?: boolean;

  /**
   * Auto dead-letter setting for this handler
   */
  autoDeadLetter?: boolean;
}

/**
 * Dead letter handler options
 */
export interface DeadLetterPatternOptions {
  /**
   * Topic containing the dead letter queue
   */
  topic?: string;

  /**
   * Subscription containing the dead letter queue
   */
  subscription?: string;
}

/**
 * Handler metadata stored by decorators
 */
export interface HandlerMetadata {
  /**
   * Pattern to match
   */
  pattern: string;

  /**
   * Subscription-specific options
   */
  options?: SubscriptionPatternOptions;

  /**
   * Whether this is a dead letter handler
   */
  isDeadLetterHandler?: boolean;

  /**
   * Dead letter handler options
   */
  deadLetterOptions?: DeadLetterPatternOptions;
}

/**
 * Extended handler extras attached to NestJS message handlers
 */
export interface ServiceBusHandlerExtras {
  /**
   * Subscription configuration
   */
  subscription?: SubscriptionPatternOptions;

  /**
   * Dead letter configuration
   */
  deadLetter?: DeadLetterPatternOptions;

  /**
   * Whether this is a dead letter handler
   */
  isDeadLetterHandler?: boolean;
}
