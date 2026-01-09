import type {
  ServiceBusSessionReceiver,
  ServiceBusReceivedMessage,
  SubscribeOptions,
  MessageHandlers,
  ProcessErrorArgs,
} from '@azure/service-bus';
import Long from 'long';
import {
  createMockMessage,
  MockMessageOptions,
  MockMessageHandler,
} from './service-bus-receiver.mock';

/**
 * Creates a mock ServiceBusSessionReceiver
 */
export function createMockSessionReceiver(
  sessionId: string = 'test-session',
): jest.Mocked<ServiceBusSessionReceiver> & {
  _simulateMessage: (message: ServiceBusReceivedMessage) => Promise<void>;
  _simulateError: (args: ProcessErrorArgs) => Promise<void>;
  _sessionState: Buffer | undefined;
  _handlers?: MockMessageHandler;
} {
  let messageHandlers: MockMessageHandler | undefined;
  let sessionState: Buffer | undefined;
  let sessionLockedUntil = new Date(Date.now() + 60000);

  const mock = {
    entityPath: 'test-topic/subscriptions/test-subscription',
    receiveMode: 'peekLock',
    identifier: 'test-session-receiver-id',
    isClosed: false,
    sessionId,
    sessionLockedUntilUtc: sessionLockedUntil,

    // Session-specific methods
    getSessionState: jest.fn().mockImplementation(() => {
      return Promise.resolve(sessionState);
    }),

    setSessionState: jest.fn().mockImplementation((state: Buffer) => {
      sessionState = state;
      return Promise.resolve();
    }),

    renewSessionLock: jest.fn().mockImplementation(() => {
      sessionLockedUntil = new Date(Date.now() + 60000);
      (mock as any).sessionLockedUntilUtc = sessionLockedUntil;
      return Promise.resolve(sessionLockedUntil);
    }),

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
            sessionId,
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

    // Test helper: access session state
    get _sessionState() {
      return sessionState;
    },
    set _sessionState(value: Buffer | undefined) {
      sessionState = value;
    },
  };

  return mock as unknown as jest.Mocked<ServiceBusSessionReceiver> & {
    _simulateMessage: (message: ServiceBusReceivedMessage) => Promise<void>;
    _simulateError: (args: ProcessErrorArgs) => Promise<void>;
    _sessionState: Buffer | undefined;
    _handlers?: MockMessageHandler;
  };
}

/**
 * Creates a mock session message
 */
export function createMockSessionMessage(
  sessionId: string,
  options: Omit<MockMessageOptions, 'sessionId'> = {},
): ServiceBusReceivedMessage {
  return createMockMessage({
    ...options,
    sessionId,
    applicationProperties: {
      ...options.applicationProperties,
    },
  });
}
