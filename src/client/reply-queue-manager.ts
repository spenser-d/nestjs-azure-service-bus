import type {
  ServiceBusClient,
  ServiceBusReceiver,
  ServiceBusReceivedMessage,
} from '@azure/service-bus';
import { Logger } from '@nestjs/common';
import type { Deserializer } from '@nestjs/microservices';
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

  /**
   * Optional deserializer for response messages
   */
  deserializer?: Deserializer;
}

/**
 * Pending request tracking
 */
interface PendingRequest {
  callback: ResponseCallback;
  timer: NodeJS.Timeout;
}

/**
 * Manages the shared reply queue for request-response patterns
 * Routes responses to waiting callers based on correlation ID
 */
export class ReplyQueueManager {
  private readonly logger = new Logger(ReplyQueueManager.name);
  private readonly pendingRequests = new Map<string, PendingRequest>();

  private client: ServiceBusClient;
  private receiver: ServiceBusReceiver | null = null;
  private subscription: { close: () => Promise<void> } | null = null;
  private readonly deserializer: Deserializer;

  constructor(
    client: ServiceBusClient,
    private readonly options: ReplyQueueManagerOptions,
  ) {
    this.client = client;
    // Use provided deserializer or create a default one
    if (options.deserializer) {
      this.deserializer = options.deserializer;
    } else {
      // Lazy import to avoid circular dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { ServiceBusDeserializer } = require('../serializers/service-bus.deserializer');
      this.deserializer = new ServiceBusDeserializer();
    }
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

    // Validate timeout
    if (requestTimeout <= 0) {
      throw new Error('Request timeout must be greater than 0');
    }

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
      }
    }, requestTimeout);

    this.pendingRequests.set(correlationId, {
      callback,
      timer,
    });

    // Return cleanup function
    return () => {
      const pending = this.pendingRequests.get(correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(correlationId);
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
   * Cancels all pending requests with a specific reason
   * Used during graceful shutdown or unrecoverable errors
   *
   * @param reason - The reason for cancellation
   */
  async cancelAllPending(reason: string): Promise<void> {
    const count = this.pendingRequests.size;
    const error = new Error(reason);

    for (const [correlationId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.callback({
        id: correlationId,
        err: error,
        isDisposed: true,
      });
    }
    this.pendingRequests.clear();

    if (count > 0) {
      this.logger.log(`Cancelled ${count} pending requests: ${reason}`);
    }
  }

  /**
   * Restarts the reply queue manager with a new client
   * Preserves pending requests across the restart
   *
   * @param client - New Service Bus client
   */
  async restart(client: ServiceBusClient): Promise<void> {
    // Close existing subscription and receiver
    if (this.subscription) {
      await this.subscription.close().catch((err) => {
        this.logger.debug(`Error closing subscription during restart: ${err.message}`);
      });
      this.subscription = null;
    }

    if (this.receiver) {
      await this.receiver.close().catch((err) => {
        this.logger.debug(`Error closing receiver during restart: ${err.message}`);
      });
      this.receiver = null;
    }

    // Update client reference
    this.client = client;

    // Start listening again
    await this.start();
    this.logger.log('Reply queue manager restarted');
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
  }
}
