import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import {
  ServiceBusAdminService,
  ServiceBusAdminOptions,
  SERVICE_BUS_ADMIN_OPTIONS,
} from './service-bus-admin.service';

/**
 * Async options for ServiceBusAdminModule
 */
export interface ServiceBusAdminModuleAsyncOptions {
  /**
   * Whether to make the module global
   * @default true
   */
  isGlobal?: boolean;

  /**
   * Optional imports for the factory
   */
  imports?: any[];

  /**
   * Factory function to create options
   */
  useFactory: (...args: any[]) => Promise<ServiceBusAdminOptions> | ServiceBusAdminOptions;

  /**
   * Dependencies to inject into the factory
   */
  inject?: any[];
}

/**
 * Module for Azure Service Bus administration operations
 * Provides ServiceBusAdminService for managing queues, topics, subscriptions, and rules
 *
 * @example
 * ```typescript
 * // Synchronous registration
 * @Module({
 *   imports: [
 *     ServiceBusAdminModule.forRoot({
 *       connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Async registration with ConfigService
 * @Module({
 *   imports: [
 *     ServiceBusAdminModule.forRootAsync({
 *       imports: [ConfigModule],
 *       useFactory: (config: ConfigService) => ({
 *         connectionString: config.get('SERVICE_BUS_CONNECTION_STRING'),
 *       }),
 *       inject: [ConfigService],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class ServiceBusAdminModule {
  /**
   * Registers the module with synchronous options
   */
  static forRoot(options: ServiceBusAdminOptions & { isGlobal?: boolean }): DynamicModule {
    const { isGlobal = true, ...adminOptions } = options;

    const providers: Provider[] = [
      {
        provide: SERVICE_BUS_ADMIN_OPTIONS,
        useValue: adminOptions,
      },
      ServiceBusAdminService,
    ];

    return {
      module: ServiceBusAdminModule,
      global: isGlobal,
      providers,
      exports: [ServiceBusAdminService],
    };
  }

  /**
   * Registers the module with asynchronous options
   */
  static forRootAsync(options: ServiceBusAdminModuleAsyncOptions): DynamicModule {
    const { isGlobal = true, imports = [], useFactory, inject = [] } = options;

    const providers: Provider[] = [
      {
        provide: SERVICE_BUS_ADMIN_OPTIONS,
        useFactory,
        inject,
      },
      ServiceBusAdminService,
    ];

    return {
      module: ServiceBusAdminModule,
      global: isGlobal,
      imports,
      providers,
      exports: [ServiceBusAdminService],
    };
  }
}
