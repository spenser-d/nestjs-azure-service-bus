import type {
  ServiceBusClient,
  ServiceBusSessionReceiver,
  ServiceBusReceivedMessage,
  ProcessErrorArgs,
} from '@azure/service-bus';
import { Logger } from '@nestjs/common';
import { SERVICE_BUS_DEFAULTS } from '../constants';
import { wrapError } from '../utils/error.utils';

/**
 * Options for SessionManager
 */
export interface SessionManagerOptions {
  topic: string;
  subscription: string;
  maxConcurrentSessions: number;
  sessionIdleTimeoutMs: number;
  receiveMode: 'peekLock' | 'receiveAndDelete';
}

/**
 * Callback for processing session messages
 */
export type SessionMessageHandler = (
  message: ServiceBusReceivedMessage,
  receiver: ServiceBusSessionReceiver,
) => Promise<void>;

/**
 * Callback for processing errors
 */
export type SessionErrorHandler = (args: ProcessErrorArgs) => Promise<void>;

/**
 * Manages multiple concurrent session receivers
 */
export class SessionManager {
  private readonly logger = new Logger(SessionManager.name);
  private readonly activeReceivers = new Map<string, ServiceBusSessionReceiver>();
  private isRunning = false;
  private acceptSessionsPromise: Promise<void> | null = null;

  constructor(
    private readonly client: ServiceBusClient,
    private readonly options: SessionManagerOptions,
    private readonly messageHandler: SessionMessageHandler,
    private readonly errorHandler: SessionErrorHandler,
  ) {}

  /**
   * Starts accepting and processing sessions
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.acceptSessionsPromise = this.acceptSessionsLoop();
  }

  /**
   * Stops all session receivers
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Close all active receivers
    const closePromises = Array.from(this.activeReceivers.values()).map(async (receiver) => {
      try {
        await receiver.close();
      } catch (error) {
        this.logger.warn(`Error closing session receiver: ${(error as Error).message}`);
      }
    });

    await Promise.all(closePromises);
    this.activeReceivers.clear();

    // Wait for accept loop to finish
    if (this.acceptSessionsPromise) {
      await this.acceptSessionsPromise;
    }
  }

  /**
   * Gets the number of active sessions
   */
  getActiveSessionCount(): number {
    return this.activeReceivers.size;
  }

  /**
   * Main loop that continuously accepts new sessions
   */
  private async acceptSessionsLoop(): Promise<void> {
    while (this.isRunning) {
      // Check if we can accept more sessions
      if (this.activeReceivers.size >= this.options.maxConcurrentSessions) {
        // Wait a bit before checking again
        await this.sleep(1000);
        continue;
      }

      try {
        // Try to accept the next available session
        const receiver = await this.client.acceptNextSession(
          this.options.topic,
          this.options.subscription,
          {
            receiveMode: this.options.receiveMode,
            maxAutoLockRenewalDurationInMs:
              this.options.sessionIdleTimeoutMs ?? SERVICE_BUS_DEFAULTS.SESSION_IDLE_TIMEOUT_MS,
          },
        );

        // Track the receiver
        this.activeReceivers.set(receiver.sessionId, receiver);

        this.logger.debug(`Accepted session: ${receiver.sessionId}`);

        // Start processing this session
        this.processSession(receiver).catch((error) => {
          this.logger.error(
            `Error processing session ${receiver.sessionId}: ${(error as Error).message}`,
          );
        });
      } catch (error) {
        // Check if it's a "no sessions available" error (expected when idle)
        const errorMessage = (error as Error).message?.toLowerCase() ?? '';
        if (errorMessage.includes('no session available') || errorMessage.includes('timeout')) {
          // This is normal, just continue
          await this.sleep(1000);
          continue;
        }

        // Log other errors
        this.logger.error(`Error accepting session: ${(error as Error).message}`);
        await this.sleep(5000); // Back off on errors
      }
    }
  }

  /**
   * Processes messages for a single session
   */
  private async processSession(receiver: ServiceBusSessionReceiver): Promise<void> {
    const sessionId = receiver.sessionId;

    try {
      // Subscribe to messages for this session
      receiver.subscribe(
        {
          processMessage: async (message) => {
            await this.messageHandler(message, receiver);
          },
          processError: async (args) => {
            await this.errorHandler(args);

            // If session lock lost, remove from tracking
            if ('code' in args.error && args.error.code === 'SessionLockLost') {
              this.activeReceivers.delete(sessionId);
            }
          },
        },
        {
          autoCompleteMessages: false,
        },
      );

      // Wait for session to close (either by timeout or explicit close)
      while (this.isRunning && !receiver.isClosed) {
        await this.sleep(1000);

        // Check if session is still locked
        if (receiver.sessionLockedUntilUtc && receiver.sessionLockedUntilUtc < new Date()) {
          this.logger.debug(`Session ${sessionId} lock expired`);
          break;
        }
      }
    } catch (error) {
      this.logger.error(`Session ${sessionId} error: ${(error as Error).message}`);
      throw wrapError(error, { sessionId });
    } finally {
      // Clean up
      this.activeReceivers.delete(sessionId);

      try {
        if (!receiver.isClosed) {
          await receiver.close();
        }
      } catch (err) {
        this.logger.debug(`Error closing session receiver: ${(err as Error).message}`);
      }

      this.logger.debug(`Session ${sessionId} closed`);
    }
  }

  /**
   * Helper to sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
