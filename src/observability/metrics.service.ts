import { Logger } from '@nestjs/common';
import { SERVICE_BUS_DEFAULTS } from '../constants';
import type { MetricsOptions } from '../interfaces';
import {
  METRIC_ATTRIBUTES,
  ResolvedMetricsOptions,
  OtelApi,
  OtelMeter,
  OtelCounter,
  OtelHistogram,
  OtelObservableResult,
} from './otel.interfaces';

/**
 * Attempts to load OpenTelemetry API if available
 * Returns null if @opentelemetry/api is not installed
 */
function tryLoadOtelApi(): OtelApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require('@opentelemetry/api') as OtelApi;
  } catch {
    return null;
  }
}

/**
 * Service Bus metrics collection using OpenTelemetry
 *
 * Metrics collected:
 * - `{prefix}_messages_published_total` - Counter of published messages
 * - `{prefix}_messages_received_total` - Counter of received messages
 * - `{prefix}_messages_completed_total` - Counter of completed messages
 * - `{prefix}_messages_failed_total` - Counter of failed messages
 * - `{prefix}_publish_duration_seconds` - Histogram of publish latency
 * - `{prefix}_handle_duration_seconds` - Histogram of handler latency
 * - `{prefix}_connection_status` - Gauge of connection status (0=disconnected, 1=connected)
 * - `{prefix}_pending_requests` - Gauge of pending request-response operations
 *
 * @example
 * ```typescript
 * const metrics = new ServiceBusMetricsService({ meterName: 'my-app' });
 *
 * // Record metrics
 * metrics.recordMessagePublished('orders', 'create-order');
 * metrics.recordPublishLatency(50, 'orders');
 * ```
 */
export class ServiceBusMetricsService {
  private readonly logger = new Logger(ServiceBusMetricsService.name);
  private readonly options: ResolvedMetricsOptions;
  private readonly otel: OtelApi | null;
  private meter: OtelMeter | null = null;

  // Counters
  private messagesPublished: OtelCounter | null = null;
  private messagesReceived: OtelCounter | null = null;
  private messagesCompleted: OtelCounter | null = null;
  private messagesFailed: OtelCounter | null = null;
  private messagesAbandoned: OtelCounter | null = null;
  private messagesDeadLettered: OtelCounter | null = null;

  // Histograms
  private publishLatency: OtelHistogram | null = null;
  private handleLatency: OtelHistogram | null = null;

  // Gauges (values tracked externally)
  private connectionStatusValue = 0;
  private pendingRequestsValue = 0;

  constructor(options?: MetricsOptions | boolean) {
    this.otel = tryLoadOtelApi();
    this.options = this.resolveOptions(options);

    if (this.options.enabled && this.otel) {
      this.initializeMetrics();
    } else if (this.options.enabled && !this.otel) {
      this.logger.warn(
        'Metrics enabled but @opentelemetry/api not found. Install it to enable metrics.',
      );
    }
  }

  /**
   * Resolves options to internal format
   */
  private resolveOptions(options?: MetricsOptions | boolean): ResolvedMetricsOptions {
    if (typeof options === 'boolean') {
      return {
        enabled: options,
        meterName: SERVICE_BUS_DEFAULTS.OBSERVABILITY.METER_NAME,
        prefix: SERVICE_BUS_DEFAULTS.OBSERVABILITY.METRICS_PREFIX,
      };
    }

    return {
      enabled: options !== undefined,
      meterName: options?.meterName ?? SERVICE_BUS_DEFAULTS.OBSERVABILITY.METER_NAME,
      prefix: options?.prefix ?? SERVICE_BUS_DEFAULTS.OBSERVABILITY.METRICS_PREFIX,
    };
  }

  /**
   * Initializes OpenTelemetry metrics
   * Called only when this.otel is confirmed non-null
   */
  private initializeMetrics(): void {
    // Safe to access - only called when otel is confirmed available
    const otel = this.otel!;
    const { metrics } = otel;
    this.meter = metrics.getMeter(this.options.meterName);

    const prefix = this.options.prefix;

    // Counters
    this.messagesPublished = this.meter.createCounter(`${prefix}_messages_published_total`, {
      description: 'Total number of messages published',
    });

    this.messagesReceived = this.meter.createCounter(`${prefix}_messages_received_total`, {
      description: 'Total number of messages received',
    });

    this.messagesCompleted = this.meter.createCounter(`${prefix}_messages_completed_total`, {
      description: 'Total number of messages completed successfully',
    });

    this.messagesFailed = this.meter.createCounter(`${prefix}_messages_failed_total`, {
      description: 'Total number of messages that failed processing',
    });

    this.messagesAbandoned = this.meter.createCounter(`${prefix}_messages_abandoned_total`, {
      description: 'Total number of messages abandoned',
    });

    this.messagesDeadLettered = this.meter.createCounter(`${prefix}_messages_deadlettered_total`, {
      description: 'Total number of messages sent to dead letter queue',
    });

    // Histograms
    this.publishLatency = this.meter.createHistogram(`${prefix}_publish_duration_seconds`, {
      description: 'Time taken to publish messages',
      unit: 's',
    });

    this.handleLatency = this.meter.createHistogram(`${prefix}_handle_duration_seconds`, {
      description: 'Time taken to handle messages',
      unit: 's',
    });

    // Observable Gauges
    this.meter
      .createObservableGauge(`${prefix}_connection_status`, {
        description: 'Connection status (0=disconnected, 1=connected)',
      })
      .addCallback((result: OtelObservableResult) => {
        result.observe(this.connectionStatusValue);
      });

    this.meter
      .createObservableGauge(`${prefix}_pending_requests`, {
        description: 'Number of pending request-response operations',
      })
      .addCallback((result: OtelObservableResult) => {
        result.observe(this.pendingRequestsValue);
      });

    this.logger.log('OpenTelemetry metrics initialized');
  }

  /**
   * Checks if metrics are enabled
   */
  isEnabled(): boolean {
    return this.options.enabled && this.meter !== null;
  }

  /**
   * Records a published message
   */
  recordMessagePublished(topic: string, pattern: string): void {
    this.messagesPublished?.add(1, {
      [METRIC_ATTRIBUTES.TOPIC]: topic,
      [METRIC_ATTRIBUTES.PATTERN]: pattern,
      [METRIC_ATTRIBUTES.OPERATION]: 'publish',
    });
  }

  /**
   * Records a received message
   */
  recordMessageReceived(topic: string, subscription: string, pattern: string): void {
    this.messagesReceived?.add(1, {
      [METRIC_ATTRIBUTES.TOPIC]: topic,
      [METRIC_ATTRIBUTES.SUBSCRIPTION]: subscription,
      [METRIC_ATTRIBUTES.PATTERN]: pattern,
      [METRIC_ATTRIBUTES.OPERATION]: 'receive',
    });
  }

  /**
   * Records a completed message
   */
  recordMessageCompleted(topic: string, subscription: string): void {
    this.messagesCompleted?.add(1, {
      [METRIC_ATTRIBUTES.TOPIC]: topic,
      [METRIC_ATTRIBUTES.SUBSCRIPTION]: subscription,
      [METRIC_ATTRIBUTES.STATUS]: 'completed',
    });
  }

  /**
   * Records a failed message
   */
  recordMessageFailed(topic: string, subscription: string, errorType?: string): void {
    this.messagesFailed?.add(1, {
      [METRIC_ATTRIBUTES.TOPIC]: topic,
      [METRIC_ATTRIBUTES.SUBSCRIPTION]: subscription,
      [METRIC_ATTRIBUTES.STATUS]: 'failed',
      [METRIC_ATTRIBUTES.ERROR_TYPE]: errorType ?? 'unknown',
    });
  }

  /**
   * Records an abandoned message
   */
  recordMessageAbandoned(topic: string, subscription: string): void {
    this.messagesAbandoned?.add(1, {
      [METRIC_ATTRIBUTES.TOPIC]: topic,
      [METRIC_ATTRIBUTES.SUBSCRIPTION]: subscription,
      [METRIC_ATTRIBUTES.STATUS]: 'abandoned',
    });
  }

  /**
   * Records a dead-lettered message
   */
  recordMessageDeadLettered(topic: string, subscription: string, reason?: string): void {
    this.messagesDeadLettered?.add(1, {
      [METRIC_ATTRIBUTES.TOPIC]: topic,
      [METRIC_ATTRIBUTES.SUBSCRIPTION]: subscription,
      [METRIC_ATTRIBUTES.STATUS]: 'deadlettered',
      [METRIC_ATTRIBUTES.ERROR_TYPE]: reason ?? 'unknown',
    });
  }

  /**
   * Records publish latency
   * @param durationMs - Duration in milliseconds
   */
  recordPublishLatency(durationMs: number, topic: string): void {
    this.publishLatency?.record(durationMs / 1000, {
      [METRIC_ATTRIBUTES.TOPIC]: topic,
      [METRIC_ATTRIBUTES.OPERATION]: 'publish',
    });
  }

  /**
   * Records message handle latency
   * @param durationMs - Duration in milliseconds
   */
  recordHandleLatency(durationMs: number, topic: string, subscription: string): void {
    this.handleLatency?.record(durationMs / 1000, {
      [METRIC_ATTRIBUTES.TOPIC]: topic,
      [METRIC_ATTRIBUTES.SUBSCRIPTION]: subscription,
      [METRIC_ATTRIBUTES.OPERATION]: 'process',
    });
  }

  /**
   * Updates the connection status gauge
   * @param connected - Whether connected (true=1, false=0)
   */
  updateConnectionStatus(connected: boolean): void {
    this.connectionStatusValue = connected ? 1 : 0;
  }

  /**
   * Updates the pending requests gauge
   * @param count - Number of pending requests
   */
  updatePendingRequests(count: number): void {
    this.pendingRequestsValue = count;
  }
}
