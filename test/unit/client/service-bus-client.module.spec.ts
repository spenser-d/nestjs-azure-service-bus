import { Test, TestingModule } from '@nestjs/testing';
import { ServiceBusClientModule } from '../../../src/client/service-bus-client.module';
import { ServiceBusClientProxy } from '../../../src/client/service-bus.client';

// Mock ServiceBusClientProxy
jest.mock('../../../src/client/service-bus.client', () => ({
  ServiceBusClientProxy: jest.fn().mockImplementation((options) => ({
    options,
    connect: jest.fn(),
    close: jest.fn(),
    emit: jest.fn(),
    send: jest.fn(),
  })),
}));

describe('ServiceBusClientModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a single client synchronously', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ServiceBusClientModule.register([
            {
              name: 'ORDER_SERVICE',
              connectionString:
                'Endpoint=sb://test.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=test',
              topic: 'orders',
            },
          ]),
        ],
      }).compile();

      const client = module.get('ORDER_SERVICE');
      expect(client).toBeDefined();
      expect(ServiceBusClientProxy).toHaveBeenCalledWith({
        connectionString:
          'Endpoint=sb://test.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=test',
        topic: 'orders',
      });
    });

    it('should register multiple clients synchronously', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ServiceBusClientModule.register([
            {
              name: 'ORDER_SERVICE',
              connectionString: 'Endpoint=sb://test1.servicebus.windows.net/',
              topic: 'orders',
            },
            {
              name: 'PAYMENT_SERVICE',
              connectionString: 'Endpoint=sb://test2.servicebus.windows.net/',
              topic: 'payments',
            },
          ]),
        ],
      }).compile();

      const orderClient = module.get('ORDER_SERVICE');
      const paymentClient = module.get('PAYMENT_SERVICE');

      expect(orderClient).toBeDefined();
      expect(paymentClient).toBeDefined();
      expect(ServiceBusClientProxy).toHaveBeenCalledTimes(2);
    });

    it('should export registered clients', async () => {
      const dynamicModule = ServiceBusClientModule.register([
        {
          name: 'ORDER_SERVICE',
          connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
          topic: 'orders',
        },
      ]);

      expect(dynamicModule.exports).toContain('ORDER_SERVICE');
    });

    it('should pass all options except name to the client', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ServiceBusClientModule.register([
            {
              name: 'FULL_OPTIONS_CLIENT',
              connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
              topic: 'events',
              replyTopic: 'reply-topic',
              replySubscription: 'reply-sub',
              serializer: { serialize: jest.fn() } as any,
              deserializer: { deserialize: jest.fn() } as any,
            },
          ]),
        ],
      }).compile();

      const client = module.get('FULL_OPTIONS_CLIENT');
      expect(client).toBeDefined();
      expect(ServiceBusClientProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
          topic: 'events',
          replyTopic: 'reply-topic',
          replySubscription: 'reply-sub',
        }),
      );
      // Ensure 'name' is not passed to the client
      expect(ServiceBusClientProxy).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'FULL_OPTIONS_CLIENT' }),
      );
    });
  });

  describe('registerAsync', () => {
    it('should register a client asynchronously with useFactory', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ServiceBusClientModule.registerAsync([
            {
              name: 'ASYNC_ORDER_SERVICE',
              useFactory: () => ({
                connectionString: 'Endpoint=sb://async-test.servicebus.windows.net/',
                topic: 'async-orders',
              }),
            },
          ]),
        ],
      }).compile();

      const client = module.get('ASYNC_ORDER_SERVICE');
      expect(client).toBeDefined();
      expect(ServiceBusClientProxy).toHaveBeenCalledWith({
        connectionString: 'Endpoint=sb://async-test.servicebus.windows.net/',
        topic: 'async-orders',
      });
    });

    it('should register multiple clients asynchronously', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ServiceBusClientModule.registerAsync([
            {
              name: 'ASYNC_ORDER_SERVICE',
              useFactory: () => ({
                connectionString: 'Endpoint=sb://test1.servicebus.windows.net/',
                topic: 'orders',
              }),
            },
            {
              name: 'ASYNC_PAYMENT_SERVICE',
              useFactory: () => ({
                connectionString: 'Endpoint=sb://test2.servicebus.windows.net/',
                topic: 'payments',
              }),
            },
          ]),
        ],
      }).compile();

      const orderClient = module.get('ASYNC_ORDER_SERVICE');
      const paymentClient = module.get('ASYNC_PAYMENT_SERVICE');

      expect(orderClient).toBeDefined();
      expect(paymentClient).toBeDefined();
      expect(ServiceBusClientProxy).toHaveBeenCalledTimes(2);
    });

    it('should support async useFactory', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ServiceBusClientModule.registerAsync([
            {
              name: 'ASYNC_CLIENT',
              useFactory: async () => {
                // Simulate async operation
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                  connectionString: 'Endpoint=sb://delayed.servicebus.windows.net/',
                  topic: 'delayed-topic',
                };
              },
            },
          ]),
        ],
      }).compile();

      const client = module.get('ASYNC_CLIENT');
      expect(client).toBeDefined();
      expect(ServiceBusClientProxy).toHaveBeenCalledWith({
        connectionString: 'Endpoint=sb://delayed.servicebus.windows.net/',
        topic: 'delayed-topic',
      });
    });

    it('should inject dependencies into useFactory', async () => {
      const mockConfigService = {
        get: jest.fn().mockReturnValue('Endpoint=sb://injected.servicebus.windows.net/'),
      };

      // Create a mock module that provides ConfigService
      const ConfigModule = {
        module: class ConfigModule {},
        providers: [
          {
            provide: 'ConfigService',
            useValue: mockConfigService,
          },
        ],
        exports: ['ConfigService'],
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule,
          ServiceBusClientModule.registerAsync([
            {
              name: 'INJECTED_CLIENT',
              imports: [ConfigModule],
              useFactory: (config: typeof mockConfigService) => ({
                connectionString: config.get('SERVICE_BUS_CONNECTION_STRING'),
                topic: 'injected-topic',
              }),
              inject: ['ConfigService'],
            },
          ]),
        ],
      }).compile();

      const client = module.get('INJECTED_CLIENT');
      expect(client).toBeDefined();
      expect(mockConfigService.get).toHaveBeenCalledWith('SERVICE_BUS_CONNECTION_STRING');
      expect(ServiceBusClientProxy).toHaveBeenCalledWith({
        connectionString: 'Endpoint=sb://injected.servicebus.windows.net/',
        topic: 'injected-topic',
      });
    });

    it('should handle empty inject array', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ServiceBusClientModule.registerAsync([
            {
              name: 'NO_INJECT_CLIENT',
              useFactory: () => ({
                connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
                topic: 'test-topic',
              }),
              inject: [],
            },
          ]),
        ],
      }).compile();

      const client = module.get('NO_INJECT_CLIENT');
      expect(client).toBeDefined();
    });

    it('should handle undefined inject', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ServiceBusClientModule.registerAsync([
            {
              name: 'UNDEFINED_INJECT_CLIENT',
              useFactory: () => ({
                connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
                topic: 'test-topic',
              }),
              // inject is undefined
            },
          ]),
        ],
      }).compile();

      const client = module.get('UNDEFINED_INJECT_CLIENT');
      expect(client).toBeDefined();
    });

    it('should export async registered clients', async () => {
      const dynamicModule = ServiceBusClientModule.registerAsync([
        {
          name: 'ASYNC_EXPORT_CLIENT',
          useFactory: () => ({
            connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
            topic: 'test-topic',
          }),
        },
      ]);

      expect(dynamicModule.exports).toContain('ASYNC_EXPORT_CLIENT');
    });

    it('should include imports from async options', async () => {
      const MockModule = { module: class {}, providers: [], exports: [] };

      const dynamicModule = ServiceBusClientModule.registerAsync([
        {
          name: 'CLIENT_WITH_IMPORTS',
          imports: [MockModule as any],
          useFactory: () => ({
            connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
            topic: 'test-topic',
          }),
        },
      ]);

      expect(dynamicModule.imports).toContain(MockModule);
    });

    it('should handle empty imports array', async () => {
      const dynamicModule = ServiceBusClientModule.registerAsync([
        {
          name: 'CLIENT_NO_IMPORTS',
          imports: [],
          useFactory: () => ({
            connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
            topic: 'test-topic',
          }),
        },
      ]);

      expect(dynamicModule.imports).toEqual([]);
    });

    it('should handle undefined imports', async () => {
      const dynamicModule = ServiceBusClientModule.registerAsync([
        {
          name: 'CLIENT_UNDEFINED_IMPORTS',
          // imports is undefined
          useFactory: () => ({
            connectionString: 'Endpoint=sb://test.servicebus.windows.net/',
            topic: 'test-topic',
          }),
        },
      ]);

      expect(dynamicModule.imports).toEqual([]);
    });

    it('should flatten imports from multiple async options', async () => {
      const MockModule1 = { module: class {} };
      const MockModule2 = { module: class {} };

      const dynamicModule = ServiceBusClientModule.registerAsync([
        {
          name: 'CLIENT_1',
          imports: [MockModule1 as any],
          useFactory: () => ({
            connectionString: 'Endpoint=sb://test1.servicebus.windows.net/',
            topic: 'topic-1',
          }),
        },
        {
          name: 'CLIENT_2',
          imports: [MockModule2 as any],
          useFactory: () => ({
            connectionString: 'Endpoint=sb://test2.servicebus.windows.net/',
            topic: 'topic-2',
          }),
        },
      ]);

      expect(dynamicModule.imports).toContain(MockModule1);
      expect(dynamicModule.imports).toContain(MockModule2);
    });
  });
});
