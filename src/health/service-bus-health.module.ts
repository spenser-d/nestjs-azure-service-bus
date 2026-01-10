import { Module, Global } from '@nestjs/common';
import { ServiceBusHealthIndicator } from './service-bus.health';

/**
 * Module that provides health check functionality for Azure Service Bus
 *
 * This module is global, so the ServiceBusHealthIndicator is available
 * throughout the application without explicit imports.
 *
 * @example
 * ```typescript
 * // In your app module
 * @Module({
 *   imports: [
 *     ServiceBusHealthModule,
 *     TerminusModule,
 *   ],
 * })
 * export class AppModule {}
 *
 * // In your health controller
 * @Controller('health')
 * export class HealthController {
 *   constructor(
 *     private health: HealthCheckService,
 *     private serviceBusHealth: ServiceBusHealthIndicator,
 *   ) {}
 *
 *   @Get()
 *   @HealthCheck()
 *   check() {
 *     return this.health.check([
 *       () => this.serviceBusHealth.check('serviceBus'),
 *     ]);
 *   }
 * }
 * ```
 */
@Global()
@Module({
  providers: [ServiceBusHealthIndicator],
  exports: [ServiceBusHealthIndicator],
})
export class ServiceBusHealthModule {}
