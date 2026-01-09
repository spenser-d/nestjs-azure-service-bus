import type {
  ServiceBusClient,
  ServiceBusReceiver,
  ServiceBusReceivedMessage,
} from '@azure/service-bus';
import { Logger } from '@nestjs/common';
import { ServiceBusDeserializer } from '../serializers/service-bus.deserializer';
import type { ResponsePacket } from '../interfaces';
import { ServiceBusTimeoutError } from '../errors';

/**
 * Callback invoked when a response is received
 */
export type ResponseCallback = (packet: ResponsePacket) => void;

/**
 * Options for ReplyQueueManager
 */
export interface ReplyQueueManagerOptions {
  /**
   * Topic to receive replies on
   */
  replyTopic: string;

  /**
   * Subscription name for replies
   */
  replySubscription: string;

  /**
   * Request timeout in milliseconds
   */
  requestTimeout: number;
}

/**
 * Pending request tracking
 */
interface PendingRequest {
  callback: ResponseCallback;
  timer: NodeJS.Timeout;
  resolve: () => void;
}

/**
 * Manages the shared reply queue for request-response patterns
 * Routes responses to waiting callers based on correlation ID
 */
export class ReplyQueueManager {
  private readonly logger = new Logger(ReplyQueueManager.name);
  private readonly pendingRequests = new Map<string, PendingRequest>();

  private receiver: ServiceBusReceiver | null = null;
  private subscription: { close: () => Promise<void> } | null = null;
  private deserializer: ServiceBusDeserializer;

  constructor(
    private readonly client: ServiceBusClient,
    private readonly options: ReplyQueueManagerOptions,
  ) {
    this.deserializer = new ServiceBusDeserializer();
  }

  /**
   * Starts listening for responses
   */
  async start(): Promise<void> {
    this.receiver = this.client.createReceiver(
      this.options.replyTopic,
      this.options.replySubscription,
      {
        receiveMode: 'receiveAndDelete', // Auto-delete responses
      },
    );

    this.subscription = this.receiver.subscribe(
      {
        processMessage: async (message) => {
          await this.handleResponse(message);
        },
        processError: async (args) => {
          this.logger.error(`Reply queue error: ${args.error.message}`);
        },
      },
      {
        autoCompleteMessages: true,
        maxConcurrentCalls: 10, // Handle multiple responses concurrently
      },
    );

    this.logger.debug(
      `Reply queue started: ${this.options.replyTopic}/${this.options.replySubscription}`,
    );
  }

  /**
   * Stops listening and cleans up
   */
  async stop(): Promise<void> {
    // Cancel all pending requests
    for (const [correlationId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.callback({
        id: correlationId,
        err: new Error('Reply queue stopped'),
        isDisposed: true,
      });
      pending.resolve();
    }
    this.pendingRequests.clear();

    // Close subscription and receiver
    if (this.subscription) {
      await this.subscription.close();
      this.subscription = null;
    }

    if (this.receiver) {
      await this.receiver.close();
      this.receiver = null;
    }
  }

  /**
   * Gets the reply-to address for messages
   */
  getReplyTo(): string {
    return `${this.options.replyTopic}/subscriptions/${this.options.replySubscription}`;
  }

  /**
   * Registers a pending request
   * @param correlationId - Unique correlation ID for the request
   * @param callback - Callback to invoke when response arrives
   * @param timeout - Optional custom timeout (uses default if not provided)
   * @returns Cleanup function to remove the pending request
   */
  registerPendingRequest(
    correlationId: string,
    callback: ResponseCallback,
    timeout?: number,
  ): () => void {
    const requestTimeout = timeout ?? this.options.requestTimeout;

    // Create timeout handler
    const timer = setTimeout(() => {
      const pending = this.pendingRequests.get(correlationId);
      if (pending) {
        this.pendingRequests.delete(correlationId);
        callback({
          id: correlationId,
          err: new ServiceBusTimeoutError(`Request timed out after ${requestTimeout}ms`, {
            timeoutMs: requestTimeout,
            operation: 'request-response',
          }),
          isDisposed: true,
        });
        pending.resolve();
      }
    }, requestTimeout);

    // Store pending request
    let resolvePromise: () => void = () => {};
    new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    this.pendingRequests.set(correlationId, {
      callback,
      timer,
      resolve: resolvePromise,
    });

    // Return cleanup function
    return () => {
      const pending = this.pendingRequests.get(correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(correlationId);
        pending.resolve();
      }
    };
  }

  /**
   * Checks if there are any pending requests
   */
  hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
  }

  /**
   * Gets the count of pending requests
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Handles an incoming response message
   */
  private async handleResponse(message: ServiceBusReceivedMessage): Promise<void> {
    // Get correlation ID
    const correlationId = message.correlationId as string;

    if (!correlationId) {
      this.logger.warn('Received response without correlation ID');
      return;
    }

    // Find pending request
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) {
      this.logger.debug(`No pending request for correlation ID: ${correlationId}`);
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timer);
    this.pendingRequests.delete(correlationId);

    // Deserialize and invoke callback
    try {
      const packet = this.deserializer.deserialize(message) as ResponsePacket;
      pending.callback(packet);
    } catch (error) {
      pending.callback({
        id: correlationId,
        err: error,
        isDisposed: true,
      });
    }

    pending.resolve();
  }
}
