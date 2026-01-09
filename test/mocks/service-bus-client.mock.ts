import type { ServiceBusClient as AzureServiceBusClient } from '@azure/service-bus';
import { createMockSender } from './service-bus-sender.mock';
import { createMockReceiver } from './service-bus-receiver.mock';
import { createMockSessionReceiver } from './service-bus-session-receiver.mock';

/**
 * Creates a mock Azure ServiceBusClient
 */
export function createMockServiceBusClient(): jest.Mocked<AzureServiceBusClient> & {
  _senders: Map<string, ReturnType<typeof createMockSender>>;
  _receivers: Map<string, ReturnType<typeof createMockReceiver>>;
  _sessionReceivers: Map<string, ReturnType<typeof createMockSessionReceiver>>;
  _getSender: (topic: string) => ReturnType<typeof createMockSender>;
  _getReceiver: (topic: string, subscription: string) => ReturnType<typeof createMockReceiver>;
  _getSessionReceiver: (
    topic: string,
    subscription: string,
    sessionId: string,
  ) => ReturnType<typeof createMockSessionReceiver>;
} {
  const senders = new Map<string, ReturnType<typeof createMockSender>>();
  const receivers = new Map<string, ReturnType<typeof createMockReceiver>>();
  const sessionReceivers = new Map<string, ReturnType<typeof createMockSessionReceiver>>();

  const mock = {
    fullyQualifiedNamespace: 'test.servicebus.windows.net',
    identifier: 'test-client-id',

    // Create sender for a topic
    createSender: jest.fn((topicName: string) => {
      if (!senders.has(topicName)) {
        const sender = createMockSender();
        (sender as any).entityPath = topicName;
        senders.set(topicName, sender);
      }
      return senders.get(topicName)!;
    }),

    // Create receiver for a subscription
    createReceiver: jest.fn((topicName: string, subscriptionName: string, options?: any) => {
      const key = `${topicName}/${subscriptionName}/${options?.subQueueType ?? 'main'}`;
      if (!receivers.has(key)) {
        const receiver = createMockReceiver();
        (receiver as any).entityPath = `${topicName}/subscriptions/${subscriptionName}`;
        receivers.set(key, receiver);
      }
      return receivers.get(key)!;
    }),

    // Accept a specific session
    acceptSession: jest.fn(
      (topicName: string, subscriptionName: string, sessionId: string, _options?: any) => {
        const key = `${topicName}/${subscriptionName}/${sessionId}`;
        if (!sessionReceivers.has(key)) {
          const sessionReceiver = createMockSessionReceiver(sessionId);
          (sessionReceiver as any).entityPath = `${topicName}/subscriptions/${subscriptionName}`;
          sessionReceivers.set(key, sessionReceiver);
        }
        return Promise.resolve(sessionReceivers.get(key)!);
      },
    ),

    // Accept the next available session
    acceptNextSession: jest.fn((topicName: string, subscriptionName: string, _options?: any) => {
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const key = `${topicName}/${subscriptionName}/${sessionId}`;
      const sessionReceiver = createMockSessionReceiver(sessionId);
      (sessionReceiver as any).entityPath = `${topicName}/subscriptions/${subscriptionName}`;
      sessionReceivers.set(key, sessionReceiver);
      return Promise.resolve(sessionReceiver);
    }),

    // Close the client
    close: jest.fn().mockResolvedValue(undefined),

    // Test helpers
    _senders: senders,
    _receivers: receivers,
    _sessionReceivers: sessionReceivers,

    _getSender: (topic: string) => senders.get(topic)!,
    _getReceiver: (topic: string, subscription: string) =>
      receivers.get(`${topic}/${subscription}/main`)!,
    _getSessionReceiver: (topic: string, subscription: string, sessionId: string) =>
      sessionReceivers.get(`${topic}/${subscription}/${sessionId}`)!,
  };

  return mock as unknown as jest.Mocked<AzureServiceBusClient> & {
    _senders: Map<string, ReturnType<typeof createMockSender>>;
    _receivers: Map<string, ReturnType<typeof createMockReceiver>>;
    _sessionReceivers: Map<string, ReturnType<typeof createMockSessionReceiver>>;
    _getSender: (topic: string) => ReturnType<typeof createMockSender>;
    _getReceiver: (topic: string, subscription: string) => ReturnType<typeof createMockReceiver>;
    _getSessionReceiver: (
      topic: string,
      subscription: string,
      sessionId: string,
    ) => ReturnType<typeof createMockSessionReceiver>;
  };
}

/**
 * Mock factory for ServiceBusClient constructor
 */
export function createMockServiceBusClientFactory() {
  return jest.fn((_connectionStringOrNamespace: string, _credential?: any) => {
    return createMockServiceBusClient();
  });
}
