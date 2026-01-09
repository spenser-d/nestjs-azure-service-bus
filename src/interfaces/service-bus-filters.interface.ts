/**
 * Re-export Azure Service Bus types for convenience
 * These are used with ServiceBusAdminService for entity management
 */
export type {
  SqlRuleFilter,
  CorrelationRuleFilter,
  SqlRuleAction,
  RuleProperties,
  CreateQueueOptions,
  CreateTopicOptions,
  CreateSubscriptionOptions,
  QueueProperties,
  TopicProperties,
  SubscriptionProperties,
  QueueRuntimeProperties,
  TopicRuntimeProperties,
  SubscriptionRuntimeProperties,
  NamespaceProperties,
} from '@azure/service-bus';

/**
 * Import types for use in local interfaces
 */
import type {
  SqlRuleFilter as AzureSqlRuleFilter,
  CorrelationRuleFilter as AzureCorrelationRuleFilter,
  SqlRuleAction as AzureSqlRuleAction,
} from '@azure/service-bus';

/**
 * Configuration for a subscription filter rule
 * Used when creating subscriptions with default rules
 */
export interface SubscriptionFilterConfig {
  /**
   * Name of the rule
   */
  name: string;

  /**
   * SQL filter expression or correlation filter
   */
  filter: AzureSqlRuleFilter | AzureCorrelationRuleFilter;

  /**
   * Optional SQL action to transform messages
   */
  action?: AzureSqlRuleAction;
}
