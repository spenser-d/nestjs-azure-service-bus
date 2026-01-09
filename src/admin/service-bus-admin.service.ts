import { Injectable, Inject, OnModuleDestroy, Logger } from '@nestjs/common';
import {
  ServiceBusAdministrationClient,
  SqlRuleFilter,
  CorrelationRuleFilter,
  SqlRuleAction,
  CreateQueueOptions,
  CreateTopicOptions,
  CreateSubscriptionOptions,
  QueueProperties,
  TopicProperties,
  SubscriptionProperties,
  RuleProperties,
  QueueRuntimeProperties,
  TopicRuntimeProperties,
  SubscriptionRuntimeProperties,
  NamespaceProperties,
} from '@azure/service-bus';
import type { TokenCredential } from '@azure/identity';
import type { PagedAsyncIterableIterator } from '@azure/core-paging';

/**
 * Options for the ServiceBusAdminService
 */
export interface ServiceBusAdminOptions {
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
}

/**
 * Injection token for admin options
 */
export const SERVICE_BUS_ADMIN_OPTIONS = Symbol('SERVICE_BUS_ADMIN_OPTIONS');

/**
 * Service for managing Azure Service Bus entities (queues, topics, subscriptions, rules)
 * Requires "Manage" claims on the Service Bus namespace
 *
 * @example
 * ```typescript
 * // Create a topic with subscriptions
 * await adminService.createTopic('orders');
 * await adminService.createSubscription('orders', 'processor');
 *
 * // Add a filter rule
 * await adminService.createRule('orders', 'processor', 'high-priority', {
 *   sqlExpression: "priority = 'high'"
 * });
 *
 * // Check runtime properties
 * const props = await adminService.getQueueRuntimeProperties('my-queue');
 * console.log('Active messages:', props.activeMessageCount);
 * ```
 */
@Injectable()
export class ServiceBusAdminService implements OnModuleDestroy {
  private readonly logger = new Logger(ServiceBusAdminService.name);
  private readonly adminClient: ServiceBusAdministrationClient;

  constructor(
    @Inject(SERVICE_BUS_ADMIN_OPTIONS)
    options: ServiceBusAdminOptions,
  ) {
    if (options.connectionString) {
      this.adminClient = new ServiceBusAdministrationClient(options.connectionString);
    } else if (options.fullyQualifiedNamespace && options.credential) {
      this.adminClient = new ServiceBusAdministrationClient(
        options.fullyQualifiedNamespace,
        options.credential,
      );
    } else {
      throw new Error(
        'Either connectionString or fullyQualifiedNamespace with credential is required',
      );
    }

    this.logger.log('ServiceBusAdminService initialized');
  }

  async onModuleDestroy() {
    // ServiceBusAdministrationClient doesn't have a close method
    this.logger.log('ServiceBusAdminService destroyed');
  }

  // ============ NAMESPACE OPERATIONS ============

  /**
   * Gets the namespace properties
   */
  async getNamespaceProperties(): Promise<NamespaceProperties> {
    const response = await this.adminClient.getNamespaceProperties();
    return response;
  }

  // ============ QUEUE OPERATIONS ============

  /**
   * Creates a new queue
   */
  async createQueue(queueName: string, options?: CreateQueueOptions): Promise<QueueProperties> {
    const response = await this.adminClient.createQueue(queueName, options);
    this.logger.log(`Created queue: ${queueName}`);
    return response;
  }

  /**
   * Gets queue properties
   */
  async getQueue(queueName: string): Promise<QueueProperties> {
    return this.adminClient.getQueue(queueName);
  }

  /**
   * Gets queue runtime properties (message counts, etc.)
   */
  async getQueueRuntimeProperties(queueName: string): Promise<QueueRuntimeProperties> {
    return this.adminClient.getQueueRuntimeProperties(queueName);
  }

  /**
   * Lists all queues
   */
  listQueues(): PagedAsyncIterableIterator<QueueProperties> {
    return this.adminClient.listQueues();
  }

  /**
   * Lists all queues with runtime properties
   */
  listQueuesRuntimeProperties(): PagedAsyncIterableIterator<QueueRuntimeProperties> {
    return this.adminClient.listQueuesRuntimeProperties();
  }

  /**
   * Updates queue properties
   * Note: You must first get the queue to obtain the full properties object
   */
  async updateQueue(queue: QueueProperties): Promise<QueueProperties> {
    // The admin client requires WithResponse type, but we accept the simpler type
    // and let TypeScript handle the compatibility
    const response = await this.adminClient.updateQueue(queue as any);
    this.logger.log(`Updated queue: ${queue.name}`);
    return response;
  }

  /**
   * Deletes a queue
   */
  async deleteQueue(queueName: string): Promise<void> {
    await this.adminClient.deleteQueue(queueName);
    this.logger.log(`Deleted queue: ${queueName}`);
  }

  /**
   * Checks if a queue exists
   */
  async queueExists(queueName: string): Promise<boolean> {
    return this.adminClient.queueExists(queueName);
  }

  // ============ TOPIC OPERATIONS ============

  /**
   * Creates a new topic
   */
  async createTopic(topicName: string, options?: CreateTopicOptions): Promise<TopicProperties> {
    const response = await this.adminClient.createTopic(topicName, options);
    this.logger.log(`Created topic: ${topicName}`);
    return response;
  }

  /**
   * Gets topic properties
   */
  async getTopic(topicName: string): Promise<TopicProperties> {
    return this.adminClient.getTopic(topicName);
  }

  /**
   * Gets topic runtime properties
   */
  async getTopicRuntimeProperties(topicName: string): Promise<TopicRuntimeProperties> {
    return this.adminClient.getTopicRuntimeProperties(topicName);
  }

  /**
   * Lists all topics
   */
  listTopics(): PagedAsyncIterableIterator<TopicProperties> {
    return this.adminClient.listTopics();
  }

  /**
   * Lists all topics with runtime properties
   */
  listTopicsRuntimeProperties(): PagedAsyncIterableIterator<TopicRuntimeProperties> {
    return this.adminClient.listTopicsRuntimeProperties();
  }

  /**
   * Updates topic properties
   * Note: You must first get the topic to obtain the full properties object
   */
  async updateTopic(topic: TopicProperties): Promise<TopicProperties> {
    // The admin client requires WithResponse type, but we accept the simpler type
    const response = await this.adminClient.updateTopic(topic as any);
    this.logger.log(`Updated topic: ${topic.name}`);
    return response;
  }

  /**
   * Deletes a topic
   */
  async deleteTopic(topicName: string): Promise<void> {
    await this.adminClient.deleteTopic(topicName);
    this.logger.log(`Deleted topic: ${topicName}`);
  }

  /**
   * Checks if a topic exists
   */
  async topicExists(topicName: string): Promise<boolean> {
    return this.adminClient.topicExists(topicName);
  }

  // ============ SUBSCRIPTION OPERATIONS ============

  /**
   * Creates a new subscription
   *
   * @example
   * ```typescript
   * // Create with default rule filter
   * await adminService.createSubscription('orders', 'high-priority', {
   *   defaultRuleOptions: {
   *     name: 'priority-filter',
   *     filter: { sqlExpression: "priority = 'high'" }
   *   }
   * });
   * ```
   */
  async createSubscription(
    topicName: string,
    subscriptionName: string,
    options?: CreateSubscriptionOptions,
  ): Promise<SubscriptionProperties> {
    const response = await this.adminClient.createSubscription(
      topicName,
      subscriptionName,
      options,
    );
    this.logger.log(`Created subscription: ${topicName}/${subscriptionName}`);
    return response;
  }

  /**
   * Gets subscription properties
   */
  async getSubscription(
    topicName: string,
    subscriptionName: string,
  ): Promise<SubscriptionProperties> {
    return this.adminClient.getSubscription(topicName, subscriptionName);
  }

  /**
   * Gets subscription runtime properties
   */
  async getSubscriptionRuntimeProperties(
    topicName: string,
    subscriptionName: string,
  ): Promise<SubscriptionRuntimeProperties> {
    return this.adminClient.getSubscriptionRuntimeProperties(topicName, subscriptionName);
  }

  /**
   * Lists all subscriptions for a topic
   */
  listSubscriptions(topicName: string): PagedAsyncIterableIterator<SubscriptionProperties> {
    return this.adminClient.listSubscriptions(topicName);
  }

  /**
   * Lists all subscriptions with runtime properties
   */
  listSubscriptionsRuntimeProperties(
    topicName: string,
  ): PagedAsyncIterableIterator<SubscriptionRuntimeProperties> {
    return this.adminClient.listSubscriptionsRuntimeProperties(topicName);
  }

  /**
   * Updates subscription properties
   * Note: You must first get the subscription to obtain the full properties object
   */
  async updateSubscription(subscription: SubscriptionProperties): Promise<SubscriptionProperties> {
    // The admin client requires WithResponse type, but we accept the simpler type
    const response = await this.adminClient.updateSubscription(subscription as any);
    this.logger.log(
      `Updated subscription: ${subscription.topicName}/${subscription.subscriptionName}`,
    );
    return response;
  }

  /**
   * Deletes a subscription
   */
  async deleteSubscription(topicName: string, subscriptionName: string): Promise<void> {
    await this.adminClient.deleteSubscription(topicName, subscriptionName);
    this.logger.log(`Deleted subscription: ${topicName}/${subscriptionName}`);
  }

  /**
   * Checks if a subscription exists
   */
  async subscriptionExists(topicName: string, subscriptionName: string): Promise<boolean> {
    return this.adminClient.subscriptionExists(topicName, subscriptionName);
  }

  // ============ RULE OPERATIONS ============

  /**
   * Creates a new rule for a subscription
   *
   * @example
   * ```typescript
   * // SQL filter
   * await adminService.createRule('orders', 'processor', 'high-priority',
   *   { sqlExpression: "priority = 'high'" }
   * );
   *
   * // Correlation filter
   * await adminService.createRule('orders', 'processor', 'user-filter',
   *   { correlationId: 'user-123', applicationProperties: { region: 'us-west' } }
   * );
   *
   * // With action
   * await adminService.createRule('orders', 'processor', 'transform',
   *   { sqlExpression: "1=1" },
   *   { sqlExpression: "SET priority = 'processed'" }
   * );
   * ```
   */
  async createRule(
    topicName: string,
    subscriptionName: string,
    ruleName: string,
    filter: SqlRuleFilter | CorrelationRuleFilter,
    action?: SqlRuleAction,
  ): Promise<RuleProperties> {
    let response: RuleProperties;
    if (action) {
      response = await this.adminClient.createRule(
        topicName,
        subscriptionName,
        ruleName,
        filter,
        action,
      );
    } else {
      response = await this.adminClient.createRule(topicName, subscriptionName, ruleName, filter);
    }
    this.logger.log(`Created rule: ${topicName}/${subscriptionName}/${ruleName}`);
    return response;
  }

  /**
   * Gets rule properties
   */
  async getRule(
    topicName: string,
    subscriptionName: string,
    ruleName: string,
  ): Promise<RuleProperties> {
    return this.adminClient.getRule(topicName, subscriptionName, ruleName);
  }

  /**
   * Lists all rules for a subscription
   */
  listRules(
    topicName: string,
    subscriptionName: string,
  ): PagedAsyncIterableIterator<RuleProperties> {
    return this.adminClient.listRules(topicName, subscriptionName);
  }

  /**
   * Deletes a rule
   */
  async deleteRule(topicName: string, subscriptionName: string, ruleName: string): Promise<void> {
    await this.adminClient.deleteRule(topicName, subscriptionName, ruleName);
    this.logger.log(`Deleted rule: ${topicName}/${subscriptionName}/${ruleName}`);
  }

  /**
   * Checks if a rule exists
   */
  async ruleExists(
    topicName: string,
    subscriptionName: string,
    ruleName: string,
  ): Promise<boolean> {
    return this.adminClient.ruleExists(topicName, subscriptionName, ruleName);
  }

  // ============ HELPER METHODS ============

  /**
   * Creates a SQL filter object
   *
   * @example
   * ```typescript
   * const filter = adminService.createSqlFilter("priority = 'high' AND amount > 100");
   * await adminService.createRule('orders', 'processor', 'high-value', filter);
   * ```
   */
  createSqlFilter(
    sqlExpression: string,
    parameters?: Record<string, string | number | boolean>,
  ): SqlRuleFilter {
    return {
      sqlExpression,
      sqlParameters: parameters,
    };
  }

  /**
   * Creates a correlation filter object
   *
   * @example
   * ```typescript
   * const filter = adminService.createCorrelationFilter({
   *   correlationId: 'order-123',
   *   applicationProperties: { priority: 'high' }
   * });
   * await adminService.createRule('orders', 'processor', 'order-filter', filter);
   * ```
   */
  createCorrelationFilter(options: {
    correlationId?: string;
    messageId?: string;
    to?: string;
    replyTo?: string;
    subject?: string;
    sessionId?: string;
    replyToSessionId?: string;
    contentType?: string;
    applicationProperties?: Record<string, string | number | boolean | Date>;
  }): CorrelationRuleFilter {
    return options;
  }

  /**
   * Creates a SQL action object
   *
   * @example
   * ```typescript
   * const action = adminService.createSqlAction("SET priority = 'processed'");
   * ```
   */
  createSqlAction(
    sqlExpression: string,
    parameters?: Record<string, string | number | boolean>,
  ): SqlRuleAction {
    return {
      sqlExpression,
      sqlParameters: parameters,
    };
  }

  /**
   * Ensures a topic exists, creating it if necessary
   */
  async ensureTopic(topicName: string, options?: CreateTopicOptions): Promise<TopicProperties> {
    const exists = await this.topicExists(topicName);
    if (exists) {
      return this.getTopic(topicName);
    }
    return this.createTopic(topicName, options);
  }

  /**
   * Ensures a subscription exists, creating it if necessary
   */
  async ensureSubscription(
    topicName: string,
    subscriptionName: string,
    options?: CreateSubscriptionOptions,
  ): Promise<SubscriptionProperties> {
    const exists = await this.subscriptionExists(topicName, subscriptionName);
    if (exists) {
      return this.getSubscription(topicName, subscriptionName);
    }
    return this.createSubscription(topicName, subscriptionName, options);
  }

  /**
   * Ensures a queue exists, creating it if necessary
   */
  async ensureQueue(queueName: string, options?: CreateQueueOptions): Promise<QueueProperties> {
    const exists = await this.queueExists(queueName);
    if (exists) {
      return this.getQueue(queueName);
    }
    return this.createQueue(queueName, options);
  }
}
