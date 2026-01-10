import { Logger } from '@nestjs/common';
import type { ServiceBusMessage, ServiceBusReceivedMessage } from '@azure/service-bus';
import { SERVICE_BUS_DEFAULTS } from '../constants';
import type { TracingOptions } from '../interfaces';
import {
  SPAN_ATTRIBUTES,
  MessageOperation,
  ResolvedTracingOptions,
  OtelApi,
  OtelTracer,
  OtelSpan,
  OtelContext,
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
 * Trace context header names for propagation
 */
const TRACE_HEADERS = {
  TRACEPARENT: 'traceparent',
  TRACESTATE: 'tracestate',
} as const;

/**
 * Service Bus distributed tracing using OpenTelemetry
 *
 * Provides span creation and context propagation for:
 * - Publishing messages (producer spans)
 * - Receiving/processing messages (consumer spans)
 *
 * Trace context is propagated via message applicationProperties.
 *
 * @example
 * ```typescript
 * const tracing = new ServiceBusTracingService({ tracerName: 'my-app' });
 *
 * // Publishing
 * const span = tracing.startPublishSpan('create-order', 'orders');
 * try {
 *   tracing.injectContext(message);
 *   await sender.sendMessages(message);
 *   tracing.endSpan(span);
 * } catch (error) {
 *   tracing.endSpan(span, error);
 *   throw error;
 * }
 *
 * // Receiving
 * const parentContext = tracing.extractContext(receivedMessage);
 * const span = tracing.startProcessSpan('create-order', 'orders', 'processor', parentContext);
 * // ... process message
 * tracing.endSpan(span);
 * ```
 */
export class ServiceBusTracingService {
  private readonly logger = new Logger(ServiceBusTracingService.name);
  private readonly options: ResolvedTracingOptions;
  private readonly otel: OtelApi | null;
  private tracer: OtelTracer | null = null;

  constructor(options?: TracingOptions | boolean) {
    this.otel = tryLoadOtelApi();
    this.options = this.resolveOptions(options);

    if (this.options.enabled && this.otel) {
      this.initializeTracer();
    } else if (this.options.enabled && !this.otel) {
      this.logger.warn(
        'Tracing enabled but @opentelemetry/api not found. Install it to enable tracing.',
      );
    }
  }

  /**
   * Resolves options to internal format
   */
  private resolveOptions(options?: TracingOptions | boolean): ResolvedTracingOptions {
    if (typeof options === 'boolean') {
      return {
        enabled: options,
        tracerName: SERVICE_BUS_DEFAULTS.OBSERVABILITY.TRACER_NAME,
      };
    }

    return {
      enabled: options !== undefined,
      tracerName: options?.tracerName ?? SERVICE_BUS_DEFAULTS.OBSERVABILITY.TRACER_NAME,
    };
  }

  /**
   * Initializes the OpenTelemetry tracer
   * Called only when this.otel is confirmed non-null
   */
  private initializeTracer(): void {
    // Safe to access - only called when otel is confirmed available
    const otel = this.otel!;
    const { trace } = otel;
    this.tracer = trace.getTracer(this.options.tracerName);
    this.logger.log('OpenTelemetry tracing initialized');
  }

  /**
   * Checks if tracing is enabled
   */
  isEnabled(): boolean {
    return this.options.enabled && this.tracer !== null;
  }

  /**
   * Starts a span for publishing a message
   *
   * @param pattern - Message pattern
   * @param topic - Destination topic
   * @returns Span or null if tracing is disabled
   */
  startPublishSpan(pattern: string, topic: string): OtelSpan | null {
    if (!this.tracer || !this.otel) return null;

    const { SpanKind, context } = this.otel;

    return this.tracer.startSpan(
      `${topic} ${MessageOperation.PUBLISH}`,
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          [SPAN_ATTRIBUTES.SYSTEM]: 'azure_service_bus',
          [SPAN_ATTRIBUTES.DESTINATION]: topic,
          [SPAN_ATTRIBUTES.DESTINATION_KIND]: 'topic',
          [SPAN_ATTRIBUTES.OPERATION]: MessageOperation.PUBLISH,
          [SPAN_ATTRIBUTES.PATTERN]: pattern,
        },
      },
      context.active(),
    );
  }

  /**
   * Starts a span for processing a received message
   *
   * @param pattern - Message pattern
   * @param topic - Source topic
   * @param subscription - Source subscription
   * @param parentContext - Parent context from extracted headers
   * @returns Span or null if tracing is disabled
   */
  startProcessSpan(
    pattern: string,
    topic: string,
    subscription: string,
    parentContext?: OtelContext,
  ): OtelSpan | null {
    if (!this.tracer || !this.otel) return null;

    const { SpanKind, context } = this.otel;
    const ctx = parentContext ?? context.active();

    return this.tracer.startSpan(
      `${topic}/${subscription} ${MessageOperation.PROCESS}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          [SPAN_ATTRIBUTES.SYSTEM]: 'azure_service_bus',
          [SPAN_ATTRIBUTES.DESTINATION]: topic,
          [SPAN_ATTRIBUTES.DESTINATION_KIND]: 'topic',
          [SPAN_ATTRIBUTES.CONSUMER_GROUP]: subscription,
          [SPAN_ATTRIBUTES.OPERATION]: MessageOperation.PROCESS,
          [SPAN_ATTRIBUTES.PATTERN]: pattern,
        },
      },
      ctx,
    );
  }

  /**
   * Ends a span, optionally recording an error
   *
   * @param span - Span to end
   * @param error - Optional error to record
   */
  endSpan(span: OtelSpan | null, error?: Error): void {
    if (!span || !this.otel) return;

    const { SpanStatusCode } = this.otel;

    if (error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  }

  /**
   * Adds attributes to a span
   *
   * @param span - Span to add attributes to
   * @param attributes - Attributes to add
   */
  addSpanAttributes(span: OtelSpan | null, attributes: Record<string, string | number>): void {
    if (!span) return;
    span.setAttributes(attributes);
  }

  /**
   * Injects trace context into a message for propagation
   *
   * @param message - Service Bus message to inject context into
   */
  injectContext(message: ServiceBusMessage): void {
    if (!this.otel) return;

    const { context, propagation } = this.otel;
    const carrier: Record<string, string> = {};

    propagation.inject(context.active(), carrier);

    // Store trace headers in applicationProperties
    if (!message.applicationProperties) {
      message.applicationProperties = {};
    }

    if (carrier[TRACE_HEADERS.TRACEPARENT]) {
      message.applicationProperties[TRACE_HEADERS.TRACEPARENT] = carrier[TRACE_HEADERS.TRACEPARENT];
    }
    if (carrier[TRACE_HEADERS.TRACESTATE]) {
      message.applicationProperties[TRACE_HEADERS.TRACESTATE] = carrier[TRACE_HEADERS.TRACESTATE];
    }
  }

  /**
   * Extracts trace context from a received message
   *
   * @param message - Received Service Bus message
   * @returns Context with parent span info, or undefined if no context found
   */
  extractContext(message: ServiceBusReceivedMessage): OtelContext | undefined {
    if (!this.otel) return undefined;

    const { context, propagation } = this.otel;

    const props = message.applicationProperties;
    if (!props) return undefined;

    const carrier: Record<string, string> = {};

    if (props[TRACE_HEADERS.TRACEPARENT]) {
      carrier[TRACE_HEADERS.TRACEPARENT] = String(props[TRACE_HEADERS.TRACEPARENT]);
    }
    if (props[TRACE_HEADERS.TRACESTATE]) {
      carrier[TRACE_HEADERS.TRACESTATE] = String(props[TRACE_HEADERS.TRACESTATE]);
    }

    if (!carrier[TRACE_HEADERS.TRACEPARENT]) {
      return undefined;
    }

    return propagation.extract(context.active(), carrier);
  }

  /**
   * Runs a function within a span context
   *
   * @param span - Span to use as context
   * @param fn - Function to run
   * @returns Result of the function
   */
  withSpan<T>(span: OtelSpan | null, fn: () => T): T {
    if (!span || !this.otel) {
      return fn();
    }

    const { context, trace } = this.otel;
    return context.with(trace.setSpan(context.active(), span), fn);
  }
}
