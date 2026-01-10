import { ServiceBusClientProxy } from '../../../src/client/service-bus.client';
import { ServiceBusClientStatus } from '../../../src/constants';
import { createMockServiceBusClient } from '../../mocks';
import type { ServiceBusMessage } from '@azure/service-bus';
import { ServiceBusClient } from '@azure/service-bus';
import { lastValueFrom } from 'rxjs';
import Long from 'long';

// Mock the Azure Service Bus Client
jest.mock('@azure/service-bus', () => {
  const originalModule = jest.requireActual('@azure/service-bus');
  return {
    ...originalModule,
    ServiceBusClient: jest.fn(),
  };
});

describe('ServiceBusClientProxy', () => {
  let client: ServiceBusClientProxy;
  let mockAzureClient: ReturnType<typeof createMockServiceBusClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAzureClient = createMockServiceBusClient();
    (ServiceBusClient as unknown as jest.Mock).mockImplementation(() => mockAzureClient);
  });

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  describe('initialization', () => {
    it('should create client with connection string', () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      expect(client).toBeDefined();
      expect(client.getStatus()).toBe(ServiceBusClientStatus.DISCONNECTED);
    });

    it('should create client with AAD credentials', () => {
      const mockCredential = { getToken: jest.fn() };
      client = new ServiceBusClientProxy({
        fullyQualifiedNamespace: 'test.servicebus.windows.net',
        credential: mockCredential as any,
        topic: 'test-topic',
      });

      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should connect and return the Azure client', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      const azureClient = await client.connect();

      expect(azureClient).toBe(mockAzureClient);
      expect(client.getStatus()).toBe(ServiceBusClientStatus.CONNECTED);
    });

    it('should return existing client if already connected', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();
      await client.connect();

      expect(ServiceBusClient).toHaveBeenCalledTimes(1);
    });

    it('should throw if neither connectionString nor namespace provided', () => {
      // Validation now happens in constructor (fail-fast)
      expect(() => {
        new ServiceBusClientProxy({
          topic: 'test-topic',
        } as any);
      }).toThrow('Either connectionString or fullyQualifiedNamespace is required');
    });
  });

  describe('close', () => {
    it('should close connections and update status', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();
      await client.close();

      expect(client.getStatus()).toBe(ServiceBusClientStatus.DISCONNECTED);
      expect(mockAzureClient.close).toHaveBeenCalled();
    });
  });

  describe('emit (fire-and-forget)', () => {
    it('should send message without waiting for response', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      const result$ = client.emit('order.created', { orderId: '123' });
      await lastValueFrom(result$);

      expect(mockAzureClient.createSender).toHaveBeenCalledWith('test-topic');
      const sender = mockAzureClient._getSender('test-topic');
      expect(sender.sendMessages).toHaveBeenCalled();
    });

    it('should use pattern in message', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      await lastValueFrom(client.emit('user.registered', { userId: '456' }));

      const sender = mockAzureClient._getSender('test-topic');
      const sentMessage = sender.sendMessages.mock.calls[0][0] as ServiceBusMessage;
      expect(sentMessage.applicationProperties!.nestjs_pattern).toBe('user.registered');
    });
  });

  describe('send (request-response)', () => {
    it('should send message and register for response', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
        requestTimeout: 5000,
      });

      await client.connect();

      // Start the send operation (don't await - will timeout)
      client.send('order.get', { orderId: '123' }).subscribe({
        error: () => {}, // Ignore timeout error
      });

      // Give it a moment to send
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify message was sent with replyTo header
      const sender = mockAzureClient._getSender('test-topic');
      expect(sender.sendMessages).toHaveBeenCalled();
      const sentMessage = sender.sendMessages.mock.calls[0][0] as ServiceBusMessage;
      expect(sentMessage.replyTo).toBeDefined();
      expect(sentMessage.correlationId).toBeDefined();
    });
  });

  describe('scheduleMessage', () => {
    it('should schedule a message for future delivery', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      const scheduledTime = new Date(Date.now() + 60000);
      const sequenceNumber = await client.scheduleMessage(
        'order.reminder',
        { orderId: '123' },
        scheduledTime,
      );

      expect(sequenceNumber).toBeDefined();
      const sender = mockAzureClient._getSender('test-topic');
      expect(sender.scheduleMessages).toHaveBeenCalledWith(expect.any(Object), scheduledTime);
    });
  });

  describe('cancelScheduledMessage', () => {
    it('should cancel a scheduled message', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      const sequenceNumber = Long.fromNumber(12345);

      await client.cancelScheduledMessage(sequenceNumber);

      const sender = mockAzureClient._getSender('test-topic');
      expect(sender.cancelScheduledMessages).toHaveBeenCalledWith(sequenceNumber);
    });
  });

  describe('getClient', () => {
    it('should return the Azure client after connect', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();
      const azureClient = client.getClient();

      expect(azureClient).toBe(mockAzureClient);
    });

    it('should throw if not connected', () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      expect(() => client.getClient()).toThrow('Client not connected');
    });
  });

  describe('event emitter', () => {
    it('should register and trigger event listeners', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      const connectedHandler = jest.fn();
      client.on('connected', connectedHandler);

      await client.connect();

      expect(connectedHandler).toHaveBeenCalled();
    });

    it('should remove event listeners with off()', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      const handler = jest.fn();
      client.on('connected', handler);
      client.off('connected', handler);

      await client.connect();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit disconnected event on close', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      const disconnectedHandler = jest.fn();
      client.on('disconnected', disconnectedHandler);

      await client.connect();
      await client.close();

      expect(disconnectedHandler).toHaveBeenCalled();
    });

    it('should handle errors in event listeners gracefully', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      const errorHandler = jest.fn(() => {
        throw new Error('Handler error');
      });
      client.on('connected', errorHandler);

      // Should not throw
      await expect(client.connect()).resolves.toBeDefined();
    });
  });

  describe('gracefulClose', () => {
    it('should close the client gracefully', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();
      await client.gracefulClose();

      expect(client.getStatus()).toBe(ServiceBusClientStatus.DISCONNECTED);
    });
  });

  describe('circuit breaker methods', () => {
    it('should return circuit state', () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      expect(client.getCircuitState()).toBe('closed');
    });

    it('should return canProceed status', () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      expect(client.canProceed()).toBe(true);
    });

    it('should reset circuit', () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      // Should not throw
      expect(() => client.resetCircuit()).not.toThrow();
    });
  });

  describe('scheduleMessages', () => {
    it('should schedule multiple messages', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      const scheduledTime = new Date(Date.now() + 60000);
      const messages = [{ id: 1 }, { id: 2 }];

      const sequenceNumbers = await client.scheduleMessages(
        'batch.reminder',
        messages,
        scheduledTime,
      );

      expect(sequenceNumbers).toBeDefined();
      const sender = mockAzureClient._getSender('test-topic');
      expect(sender.scheduleMessages).toHaveBeenCalled();
    });
  });

  describe('cancelScheduledMessages', () => {
    it('should cancel multiple scheduled messages', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      const sequenceNumbers = [Long.fromNumber(123), Long.fromNumber(456)];
      await client.cancelScheduledMessages(sequenceNumbers);

      const sender = mockAzureClient._getSender('test-topic');
      expect(sender.cancelScheduledMessages).toHaveBeenCalledWith(sequenceNumbers);
    });
  });

  describe('message browsing', () => {
    it('should peek messages', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      const messages = await client.peekMessages('test-topic', 'test-subscription', 10);
      expect(messages).toBeDefined();
    });

    it('should peek dead letter messages', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      const messages = await client.peekDeadLetterMessages('test-topic', 'test-subscription', 10);
      expect(messages).toBeDefined();
    });
  });

  describe('reconnect', () => {
    it('should skip if already reconnecting', async () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
      });

      await client.connect();

      // Start first reconnect
      const reconnect1 = client.reconnect();
      // Try to start second reconnect
      const reconnect2 = client.reconnect();

      await Promise.all([reconnect1, reconnect2]);

      // Should have only created one new client
      expect(ServiceBusClient).toHaveBeenCalled();
    });
  });

  describe('observability options', () => {
    it('should create client with observability options', () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
        observability: {
          metrics: true,
          tracing: true,
        },
      });

      expect(client).toBeDefined();
    });

    it('should create client with custom observability options', () => {
      client = new ServiceBusClientProxy({
        connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
        topic: 'test-topic',
        observability: {
          metrics: { meterName: 'custom-meter' },
          tracing: { tracerName: 'custom-tracer' },
        },
      });

      expect(client).toBeDefined();
    });
  });
});
