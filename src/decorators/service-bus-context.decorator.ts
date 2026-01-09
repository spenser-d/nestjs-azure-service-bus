import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ServiceBusContext } from '../server/service-bus.context';

/**
 * Parameter decorator to inject the ServiceBusContext into a handler method
 *
 * The ServiceBusContext provides access to:
 * - The original Azure Service Bus message
 * - Message settlement methods (complete, abandon, defer, deadLetter)
 * - Session state management (for session-enabled subscriptions)
 * - Dead letter queue information (for DLQ handlers)
 *
 * @example
 * ```typescript
 * @EventPattern('order.created')
 * async handleOrderCreated(
 *   @Payload() data: CreateOrderDto,
 *   @ServiceBusCtx() ctx: ServiceBusContext,
 * ) {
 *   try {
 *     await this.orderService.process(data);
 *     await ctx.complete();
 *   } catch (error) {
 *     if (shouldRetry(error)) {
 *       await ctx.abandon({ retryCount: ctx.getDeliveryCount() });
 *     } else {
 *       await ctx.deadLetter({
 *         deadLetterReason: 'ProcessingFailed',
 *         deadLetterErrorDescription: error.message,
 *       });
 *     }
 *   }
 * }
 * ```
 */
export const ServiceBusCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ServiceBusContext => {
    const rpcContext = ctx.switchToRpc().getContext();

    // The context should be a ServiceBusContext instance
    if (rpcContext instanceof ServiceBusContext) {
      return rpcContext;
    }

    // If it's wrapped in an array (BaseRpcContext format), extract it
    if (Array.isArray(rpcContext) && rpcContext[0] instanceof ServiceBusContext) {
      return rpcContext[0];
    }

    // Return the context as-is if it matches the expected structure
    // This handles cases where the context is passed directly
    return rpcContext as ServiceBusContext;
  },
);

/**
 * Alias for ServiceBusCtx for those who prefer the shorter name
 */
export const SBContext = ServiceBusCtx;
