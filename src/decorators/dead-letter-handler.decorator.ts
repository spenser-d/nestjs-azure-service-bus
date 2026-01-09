import { applyDecorators, SetMetadata } from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';
import { METADATA_KEYS } from '../constants';
import type { DeadLetterPatternOptions, ServiceBusHandlerExtras } from '../interfaces';

/**
 * Decorator for handling dead-lettered messages
 * Messages that failed processing are moved to the dead letter queue
 * This decorator allows you to create handlers specifically for DLQ messages
 *
 * @example
 * ```typescript
 * @DeadLetterHandler('order.created')
 * async handleFailedOrder(
 *   @Payload() data: any,
 *   @ServiceBusCtx() ctx: ServiceBusContext,
 * ) {
 *   const reason = ctx.getDeadLetterReason();
 *   const description = ctx.getDeadLetterErrorDescription();
 *
 *   // Log or process the failed message
 *   this.logger.error(`Order failed: ${reason} - ${description}`);
 *
 *   // Alert operations team
 *   await this.alertService.notifyFailedOrder(data, reason);
 *
 *   // Complete the message to remove from DLQ
 *   await ctx.complete();
 * }
 * ```
 */
export function DeadLetterHandler(
  pattern: any,
  options?: DeadLetterPatternOptions,
): MethodDecorator {
  // Create a DLQ-specific pattern to differentiate from regular handlers
  const dlqPattern = `$dlq:${typeof pattern === 'string' ? pattern : JSON.stringify(pattern)}`;

  const extras: ServiceBusHandlerExtras = {
    deadLetter: options,
    isDeadLetterHandler: true,
  };

  return applyDecorators(
    SetMetadata(METADATA_KEYS.DEAD_LETTER_HANDLER, options),
    SetMetadata(METADATA_KEYS.HANDLER_EXTRAS, extras),
    EventPattern(dlqPattern, extras),
  );
}
