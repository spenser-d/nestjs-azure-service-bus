import { ServiceBusTracingService } from '../../../src/observability/tracing.service';
import { SPAN_ATTRIBUTES, MessageOperation } from '../../../src/observability/otel.interfaces';
import { SERVICE_BUS_DEFAULTS } from '../../../src/constants';
import type { ServiceBusMessage, ServiceBusReceivedMessage } from '@azure/service-bus';

/**
 * Tests for ServiceBusTracingService
 *
 * Since @opentelemetry/api is an optional dependency and not installed in test environment,
 * these tests verify behavior when OpenTelemetry is NOT available.
 * The service gracefully handles this by returning null from tryLoadOtelApi().
 */
describe('ServiceBusTracingService', () => {
  describe('without OpenTelemetry installed', () => {
    it('should create service without errors when otel not installed', () => {
      const tracing = new ServiceBusTracingService(true);
      expect(tracing).toBeDefined();
      // isEnabled returns false because otel is not available
      expect(tracing.isEnabled()).toBe(false);
    });

    it('should create service with boolean false', () => {
      const tracing = new ServiceBusTracingService(false);
      expect(tracing).toBeDefined();
      expect(tracing.isEnabled()).toBe(false);
    });

    it('should create service with undefined options', () => {
      const tracing = new ServiceBusTracingService(undefined);
      expect(tracing).toBeDefined();
      expect(tracing.isEnabled()).toBe(false);
    });

    it('should create service with object options', () => {
      const tracing = new ServiceBusTracingService({
        tracerName: 'custom-tracer',
      });
      expect(tracing).toBeDefined();
      // isEnabled is false because otel is not available (even though options are provided)
      expect(tracing.isEnabled()).toBe(false);
    });

    it('should return null from startPublishSpan without otel', () => {
      const tracing = new ServiceBusTracingService(true);
      const span = tracing.startPublishSpan('create-order', 'orders');
      expect(span).toBeNull();
    });

    it('should return null from startProcessSpan without otel', () => {
      const tracing = new ServiceBusTracingService(true);
      const span = tracing.startProcessSpan('create-order', 'orders', 'processor');
      expect(span).toBeNull();
    });

    it('should not fail when calling endSpan with null span', () => {
      const tracing = new ServiceBusTracingService(true);
      expect(() => {
        tracing.endSpan(null);
      }).not.toThrow();
    });

    it('should not fail when calling endSpan with null span and error', () => {
      const tracing = new ServiceBusTracingService(true);
      expect(() => {
        tracing.endSpan(null, new Error('Test error'));
      }).not.toThrow();
    });

    it('should not fail when calling addSpanAttributes with null span', () => {
      const tracing = new ServiceBusTracingService(true);
      expect(() => {
        tracing.addSpanAttributes(null, { key: 'value' });
      }).not.toThrow();
    });

    it('should not modify message when calling injectContext without otel', () => {
      const tracing = new ServiceBusTracingService(true);
      const message: ServiceBusMessage = {
        body: 'test',
      };

      expect(() => {
        tracing.injectContext(message);
      }).not.toThrow();

      // applicationProperties should not be created
      expect(message.applicationProperties).toBeUndefined();
    });

    it('should return undefined from extractContext without otel', () => {
      const tracing = new ServiceBusTracingService(true);
      const message = {
        body: 'test',
        applicationProperties: {
          traceparent: '00-trace-span-01',
        },
      } as unknown as ServiceBusReceivedMessage;

      const context = tracing.extractContext(message);
      expect(context).toBeUndefined();
    });

    it('should execute function directly when calling withSpan with null span', () => {
      const tracing = new ServiceBusTracingService(true);
      let executed = false;

      const result = tracing.withSpan(null, () => {
        executed = true;
        return 'result';
      });

      expect(executed).toBe(true);
      expect(result).toBe('result');
    });
  });

  describe('span attribute constants', () => {
    it('should have correct SPAN_ATTRIBUTES values', () => {
      expect(SPAN_ATTRIBUTES.SYSTEM).toBe('messaging.system');
      expect(SPAN_ATTRIBUTES.DESTINATION).toBe('messaging.destination.name');
      expect(SPAN_ATTRIBUTES.DESTINATION_KIND).toBe('messaging.destination.kind');
      expect(SPAN_ATTRIBUTES.MESSAGE_ID).toBe('messaging.message.id');
      expect(SPAN_ATTRIBUTES.CORRELATION_ID).toBe('messaging.message.correlation_id');
      expect(SPAN_ATTRIBUTES.OPERATION).toBe('messaging.operation');
      expect(SPAN_ATTRIBUTES.CONSUMER_GROUP).toBe('messaging.consumer.group.name');
      expect(SPAN_ATTRIBUTES.PATTERN).toBe('messaging.message.pattern');
      expect(SPAN_ATTRIBUTES.SESSION_ID).toBe('messaging.azure.service_bus.session_id');
    });
  });

  describe('message operation enum', () => {
    it('should have correct MessageOperation values', () => {
      expect(MessageOperation.PUBLISH).toBe('publish');
      expect(MessageOperation.RECEIVE).toBe('receive');
      expect(MessageOperation.PROCESS).toBe('process');
    });
  });

  describe('default configuration', () => {
    it('should have correct default tracer name', () => {
      expect(SERVICE_BUS_DEFAULTS.OBSERVABILITY.TRACER_NAME).toBe('nestjs-azure-service-bus');
    });
  });

  describe('extractContext edge cases', () => {
    it('should return undefined when message has no applicationProperties', () => {
      const tracing = new ServiceBusTracingService(true);
      const message = {
        body: 'test',
      } as unknown as ServiceBusReceivedMessage;

      const context = tracing.extractContext(message);
      expect(context).toBeUndefined();
    });

    it('should return undefined when message has empty applicationProperties', () => {
      const tracing = new ServiceBusTracingService(true);
      const message = {
        body: 'test',
        applicationProperties: {},
      } as unknown as ServiceBusReceivedMessage;

      const context = tracing.extractContext(message);
      expect(context).toBeUndefined();
    });
  });

  describe('injectContext edge cases', () => {
    it('should handle message with existing applicationProperties', () => {
      const tracing = new ServiceBusTracingService(true);
      const message: ServiceBusMessage = {
        body: 'test',
        applicationProperties: {
          existingKey: 'existingValue',
        },
      };

      expect(() => {
        tracing.injectContext(message);
      }).not.toThrow();

      // Existing properties should be preserved
      expect(message.applicationProperties?.existingKey).toBe('existingValue');
    });
  });
});
