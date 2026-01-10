import { DynamicModule, Module, Provider, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ServiceBusClientProxy } from './service-bus.client';
import type {
  ServiceBusClientModuleOptions,
  ServiceBusClientModuleAsyncOptions,
} from '../interfaces';

/**
 * Token for tracking registered client names
 */
const SERVICE_BUS_CLIENT_NAMES = Symbol('SERVICE_BUS_CLIENT_NAMES');

/**
 * Module for registering Azure Service Bus clients
 *
 * Automatically closes all registered clients when the module is destroyed.
 *
 * @example
 * ```typescript
 * // Sync registration
 * ServiceBusClientModule.register([
 *   {
 *     name: 'ORDER_SERVICE',
 *     connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
 *     topic: 'orders',
 *   },
 * ]);
 *
 * // Async registration
 * ServiceBusClientModule.registerAsync([
 *   {
 *     name: 'ORDER_SERVICE',
 *     useFactory: (config: ConfigService) => ({
 *       connectionString: config.get('SERVICE_BUS_CONNECTION_STRING'),
 *       topic: 'orders',
 *     }),
 *     inject: [ConfigService],
 *   },
 * ]);
 * ```
 */
@Module({})
export class ServiceBusClientModule implements OnModuleDestroy {
  private readonly logger = new Logger(ServiceBusClientModule.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(SERVICE_BUS_CLIENT_NAMES)
    private readonly clientNames: (string | symbol)[],
  ) {}

  /**
   * Called when the module is being destroyed
   * Gracefully closes all registered clients
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing Service Bus clients...');

    const closePromises = this.clientNames.map(async (name) => {
      try {
        const client = this.moduleRef.get<ServiceBusClientProxy>(name, { strict: false });
        if (client && typeof client.gracefulClose === 'function') {
          await client.gracefulClose();
          this.logger.debug(`Closed client '${String(name)}'`);
        }
      } catch (error) {
        this.logger.warn(`Error closing client '${String(name)}': ${(error as Error).message}`);
      }
    });

    await Promise.all(closePromises);
    this.logger.log('All Service Bus clients closed');
  }

  /**
   * Registers one or more Service Bus clients synchronously
   */
  static register(options: ServiceBusClientModuleOptions[]): DynamicModule {
    const providers = options.map((opt) => this.createClientProvider(opt));
    const exports = options.map((opt) => opt.name);
    const clientNames = options.map((opt) => opt.name);

    return {
      module: ServiceBusClientModule,
      providers: [
        ...providers,
        {
          provide: SERVICE_BUS_CLIENT_NAMES,
          useValue: clientNames,
        },
      ],
      exports,
    };
  }

  /**
   * Registers one or more Service Bus clients asynchronously
   */
  static registerAsync(options: ServiceBusClientModuleAsyncOptions[]): DynamicModule {
    const providers = options.map((opt) => this.createAsyncClientProvider(opt));
    const imports = options.flatMap((opt) => opt.imports ?? []);
    const exports = options.map((opt) => opt.name);
    const clientNames = options.map((opt) => opt.name);

    return {
      module: ServiceBusClientModule,
      imports,
      providers: [
        ...providers,
        {
          provide: SERVICE_BUS_CLIENT_NAMES,
          useValue: clientNames,
        },
      ],
      exports,
    };
  }

  /**
   * Creates a synchronous client provider
   */
  private static createClientProvider(options: ServiceBusClientModuleOptions): Provider {
    return {
      provide: options.name,
      useFactory: () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { name, ...clientOptions } = options;
        return new ServiceBusClientProxy(clientOptions);
      },
    };
  }

  /**
   * Creates an asynchronous client provider
   */
  private static createAsyncClientProvider(options: ServiceBusClientModuleAsyncOptions): Provider {
    return {
      provide: options.name,
      useFactory: async (...args: any[]) => {
        const clientOptions = await options.useFactory(...args);
        return new ServiceBusClientProxy(clientOptions);
      },
      inject: options.inject ?? [],
    };
  }
}
