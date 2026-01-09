import type {
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusSessionReceiver,
} from '@azure/service-bus';
import { BaseRpcContext } from '@nestjs/microservices';
import { MESSAGE_PROPERTIES } from '../constants';
import { wrapError } from '../utils/error.utils';
import { ServiceBusMessageSettlementError, ServiceBusSessionLockLostError } from '../errors';
import type { DeadLetterOptions, AbandonOptions, DeferOptions } from '../interfaces';

/**
 * Arguments passed to ServiceBusContext
 */
export interface ServiceBusContextArgs {
  message: ServiceBusReceivedMessage;
  receiver: ServiceBusReceiver | ServiceBusSessionReceiver;
  topic: string;
  subscription: string;
  isDeadLetter: boolean;
}

/**
 * Type guard to check if receiver is a session receiver
 */
function isSessionReceiver(
  receiver: ServiceBusReceiver | ServiceBusSessionReceiver,
): receiver is ServiceBusSessionReceiver {
  return 'sessionId' in receiver && receiver.sessionId !== undefined;
}

/**
 * Context object passed to message handlers
 * Provides access to the original message and settlement methods
 */
export class ServiceBusContext extends BaseRpcContext<[ServiceBusContextArgs]> {
  private _isSettled = false;

  constructor(args: ServiceBusContextArgs) {
    super([args]);
  }

  /**
   * Gets the original Azure Service Bus message
   */
  getMessage(): ServiceBusReceivedMessage {
    return this.getArgByIndex(0).message;
  }

  /**
   * Gets the receiver used to receive this message
   */
  getReceiver(): ServiceBusReceiver | ServiceBusSessionReceiver {
    return this.getArgByIndex(0).receiver;
  }

  /**
   * Gets the topic name
   */
  getTopic(): string {
    return this.getArgByIndex(0).topic;
  }

  /**
   * Gets the subscription name
   */
  getSubscription(): string {
    return this.getArgByIndex(0).subscription;
  }

  /**
   * Gets the pattern from the message
   */
  getPattern(): string {
    const message = this.getMessage();
    return (message.applicationProperties?.[MESSAGE_PROPERTIES.PATTERN] as string) ?? '';
  }

  /**
   * Gets the message body (data)
   */
  getData<T = any>(): T {
    return this.getMessage().body;
  }

  /**
   * Gets the correlation ID
   */
  getCorrelationId(): string | undefined {
    return this.getMessage().correlationId as string | undefined;
  }

  /**
   * Gets the message ID
   */
  getMessageId(): string | undefined {
    const messageId = this.getMessage().messageId;
    return messageId ? String(messageId) : undefined;
  }

  /**
   * Checks if this message is from a dead letter queue
   */
  isFromDeadLetterQueue(): boolean {
    return this.getArgByIndex(0).isDeadLetter;
  }

  /**
   * Gets the dead letter reason (if from DLQ)
   */
  getDeadLetterReason(): string | undefined {
    return this.getMessage().deadLetterReason;
  }

  /**
   * Gets the dead letter error description (if from DLQ)
   */
  getDeadLetterErrorDescription(): string | undefined {
    return this.getMessage().deadLetterErrorDescription;
  }

  /**
   * Gets the delivery count
   */
  getDeliveryCount(): number {
    return this.getMessage().deliveryCount ?? 0;
  }

  /**
   * Checks if the message has been settled
   */
  isSettled(): boolean {
    return this._isSettled;
  }

  // --- Session Methods ---

  /**
   * Gets the session ID (if session-enabled)
   */
  getSessionId(): string | undefined {
    const receiver = this.getReceiver();
    if (isSessionReceiver(receiver)) {
      return receiver.sessionId;
    }
    return this.getMessage().sessionId;
  }

  /**
   * Checks if this is a session receiver
   */
  isSessionReceiver(): boolean {
    return isSessionReceiver(this.getReceiver());
  }

  /**
   * Gets the session state (only for session receivers)
   */
  async getSessionState(): Promise<Buffer | undefined> {
    const receiver = this.getReceiver();
    if (!isSessionReceiver(receiver)) {
      return undefined;
    }

    try {
      const state = await receiver.getSessionState();
      return state ?? undefined;
    } catch (error) {
      throw wrapError(error, { sessionId: receiver.sessionId });
    }
  }

  /**
   * Sets the session state (only for session receivers)
   */
  async setSessionState(state: Buffer): Promise<void> {
    const receiver = this.getReceiver();
    if (!isSessionReceiver(receiver)) {
      throw new ServiceBusSessionLockLostError('Cannot set session state: not a session receiver', {
        sessionId: undefined,
      });
    }

    try {
      await receiver.setSessionState(state);
    } catch (error) {
      throw wrapError(error, { sessionId: receiver.sessionId });
    }
  }

  /**
   * Renews the session lock (only for session receivers)
   */
  async renewSessionLock(): Promise<Date> {
    const receiver = this.getReceiver();
    if (!isSessionReceiver(receiver)) {
      throw new ServiceBusSessionLockLostError(
        'Cannot renew session lock: not a session receiver',
        { sessionId: undefined },
      );
    }

    try {
      return await receiver.renewSessionLock();
    } catch (error) {
      throw wrapError(error, { sessionId: receiver.sessionId });
    }
  }

  // --- Settlement Methods ---

  /**
   * Completes the message (removes from queue)
   * Call this when message processing is successful
   */
  async complete(): Promise<void> {
    if (this._isSettled) {
      return;
    }

    const receiver = this.getReceiver();
    const message = this.getMessage();

    try {
      await receiver.completeMessage(message);
      this._isSettled = true;
    } catch (error) {
      throw new ServiceBusMessageSettlementError(
        `Failed to complete message: ${(error as Error).message}`,
        'complete',
        {
          originalError: error as Error,
          messageId: this.getMessageId(),
        },
      );
    }
  }

  /**
   * Abandons the message (returns to queue for reprocessing)
   * Call this when message processing fails but should be retried
   */
  async abandon(options?: AbandonOptions): Promise<void> {
    if (this._isSettled) {
      return;
    }

    const receiver = this.getReceiver();
    const message = this.getMessage();

    try {
      await receiver.abandonMessage(message, options?.propertiesToModify);
      this._isSettled = true;
    } catch (error) {
      throw new ServiceBusMessageSettlementError(
        `Failed to abandon message: ${(error as Error).message}`,
        'abandon',
        {
          originalError: error as Error,
          messageId: this.getMessageId(),
        },
      );
    }
  }

  /**
   * Defers the message for later processing
   * The message can be retrieved later using receiveDeferredMessages
   */
  async defer(options?: DeferOptions): Promise<void> {
    if (this._isSettled) {
      return;
    }

    const receiver = this.getReceiver();
    const message = this.getMessage();

    try {
      await receiver.deferMessage(message, options?.propertiesToModify);
      this._isSettled = true;
    } catch (error) {
      throw new ServiceBusMessageSettlementError(
        `Failed to defer message: ${(error as Error).message}`,
        'defer',
        {
          originalError: error as Error,
          messageId: this.getMessageId(),
        },
      );
    }
  }

  /**
   * Dead-letters the message
   * Call this when message processing fails permanently
   */
  async deadLetter(options?: DeadLetterOptions): Promise<void> {
    if (this._isSettled) {
      return;
    }

    const receiver = this.getReceiver();
    const message = this.getMessage();

    try {
      await receiver.deadLetterMessage(message, {
        deadLetterReason: options?.deadLetterReason ?? 'Unspecified',
        deadLetterErrorDescription: options?.deadLetterErrorDescription ?? '',
        ...options?.propertiesToModify,
      });
      this._isSettled = true;
    } catch (error) {
      throw new ServiceBusMessageSettlementError(
        `Failed to dead-letter message: ${(error as Error).message}`,
        'deadLetter',
        {
          originalError: error as Error,
          messageId: this.getMessageId(),
        },
      );
    }
  }

  /**
   * Renews the message lock
   * Use this for long-running message processing to prevent lock expiration
   */
  async renewLock(): Promise<Date> {
    const receiver = this.getReceiver();
    const message = this.getMessage();

    try {
      return await receiver.renewMessageLock(message);
    } catch (error) {
      throw wrapError(error, { messageId: this.getMessageId() });
    }
  }

  /**
   * Gets the sequence number of the message
   */
  getSequenceNumber(): bigint {
    const seqNum = this.getMessage().sequenceNumber;
    if (seqNum === undefined) {
      return BigInt(0);
    }
    return BigInt(seqNum.toString());
  }

  /**
   * Gets the time until which the message is locked
   */
  getLockedUntil(): Date | undefined {
    return this.getMessage().lockedUntilUtc;
  }

  /**
   * Gets the enqueued time of the message
   */
  getEnqueuedTime(): Date | undefined {
    return this.getMessage().enqueuedTimeUtc;
  }

  /**
   * Gets the expiration time of the message
   */
  getExpiresAt(): Date | undefined {
    return this.getMessage().expiresAtUtc;
  }

  /**
   * Gets custom application properties from the message
   */
  getApplicationProperties(): Record<string, any> {
    return this.getMessage().applicationProperties ?? {};
  }

  /**
   * Gets a specific application property
   */
  getApplicationProperty<T = any>(key: string): T | undefined {
    return this.getApplicationProperties()[key] as T | undefined;
  }
}
