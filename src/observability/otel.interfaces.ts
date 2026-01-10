/**
 * OpenTelemetry metric attribute names
 */
export const METRIC_ATTRIBUTES = {
  TOPIC: 'messaging.destination.name',
  SUBSCRIPTION: 'messaging.consumer.group.name',
  PATTERN: 'messaging.message.pattern',
  OPERATION: 'messaging.operation',
  STATUS: 'messaging.status',
  ERROR_TYPE: 'error.type',
} as const;

/**
 * OpenTelemetry span attribute names (semantic conventions)
 */
export const SPAN_ATTRIBUTES = {
  // Messaging semantic conventions
  SYSTEM: 'messaging.system',
  DESTINATION: 'messaging.destination.name',
  DESTINATION_KIND: 'messaging.destination.kind',
  MESSAGE_ID: 'messaging.message.id',
  CORRELATION_ID: 'messaging.message.correlation_id',
  OPERATION: 'messaging.operation',
  CONSUMER_GROUP: 'messaging.consumer.group.name',
  // Custom attributes
  PATTERN: 'messaging.message.pattern',
  SESSION_ID: 'messaging.azure.service_bus.session_id',
} as const;

/**
 * Message operation types
 */
export enum MessageOperation {
  PUBLISH = 'publish',
  RECEIVE = 'receive',
  PROCESS = 'process',
}

/**
 * Internal metric options after resolution
 */
export interface ResolvedMetricsOptions {
  enabled: boolean;
  meterName: string;
  prefix: string;
}

/**
 * Internal tracing options after resolution
 */
export interface ResolvedTracingOptions {
  enabled: boolean;
  tracerName: string;
}

// ============================================================
// OpenTelemetry type definitions
// These are minimal type definitions for the OpenTelemetry API
// so we don't need it as a hard dependency
// ============================================================

/**
 * Minimal OpenTelemetry Meter interface
 * @see https://opentelemetry.io/docs/specs/otel/metrics/api/
 */
export interface OtelMeter {
  createCounter(name: string, options?: { description?: string; unit?: string }): OtelCounter;
  createHistogram(name: string, options?: { description?: string; unit?: string }): OtelHistogram;
  createObservableGauge(
    name: string,
    options?: { description?: string; unit?: string },
  ): OtelObservableGauge;
}

/**
 * Minimal OpenTelemetry Counter interface
 */
export interface OtelCounter {
  add(value: number, attributes?: Record<string, string | number>): void;
}

/**
 * Minimal OpenTelemetry Histogram interface
 */
export interface OtelHistogram {
  record(value: number, attributes?: Record<string, string | number>): void;
}

/**
 * Observable result passed to gauge callback
 */
export interface OtelObservableResult {
  observe(value: number, attributes?: Record<string, string | number>): void;
}

/**
 * Minimal OpenTelemetry ObservableGauge interface
 */
export interface OtelObservableGauge {
  addCallback(callback: (result: OtelObservableResult) => void): void;
}

/**
 * Minimal OpenTelemetry Tracer interface
 */
export interface OtelTracer {
  startSpan(name: string, options?: OtelSpanOptions, context?: OtelContext): OtelSpan;
}

/**
 * Span options for creating spans
 */
export interface OtelSpanOptions {
  kind?: number;
  attributes?: Record<string, string | number>;
}

/**
 * Minimal OpenTelemetry Span interface
 */
export interface OtelSpan {
  setAttributes(attributes: Record<string, string | number>): void;
  recordException(exception: Error): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

/**
 * OpenTelemetry Context
 */
export type OtelContext = unknown;

/**
 * OpenTelemetry API module shape
 */
export interface OtelApi {
  metrics: {
    getMeter(name: string): OtelMeter;
  };
  trace: {
    getTracer(name: string): OtelTracer;
    setSpan(context: OtelContext, span: OtelSpan): OtelContext;
  };
  context: {
    active(): OtelContext;
    with<T>(context: OtelContext, fn: () => T): T;
  };
  propagation: {
    inject(context: OtelContext, carrier: Record<string, string>): void;
    extract(context: OtelContext, carrier: Record<string, string>): OtelContext;
  };
  SpanKind: {
    PRODUCER: number;
    CONSUMER: number;
  };
  SpanStatusCode: {
    OK: number;
    ERROR: number;
  };
}
