import { applyDecorators, SetMetadata } from '@nestjs/common';
import { EventPattern, MessagePattern } from '@nestjs/microservices';
import { METADATA_KEYS } from '../constants';
import type { SubscriptionPatternOptions, ServiceBusHandlerExtras } from '../interfaces';

/**
 * Decorator for subscribing to Service Bus messages with subscription-specific options
 * Can be used with both @MessagePattern (request-response) and @EventPattern (fire-and-forget)
 *
 * @example
 * ```typescript
 * // Event pattern with subscription options
 * @ServiceBusSubscription('order.created', {
 *   topic: 'orders',
 *   subscription: 'order-processor',
 *   autoComplete: false,
 * })
 * async handleOrderCreated(@Payload() data: CreateOrderDto, @ServiceBusCtx() ctx: ServiceBusContext) {
 *   // Process order
 *   await ctx.complete();
 * }
 *
 * // Request-response pattern
 * @ServiceBusSubscription('order.get', { subscription: 'order-query' }, false)
 * async getOrder(@Payload() data: { orderId: string }) {
 *   return this.orderService.findById(data.orderId);
 * }
 * ```
 */
export function ServiceBusSubscription(
  pattern: any,
  options?: SubscriptionPatternOptions,
  isEventPattern = true,
): MethodDecorator {
  const extras: ServiceBusHandlerExtras = {
    subscription: options,
    isDeadLetterHandler: false,
  };

  return applyDecorators(
    SetMetadata(METADATA_KEYS.SUBSCRIPTION, options),
    SetMetadata(METADATA_KEYS.HANDLER_EXTRAS, extras),
    isEventPattern ? EventPattern(pattern, extras) : MessagePattern(pattern, extras),
  );
}

/**
 * Shorthand for ServiceBusSubscription with isEventPattern = false
 * For request-response patterns
 */
export function ServiceBusMessage(
  pattern: any,
  options?: SubscriptionPatternOptions,
): MethodDecorator {
  return ServiceBusSubscription(pattern, options, false);
}

/**
 * Shorthand for ServiceBusSubscription with isEventPattern = true
 * For fire-and-forget patterns
 */
export function ServiceBusEvent(
  pattern: any,
  options?: SubscriptionPatternOptions,
): MethodDecorator {
  return ServiceBusSubscription(pattern, options, true);
}
