import { Test, TestingModule } from '@nestjs/testing';
import {
  ServiceBusAdminService,
  SERVICE_BUS_ADMIN_OPTIONS,
} from '../../../src/admin/service-bus-admin.service';

// Mock the Azure Service Bus Administration Client
jest.mock('@azure/service-bus', () => {
  const mockAdminClient = {
    getNamespaceProperties: jest.fn().mockResolvedValue({ name: 'test-namespace' }),
    // Queue operations
    createQueue: jest.fn().mockImplementation((name) => Promise.resolve({ name })),
    getQueue: jest.fn().mockImplementation((name) => Promise.resolve({ name })),
    getQueueRuntimeProperties: jest
      .fn()
      .mockImplementation((name) => Promise.resolve({ name, activeMessageCount: 10 })),
    listQueues: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { name: 'queue-1' };
        yield { name: 'queue-2' };
      },
    }),
    listQueuesRuntimeProperties: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { name: 'queue-1', activeMessageCount: 5 };
      },
    }),
    updateQueue: jest.fn().mockImplementation((queue) => Promise.resolve(queue)),
    deleteQueue: jest.fn().mockResolvedValue(undefined),
    queueExists: jest.fn().mockResolvedValue(true),
    // Topic operations
    createTopic: jest.fn().mockImplementation((name) => Promise.resolve({ name })),
    getTopic: jest.fn().mockImplementation((name) => Promise.resolve({ name })),
    getTopicRuntimeProperties: jest
      .fn()
      .mockImplementation((name) => Promise.resolve({ name, subscriptionCount: 3 })),
    listTopics: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { name: 'topic-1' };
      },
    }),
    listTopicsRuntimeProperties: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { name: 'topic-1', subscriptionCount: 2 };
      },
    }),
    updateTopic: jest.fn().mockImplementation((topic) => Promise.resolve(topic)),
    deleteTopic: jest.fn().mockResolvedValue(undefined),
    topicExists: jest.fn().mockResolvedValue(true),
    // Subscription operations
    createSubscription: jest
      .fn()
      .mockImplementation((topicName, subscriptionName) =>
        Promise.resolve({ topicName, subscriptionName }),
      ),
    getSubscription: jest
      .fn()
      .mockImplementation((topicName, subscriptionName) =>
        Promise.resolve({ topicName, subscriptionName }),
      ),
    getSubscriptionRuntimeProperties: jest
      .fn()
      .mockImplementation((topicName, subscriptionName) =>
        Promise.resolve({ topicName, subscriptionName, activeMessageCount: 5 }),
      ),
    listSubscriptions: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { subscriptionName: 'sub-1' };
      },
    }),
    listSubscriptionsRuntimeProperties: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { subscriptionName: 'sub-1', activeMessageCount: 3 };
      },
    }),
    updateSubscription: jest.fn().mockImplementation((sub) => Promise.resolve(sub)),
    deleteSubscription: jest.fn().mockResolvedValue(undefined),
    subscriptionExists: jest.fn().mockResolvedValue(true),
    // Rule operations
    createRule: jest
      .fn()
      .mockImplementation((_topicName, _subscriptionName, ruleName) =>
        Promise.resolve({ name: ruleName }),
      ),
    getRule: jest
      .fn()
      .mockImplementation((_topicName, _subscriptionName, ruleName) =>
        Promise.resolve({ name: ruleName }),
      ),
    listRules: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { name: 'rule-1' };
      },
    }),
    deleteRule: jest.fn().mockResolvedValue(undefined),
    ruleExists: jest.fn().mockResolvedValue(true),
  };

  return {
    ServiceBusAdministrationClient: jest.fn().mockImplementation(() => mockAdminClient),
    __mockAdminClient: mockAdminClient,
  };
});

describe('ServiceBusAdminService', () => {
  let service: ServiceBusAdminService;
  let mockAdminClient: any;

  beforeEach(async () => {
    // Get the mock client reference
    const { __mockAdminClient } = jest.requireMock('@azure/service-bus');
    mockAdminClient = __mockAdminClient;

    // Reset all mocks
    Object.values(mockAdminClient).forEach((mock: any) => {
      if (typeof mock.mockClear === 'function') {
        mock.mockClear();
      }
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SERVICE_BUS_ADMIN_OPTIONS,
          useValue: {
            connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
          },
        },
        ServiceBusAdminService,
      ],
    }).compile();

    service = module.get<ServiceBusAdminService>(ServiceBusAdminService);
  });

  describe('initialization', () => {
    it('should create service with connection string', () => {
      expect(service).toBeDefined();
    });

    it('should throw if neither connectionString nor namespace provided', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            {
              provide: SERVICE_BUS_ADMIN_OPTIONS,
              useValue: {},
            },
            ServiceBusAdminService,
          ],
        }).compile(),
      ).rejects.toThrow(
        'Either connectionString or fullyQualifiedNamespace with credential is required',
      );
    });
  });

  describe('namespace operations', () => {
    it('should get namespace properties', async () => {
      const result = await service.getNamespaceProperties();
      expect(result.name).toBe('test-namespace');
      expect(mockAdminClient.getNamespaceProperties).toHaveBeenCalled();
    });
  });

  describe('queue operations', () => {
    it('should create a queue', async () => {
      const result = await service.createQueue('test-queue');
      expect(result.name).toBe('test-queue');
      expect(mockAdminClient.createQueue).toHaveBeenCalledWith('test-queue', undefined);
    });

    it('should create a queue with options', async () => {
      const options = { maxDeliveryCount: 10 };
      await service.createQueue('test-queue', options);
      expect(mockAdminClient.createQueue).toHaveBeenCalledWith('test-queue', options);
    });

    it('should get a queue', async () => {
      const result = await service.getQueue('test-queue');
      expect(result.name).toBe('test-queue');
    });

    it('should get queue runtime properties', async () => {
      const result = await service.getQueueRuntimeProperties('test-queue');
      expect(result.activeMessageCount).toBe(10);
    });

    it('should list queues', async () => {
      const queues = [];
      for await (const queue of service.listQueues()) {
        queues.push(queue);
      }
      expect(queues).toHaveLength(2);
    });

    it('should delete a queue', async () => {
      await service.deleteQueue('test-queue');
      expect(mockAdminClient.deleteQueue).toHaveBeenCalledWith('test-queue');
    });

    it('should check if queue exists', async () => {
      const exists = await service.queueExists('test-queue');
      expect(exists).toBe(true);
    });

    it('should ensure queue exists (create if not)', async () => {
      mockAdminClient.queueExists.mockResolvedValueOnce(false);
      await service.ensureQueue('new-queue');
      expect(mockAdminClient.createQueue).toHaveBeenCalledWith('new-queue', undefined);
    });

    it('should ensure queue exists (return existing)', async () => {
      mockAdminClient.queueExists.mockResolvedValueOnce(true);
      await service.ensureQueue('existing-queue');
      expect(mockAdminClient.getQueue).toHaveBeenCalledWith('existing-queue');
    });
  });

  describe('topic operations', () => {
    it('should create a topic', async () => {
      const result = await service.createTopic('test-topic');
      expect(result.name).toBe('test-topic');
    });

    it('should get a topic', async () => {
      const result = await service.getTopic('test-topic');
      expect(result.name).toBe('test-topic');
    });

    it('should delete a topic', async () => {
      await service.deleteTopic('test-topic');
      expect(mockAdminClient.deleteTopic).toHaveBeenCalledWith('test-topic');
    });

    it('should check if topic exists', async () => {
      const exists = await service.topicExists('test-topic');
      expect(exists).toBe(true);
    });

    it('should ensure topic exists', async () => {
      mockAdminClient.topicExists.mockResolvedValueOnce(false);
      await service.ensureTopic('new-topic');
      expect(mockAdminClient.createTopic).toHaveBeenCalled();
    });
  });

  describe('subscription operations', () => {
    it('should create a subscription', async () => {
      const result = await service.createSubscription('test-topic', 'test-sub');
      expect(result.topicName).toBe('test-topic');
      expect(result.subscriptionName).toBe('test-sub');
    });

    it('should get a subscription', async () => {
      const result = await service.getSubscription('test-topic', 'test-sub');
      expect(result.subscriptionName).toBe('test-sub');
    });

    it('should delete a subscription', async () => {
      await service.deleteSubscription('test-topic', 'test-sub');
      expect(mockAdminClient.deleteSubscription).toHaveBeenCalledWith('test-topic', 'test-sub');
    });

    it('should check if subscription exists', async () => {
      const exists = await service.subscriptionExists('test-topic', 'test-sub');
      expect(exists).toBe(true);
    });

    it('should ensure subscription exists', async () => {
      mockAdminClient.subscriptionExists.mockResolvedValueOnce(false);
      await service.ensureSubscription('test-topic', 'new-sub');
      expect(mockAdminClient.createSubscription).toHaveBeenCalled();
    });
  });

  describe('rule operations', () => {
    it('should create a rule with SQL filter', async () => {
      const filter = { sqlExpression: "priority = 'high'" };
      await service.createRule('test-topic', 'test-sub', 'test-rule', filter);
      expect(mockAdminClient.createRule).toHaveBeenCalledWith(
        'test-topic',
        'test-sub',
        'test-rule',
        filter,
      );
    });

    it('should create a rule with action', async () => {
      const filter = { sqlExpression: '1=1' };
      const action = { sqlExpression: "SET processed = 'true'" };
      await service.createRule('test-topic', 'test-sub', 'test-rule', filter, action);
      expect(mockAdminClient.createRule).toHaveBeenCalledWith(
        'test-topic',
        'test-sub',
        'test-rule',
        filter,
        action,
      );
    });

    it('should get a rule', async () => {
      const result = await service.getRule('test-topic', 'test-sub', 'test-rule');
      expect(result.name).toBe('test-rule');
    });

    it('should delete a rule', async () => {
      await service.deleteRule('test-topic', 'test-sub', 'test-rule');
      expect(mockAdminClient.deleteRule).toHaveBeenCalledWith(
        'test-topic',
        'test-sub',
        'test-rule',
      );
    });

    it('should check if rule exists', async () => {
      const exists = await service.ruleExists('test-topic', 'test-sub', 'test-rule');
      expect(exists).toBe(true);
    });
  });

  describe('helper methods', () => {
    it('should create SQL filter', () => {
      const filter = service.createSqlFilter("priority = 'high'");
      expect(filter).toEqual({ sqlExpression: "priority = 'high'" });
    });

    it('should create SQL filter with parameters', () => {
      const filter = service.createSqlFilter('priority = @priority', { priority: 'high' });
      expect(filter).toEqual({
        sqlExpression: 'priority = @priority',
        sqlParameters: { priority: 'high' },
      });
    });

    it('should create correlation filter', () => {
      const filter = service.createCorrelationFilter({
        correlationId: 'corr-123',
        applicationProperties: { priority: 'high' },
      });
      expect(filter).toEqual({
        correlationId: 'corr-123',
        applicationProperties: { priority: 'high' },
      });
    });

    it('should create SQL action', () => {
      const action = service.createSqlAction("SET processed = 'true'");
      expect(action).toEqual({ sqlExpression: "SET processed = 'true'" });
    });

    it('should create SQL action with parameters', () => {
      const action = service.createSqlAction('SET priority = @newPriority', {
        newPriority: 'low',
      });
      expect(action).toEqual({
        sqlExpression: 'SET priority = @newPriority',
        sqlParameters: { newPriority: 'low' },
      });
    });
  });
});
