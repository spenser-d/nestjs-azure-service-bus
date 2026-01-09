import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ServiceBusClientProxy } from './service-bus.client';
import type {
  ServiceBusClientModuleOptions,
  ServiceBusClientModuleAsyncOptions,
} from '../interfaces';

/**
 * Module for registering Azure Service Bus clients
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
export class ServiceBusClientModule {
  /**
   * Registers one or more Service Bus clients synchronously
   */
  static register(options: ServiceBusClientModuleOptions[]): DynamicModule {
    const providers = options.map((opt) => this.createClientProvider(opt));
    const exports = options.map((opt) => opt.name);

    return {
      module: ServiceBusClientModule,
      providers,
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

    return {
      module: ServiceBusClientModule,
      imports,
      providers,
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
