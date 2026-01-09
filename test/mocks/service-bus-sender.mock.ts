import type {
  ServiceBusSender,
  ServiceBusMessageBatch,
  ServiceBusMessage,
} from '@azure/service-bus';
import Long from 'long';

/**
 * Creates a mock ServiceBusMessageBatch
 */
export function createMockMessageBatch(): jest.Mocked<ServiceBusMessageBatch> {
  const messages: ServiceBusMessage[] = [];
  let currentSize = 0;
  const maxSize = 1024 * 256; // 256KB default

  return {
    maxSizeInBytes: maxSize,
    sizeInBytes: currentSize,
    count: 0,
    tryAddMessage: jest.fn((message: ServiceBusMessage) => {
      const estimatedSize = JSON.stringify(message.body).length + 100;
      if (currentSize + estimatedSize > maxSize) {
        return false;
      }
      messages.push(message);
      currentSize += estimatedSize;
      return true;
    }),
    // Internal property for test access
    _messages: messages,
  } as unknown as jest.Mocked<ServiceBusMessageBatch>;
}

/**
 * Creates a mock ServiceBusSender
 */
export function createMockSender(): jest.Mocked<ServiceBusSender> {
  return {
    entityPath: 'test-topic',
    identifier: 'test-sender-id',
    isClosed: false,

    sendMessages: jest.fn().mockResolvedValue(undefined),

    createMessageBatch: jest.fn().mockResolvedValue(createMockMessageBatch()),

    scheduleMessages: jest
      .fn()
      .mockImplementation(
        (
          _messages: ServiceBusMessage | ServiceBusMessage[],
          _scheduledEnqueueTimeUtc: Date,
        ): Promise<Long[]> => {
          const count = Array.isArray(_messages) ? _messages.length : 1;
          return Promise.resolve(Array.from({ length: count }, (_, i) => Long.fromNumber(i + 1)));
        },
      ),

    cancelScheduledMessages: jest.fn().mockResolvedValue(undefined),

    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ServiceBusSender>;
}

/**
 * Creates a mock sender factory that returns new mocks
 */
export function createMockSenderFactory(): jest.Mock<jest.Mocked<ServiceBusSender>, [string]> {
  const senders = new Map<string, jest.Mocked<ServiceBusSender>>();

  return jest.fn((topicName: string) => {
    if (!senders.has(topicName)) {
      const sender = createMockSender();
      (sender as any).entityPath = topicName;
      senders.set(topicName, sender);
    }
    return senders.get(topicName)!;
  });
}
