import type {
  ServiceBusReceiver,
  ServiceBusReceivedMessage,
  SubscribeOptions,
  MessageHandlers,
  ProcessErrorArgs,
} from '@azure/service-bus';
import Long from 'long';

/**
 * Options for creating a mock message
 */
export interface MockMessageOptions {
  body?: any;
  messageId?: string;
  correlationId?: string;
  sessionId?: string;
  pattern?: string;
  replyTo?: string;
  applicationProperties?: Record<string, any>;
  deadLetterReason?: string;
  deadLetterErrorDescription?: string;
  deliveryCount?: number;
  sequenceNumber?: Long | number;
  enqueuedTimeUtc?: Date;
  lockedUntilUtc?: Date;
}

/**
 * Creates a mock ServiceBusReceivedMessage
 */
export function createMockMessage(options: MockMessageOptions = {}): ServiceBusReceivedMessage {
  const sequenceNumber =
    typeof options.sequenceNumber === 'number'
      ? Long.fromNumber(options.sequenceNumber)
      : (options.sequenceNumber ?? Long.fromNumber(1));

  // If applicationProperties is explicitly provided, use it as-is
  // Otherwise, build default properties with pattern and nestjs marker
  const applicationProperties =
    options.applicationProperties !== undefined
      ? options.applicationProperties
      : {
          nestjs: true,
          nestjs_pattern: options.pattern ?? 'test.pattern',
        };

  return {
    body: options.body ?? { test: 'data' },
    messageId: options.messageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    correlationId: options.correlationId,
    sessionId: options.sessionId,
    contentType: 'application/json',
    subject: undefined,
    to: undefined,
    replyTo: options.replyTo,
    replyToSessionId: undefined,
    partitionKey: options.sessionId,
    timeToLive: undefined,
    applicationProperties,
    sequenceNumber,
    enqueuedSequenceNumber: undefined,
    enqueuedTimeUtc: options.enqueuedTimeUtc ?? new Date(),
    expiresAtUtc: new Date(Date.now() + 60000),
    lockedUntilUtc: options.lockedUntilUtc ?? new Date(Date.now() + 30000),
    lockToken: `lock-${Date.now()}`,
    deliveryCount: options.deliveryCount ?? 1,
    deadLetterSource: undefined,
    deadLetterReason: options.deadLetterReason,
    deadLetterErrorDescription: options.deadLetterErrorDescription,
    state: 'active',
    _rawAmqpMessage: {} as any,
  } as ServiceBusReceivedMessage;
}

/**
 * Type for the message handler stored by mock receiver
 */
export interface MockMessageHandler {
  processMessage: (message: ServiceBusReceivedMessage) => Promise<void>;
  processError: (args: ProcessErrorArgs) => Promise<void>;
}

/**
 * Creates a mock ServiceBusReceiver
 */
export function createMockReceiver(): jest.Mocked<ServiceBusReceiver> & {
  _simulateMessage: (message: ServiceBusReceivedMessage) => Promise<void>;
  _simulateError: (args: ProcessErrorArgs) => Promise<void>;
  _handlers?: MockMessageHandler;
} {
  let messageHandlers: MockMessageHandler | undefined;

  const mock = {
    entityPath: 'test-topic/subscriptions/test-subscription',
    receiveMode: 'peekLock',
    identifier: 'test-receiver-id',
    isClosed: false,

    // Subscribe method - stores handlers for simulation
    subscribe: jest.fn(
      (handlers: MessageHandlers, _options?: SubscribeOptions): { close: () => Promise<void> } => {
        messageHandlers = handlers as MockMessageHandler;
        (mock as any)._handlers = handlers;
        return {
          close: jest.fn().mockResolvedValue(undefined),
        };
      },
    ),

    // Receive messages (for manual receive mode)
    receiveMessages: jest.fn().mockResolvedValue([]),

    // Peek messages without locking
    peekMessages: jest.fn().mockResolvedValue([]),

    // Receive deferred messages by sequence number
    receiveDeferredMessages: jest.fn().mockImplementation((sequenceNumbers: Long[]) => {
      return Promise.resolve(
        sequenceNumbers.map((seq) =>
          createMockMessage({
            sequenceNumber: seq,
            body: { deferred: true },
          }),
        ),
      );
    }),

    // Message settlement methods
    completeMessage: jest.fn().mockResolvedValue(undefined),
    abandonMessage: jest.fn().mockResolvedValue(undefined),
    deferMessage: jest.fn().mockResolvedValue(undefined),
    deadLetterMessage: jest.fn().mockResolvedValue(undefined),

    // Renew message lock
    renewMessageLock: jest.fn().mockImplementation(() => {
      return Promise.resolve(new Date(Date.now() + 30000));
    }),

    // Close receiver
    close: jest.fn().mockResolvedValue(undefined),

    // Test helper: simulate receiving a message
    _simulateMessage: async (message: ServiceBusReceivedMessage) => {
      if (messageHandlers) {
        await messageHandlers.processMessage(message);
      }
    },

    // Test helper: simulate an error
    _simulateError: async (args: ProcessErrorArgs) => {
      if (messageHandlers) {
        await messageHandlers.processError(args);
      }
    },
  };

  return mock as unknown as jest.Mocked<ServiceBusReceiver> & {
    _simulateMessage: (message: ServiceBusReceivedMessage) => Promise<void>;
    _simulateError: (args: ProcessErrorArgs) => Promise<void>;
    _handlers?: MockMessageHandler;
  };
}

/**
 * Creates a mock receiver factory
 */
export function createMockReceiverFactory(): jest.Mock {
  const receivers = new Map<string, ReturnType<typeof createMockReceiver>>();

  return jest.fn((topicName: string, subscriptionName: string, options?: any) => {
    const key = `${topicName}/${subscriptionName}/${options?.subQueueType ?? 'main'}`;
    if (!receivers.has(key)) {
      const receiver = createMockReceiver();
      (receiver as any).entityPath = `${topicName}/subscriptions/${subscriptionName}`;
      receivers.set(key, receiver);
    }
    return receivers.get(key)!;
  });
}
