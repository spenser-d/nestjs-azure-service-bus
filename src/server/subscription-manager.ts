import type {
  ServiceBusClient,
  ServiceBusReceiver,
  ServiceBusSessionReceiver,
  ServiceBusReceivedMessage,
  ProcessErrorArgs,
} from '@azure/service-bus';
import { Logger } from '@nestjs/common';
import { SERVICE_BUS_DEFAULTS } from '../constants';
import { SessionManager } from './session-manager';

/**
 * Options for SubscriptionManager
 */
export interface SubscriptionManagerOptions {
  topic: string;
  subscription: string;
  sessionEnabled: boolean;
  receiveMode: 'peekLock' | 'receiveAndDelete';
  maxConcurrentCalls: number;
  maxConcurrentSessions: number;
  sessionIdleTimeoutMs: number;
  handleDeadLetter: boolean;
}

/**
 * Callback for processing messages
 */
export type MessageHandler = (
  message: ServiceBusReceivedMessage,
  receiver: ServiceBusReceiver | ServiceBusSessionReceiver,
  isDeadLetter: boolean,
) => Promise<void>;

/**
 * Callback for processing errors
 */
export type ErrorHandler = (args: ProcessErrorArgs) => Promise<void>;

/**
 * Manages receivers for a single subscription (including DLQ)
 */
export class SubscriptionManager {
  private readonly logger = new Logger(SubscriptionManager.name);

  private client: ServiceBusClient;
  private receiver: ServiceBusReceiver | null = null;
  private dlqReceiver: ServiceBusReceiver | null = null;
  private sessionManager: SessionManager | null = null;
  private subscription: { close: () => Promise<void> } | null = null;
  private dlqSubscription: { close: () => Promise<void> } | null = null;

  constructor(
    client: ServiceBusClient,
    private readonly options: SubscriptionManagerOptions,
    private readonly messageHandler: MessageHandler,
    private readonly errorHandler: ErrorHandler,
  ) {
    this.client = client;
  }

  /**
   * Gets the unique key for this subscription
   */
  getKey(): string {
    return `${this.options.topic}/${this.options.subscription}`;
  }

  /**
   * Starts the subscription manager
   */
  async start(): Promise<void> {
    this.logger.log(
      `Starting subscription manager for ${this.options.topic}/${this.options.subscription}`,
    );

    if (this.options.sessionEnabled) {
      await this.startSessionManager();
    } else {
      await this.startRegularReceiver();
    }

    if (this.options.handleDeadLetter) {
      await this.startDeadLetterReceiver();
    }
  }

  /**
   * Stops the subscription manager
   */
  async stop(): Promise<void> {
    this.logger.log(
      `Stopping subscription manager for ${this.options.topic}/${this.options.subscription}`,
    );

    // Stop session manager
    if (this.sessionManager) {
      await this.sessionManager.stop();
      this.sessionManager = null;
    }

    // Close main subscription
    if (this.subscription) {
      await this.subscription.close();
      this.subscription = null;
    }

    // Close main receiver
    if (this.receiver) {
      await this.receiver.close();
      this.receiver = null;
    }

    // Close DLQ subscription
    if (this.dlqSubscription) {
      await this.dlqSubscription.close();
      this.dlqSubscription = null;
    }

    // Close DLQ receiver
    if (this.dlqReceiver) {
      await this.dlqReceiver.close();
      this.dlqReceiver = null;
    }
  }

  /**
   * Starts a regular (non-session) receiver
   */
  private async startRegularReceiver(): Promise<void> {
    this.receiver = this.client.createReceiver(this.options.topic, this.options.subscription, {
      receiveMode: this.options.receiveMode,
    });

    this.subscription = this.receiver.subscribe(
      {
        processMessage: async (message) => {
          await this.messageHandler(message, this.receiver!, false);
        },
        processError: async (args) => {
          await this.errorHandler(args);
        },
      },
      {
        autoCompleteMessages: false,
        maxConcurrentCalls: this.options.maxConcurrentCalls,
      },
    );

    this.logger.debug(`Regular receiver started for ${this.getKey()}`);
  }

  /**
   * Starts the session manager for session-enabled subscriptions
   */
  private async startSessionManager(): Promise<void> {
    this.sessionManager = new SessionManager(
      this.client,
      {
        topic: this.options.topic,
        subscription: this.options.subscription,
        maxConcurrentSessions:
          this.options.maxConcurrentSessions ?? SERVICE_BUS_DEFAULTS.MAX_CONCURRENT_SESSIONS,
        sessionIdleTimeoutMs:
          this.options.sessionIdleTimeoutMs ?? SERVICE_BUS_DEFAULTS.SESSION_IDLE_TIMEOUT_MS,
        receiveMode: this.options.receiveMode,
      },
      async (message, receiver) => {
        await this.messageHandler(message, receiver, false);
      },
      async (args) => {
        await this.errorHandler(args);
      },
    );

    await this.sessionManager.start();
    this.logger.debug(`Session manager started for ${this.getKey()}`);
  }

  /**
   * Starts a dead-letter queue receiver
   */
  private async startDeadLetterReceiver(): Promise<void> {
    this.dlqReceiver = this.client.createReceiver(this.options.topic, this.options.subscription, {
      receiveMode: this.options.receiveMode,
      subQueueType: 'deadLetter',
    });

    this.dlqSubscription = this.dlqReceiver.subscribe(
      {
        processMessage: async (message) => {
          await this.messageHandler(message, this.dlqReceiver!, true);
        },
        processError: async (args) => {
          await this.errorHandler(args);
        },
      },
      {
        autoCompleteMessages: false,
        maxConcurrentCalls: 1, // Process DLQ messages one at a time
      },
    );

    this.logger.debug(`DLQ receiver started for ${this.getKey()}`);
  }

  /**
   * Restarts the subscription manager with a new client
   * Used for recovery after connection loss
   *
   * @param client - New Service Bus client
   */
  async restart(client: ServiceBusClient): Promise<void> {
    this.logger.log(`Restarting subscription manager for ${this.getKey()}`);

    // Stop existing receivers
    await this.stop();

    // Update client reference
    this.client = client;

    // Start again
    await this.start();

    this.logger.log(`Subscription manager restarted for ${this.getKey()}`);
  }

  /**
   * Checks if the subscription manager is healthy
   */
  isHealthy(): boolean {
    if (this.options.sessionEnabled) {
      return this.sessionManager !== null;
    }
    return this.receiver !== null && !this.receiver.isClosed;
  }

  /**
   * Gets info about the subscription manager
   */
  getInfo(): {
    topic: string;
    subscription: string;
    sessionEnabled: boolean;
    activeSessionCount?: number;
    handleDeadLetter: boolean;
    healthy: boolean;
  } {
    return {
      topic: this.options.topic,
      subscription: this.options.subscription,
      sessionEnabled: this.options.sessionEnabled,
      activeSessionCount: this.sessionManager?.getActiveSessionCount(),
      handleDeadLetter: this.options.handleDeadLetter,
      healthy: this.isHealthy(),
    };
  }
}
