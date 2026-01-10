import { ServiceBusServer } from '../../../src/server/service-bus.server';
import { ServiceBusServerStatus } from '../../../src/constants';
import { createMockServiceBusClient, createMockMessage } from '../../mocks';
import { ServiceBusClient } from '@azure/service-bus';
import { of } from 'rxjs';

// Mock the Azure Service Bus Client
jest.mock('@azure/service-bus', () => {
  const originalModule = jest.requireActual('@azure/service-bus');
  return {
    ...originalModule,
    ServiceBusClient: jest.fn(),
  };
});

describe('ServiceBusServer', () => {
  let server: ServiceBusServer;
  let mockClient: ReturnType<typeof createMockServiceBusClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = createMockServiceBusClient();
    (ServiceBusClient as unknown as jest.Mock).mockImplementation(() => mockClient);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('initialization', () => {
    it('should create server with connection string', () => {
      server = new ServiceBusServer({
        connectionString:
          'Endpoint=sb://test.servicebus.windows.net/;SharedAccessKeyName=test;SharedAccessKey=key',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      expect(server).toBeDefined();
      expect(server.getStatus()).toBe(ServiceBusServerStatus.DISCONNECTED);
    });

    it('should create server with AAD credentials', () => {
      const mockCredential = { getToken: jest.fn() };
      server = new ServiceBusServer({
        fullyQualifiedNamespace: 'test.servicebus.windows.net',
        credential: mockCredential as any,
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      expect(server).toBeDefined();
    });
  });

  describe('listen', () => {
    it('should connect and start listening', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      const callback = jest.fn();
      await server.listen(callback);

      expect(callback).toHaveBeenCalled();
      expect(server.getStatus()).toBe(ServiceBusServerStatus.CONNECTED);
      expect(mockClient.createReceiver).toHaveBeenCalledWith(
        'test-topic',
        'test-sub',
        expect.any(Object),
      );
    });

    it('should handle multiple subscriptions', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [
          { topic: 'topic1', subscription: 'sub1' },
          { topic: 'topic2', subscription: 'sub2' },
        ],
      });

      await server.listen(jest.fn());

      expect(mockClient.createReceiver).toHaveBeenCalledTimes(2);
    });

    it('should handle session-enabled subscriptions', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub', sessionEnabled: true }],
      });

      await server.listen(jest.fn());

      // For session-enabled, we use acceptNextSession instead of createReceiver
      // The session manager will call acceptNextSession in its loop
      expect(server.getStatus()).toBe(ServiceBusServerStatus.CONNECTED);
    });

    it('should emit connected event', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      const connectedHandler = jest.fn();
      server.on('connected', connectedHandler);

      await server.listen(jest.fn());

      expect(connectedHandler).toHaveBeenCalled();
    });

    it('should throw if neither connectionString nor namespace provided', () => {
      // Validation now happens in constructor (fail-fast)
      expect(() => {
        new ServiceBusServer({
          subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
        } as any);
      }).toThrow('Either connectionString or fullyQualifiedNamespace is required');
    });
  });

  describe('close', () => {
    it('should close connections and update status', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      await server.listen(jest.fn());
      await server.close();

      expect(server.getStatus()).toBe(ServiceBusServerStatus.DISCONNECTED);
      expect(mockClient.close).toHaveBeenCalled();
    });

    it('should emit disconnected event', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      const disconnectedHandler = jest.fn();
      server.on('disconnected', disconnectedHandler);

      await server.listen(jest.fn());
      await server.close();

      expect(disconnectedHandler).toHaveBeenCalled();
    });
  });

  describe('getClient', () => {
    it('should return the Azure client after listen', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      await server.listen(jest.fn());
      const client = server.getClient();

      expect(client).toBe(mockClient);
    });

    it('should throw if not connected', () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      expect(() => server.getClient()).toThrow('Client not initialized');
    });
  });

  describe('getSubscriptionManagersInfo', () => {
    it('should return info about active subscription managers', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [
          { topic: 'topic1', subscription: 'sub1' },
          { topic: 'topic2', subscription: 'sub2', handleDeadLetter: true },
        ],
      });

      await server.listen(jest.fn());
      const info = server.getSubscriptionManagersInfo();

      expect(info).toHaveLength(2);
      expect(info[0]).toMatchObject({
        topic: 'topic1',
        subscription: 'sub1',
        sessionEnabled: false,
        handleDeadLetter: false,
      });
      expect(info[1]).toMatchObject({
        topic: 'topic2',
        subscription: 'sub2',
        handleDeadLetter: true,
      });
    });
  });

  describe('message handling', () => {
    it('should route messages to registered handlers', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
        autoComplete: true,
      });

      // Register a handler using NestJS's addHandler method
      const handler = jest.fn().mockResolvedValue(undefined);
      server.addHandler('test.pattern', handler, true); // isEventHandler = true

      await server.listen(jest.fn());

      // Simulate receiving a message
      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        pattern: 'test.pattern',
        body: { data: 'test' },
      });

      await receiver._simulateMessage(message);

      expect(handler).toHaveBeenCalled();
    });

    it('should complete messages without handlers', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        pattern: 'unknown.pattern',
        body: { data: 'test' },
      });

      await receiver._simulateMessage(message);

      expect(receiver.completeMessage).toHaveBeenCalledWith(message);
    });

    it('should skip non-NestJS messages', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        body: { data: 'test' },
        applicationProperties: {}, // No NestJS marker
      });

      await receiver._simulateMessage(message);

      expect(receiver.completeMessage).toHaveBeenCalledWith(message);
    });
  });

  describe('dead letter queue', () => {
    it('should create DLQ receiver when handleDeadLetter is true', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub', handleDeadLetter: true }],
      });

      await server.listen(jest.fn());

      // Should create both regular and DLQ receivers
      expect(mockClient.createReceiver).toHaveBeenCalledWith(
        'test-topic',
        'test-sub',
        expect.objectContaining({ subQueueType: 'deadLetter' }),
      );
    });
  });

  describe('error handling', () => {
    it('should emit error event on subscription error', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      const errorHandler = jest.fn();
      server.on('error', errorHandler);

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      await receiver._simulateError({
        error: new Error('Test error'),
        errorSource: 'receive',
        entityPath: 'test-topic/subscriptions/test-sub',
        fullyQualifiedNamespace: 'test.servicebus.windows.net',
        identifier: 'test',
      });

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle event listener errors gracefully', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      // Register a handler that throws
      server.on('connected', () => {
        throw new Error('Listener error');
      });

      // Should not throw despite listener error
      await expect(server.listen(jest.fn())).resolves.not.toThrow();
    });

    it('should auto dead-letter on handler error when autoDeadLetter is true', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
        autoDeadLetter: true,
        autoComplete: false,
      });

      // Register a handler that throws
      const handler = jest.fn().mockRejectedValue(new Error('Handler error'));
      server.addHandler('test.pattern', handler, true);

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        pattern: 'test.pattern',
        body: { data: 'test' },
      });

      // Should throw but also call deadLetterMessage
      await expect(receiver._simulateMessage(message)).rejects.toThrow('Handler error');
      expect(receiver.deadLetterMessage).toHaveBeenCalled();
    });
  });

  describe('request-response pattern', () => {
    it('should handle request-response messages with replyTo', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
        autoComplete: true,
      });

      // Register a non-event handler (request-response)
      const handler = jest.fn().mockResolvedValue({ result: 'success' });
      server.addHandler('test.query', handler, false); // isEventHandler = false

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        pattern: 'test.query',
        body: { query: 'test' },
        correlationId: 'corr-123',
        replyTo: 'reply-topic/subscriptions/reply-sub',
      });

      await receiver._simulateMessage(message);

      // Wait for process.nextTick (used by base class send() method)
      await new Promise((resolve) => process.nextTick(resolve));

      expect(handler).toHaveBeenCalled();
      // Should have created a sender for the reply topic
      expect(mockClient.createSender).toHaveBeenCalledWith('reply-topic');
    });

    it('should handle Observable results', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
        autoComplete: true,
      });

      // Return an Observable
      const handler = jest.fn().mockReturnValue(of({ result: 'observable-result' }));
      server.addHandler('test.query', handler, false);

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        pattern: 'test.query',
        body: { query: 'test' },
        correlationId: 'corr-123',
        replyTo: 'reply-topic',
      });

      await receiver._simulateMessage(message);

      // Wait for process.nextTick (used by base class send() method)
      await new Promise((resolve) => process.nextTick(resolve));

      expect(handler).toHaveBeenCalled();
      expect(mockClient.createSender).toHaveBeenCalledWith('reply-topic');
    });

    it('should handle Promise results', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
        autoComplete: true,
      });

      // Return a Promise
      const handler = jest.fn().mockReturnValue(Promise.resolve({ result: 'promise-result' }));
      server.addHandler('test.query', handler, false);

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        pattern: 'test.query',
        body: { query: 'test' },
        correlationId: 'corr-123',
        replyTo: 'reply-topic',
      });

      await receiver._simulateMessage(message);

      expect(handler).toHaveBeenCalled();
    });

    it('should handle errors in request-response and send error response', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
        autoComplete: false,
        autoDeadLetter: false,
      });

      // Return an error
      const handler = jest.fn().mockRejectedValue(new Error('Query failed'));
      server.addHandler('test.query', handler, false);

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        pattern: 'test.query',
        body: { query: 'test' },
        correlationId: 'corr-123',
        replyTo: 'reply-topic',
      });

      await expect(receiver._simulateMessage(message)).rejects.toThrow('Query failed');
    });

    it('should skip response if no replyTo', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
        autoComplete: true,
      });

      const handler = jest.fn().mockResolvedValue({ result: 'success' });
      server.addHandler('test.query', handler, false);

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      const message = createMockMessage({
        pattern: 'test.query',
        body: { query: 'test' },
        correlationId: 'corr-123',
        // No replyTo
      });

      await receiver._simulateMessage(message);

      expect(handler).toHaveBeenCalled();
      // Should NOT create a sender since there's no replyTo
      expect(mockClient.createSender).not.toHaveBeenCalled();
    });
  });

  describe('response message handling', () => {
    it('should skip response messages received on server', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      await server.listen(jest.fn());

      const receiver = mockClient._getReceiver('test-topic', 'test-sub');

      // Create a response message (has nestjs_is_response property)
      const message = createMockMessage({
        body: { response: 'data' },
        applicationProperties: {
          nestjs: true,
          nestjs_is_response: true,
        },
      });

      await receiver._simulateMessage(message);

      expect(receiver.completeMessage).toHaveBeenCalledWith(message);
    });
  });

  describe('Azure AD authentication', () => {
    it('should create client with credential', async () => {
      const mockCredential = { getToken: jest.fn() };

      server = new ServiceBusServer({
        fullyQualifiedNamespace: 'test.servicebus.windows.net',
        credential: mockCredential as any,
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      await server.listen(jest.fn());

      expect(ServiceBusClient).toHaveBeenCalledWith(
        'test.servicebus.windows.net',
        mockCredential,
        undefined, // clientOptions
      );
    });
  });

  describe('close error handling', () => {
    it('should handle subscription manager stop errors', async () => {
      server = new ServiceBusServer({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        subscriptions: [{ topic: 'test-topic', subscription: 'test-sub' }],
      });

      await server.listen(jest.fn());

      // Make the receiver close throw an error
      const receiver = mockClient._getReceiver('test-topic', 'test-sub');
      receiver.close.mockRejectedValue(new Error('Close failed'));

      // Should not throw
      await expect(server.close()).resolves.not.toThrow();
    });
  });
});
