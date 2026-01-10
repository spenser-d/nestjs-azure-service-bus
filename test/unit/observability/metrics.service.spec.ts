import { ServiceBusMetricsService } from '../../../src/observability/metrics.service';
import { METRIC_ATTRIBUTES } from '../../../src/observability/otel.interfaces';
import { SERVICE_BUS_DEFAULTS } from '../../../src/constants';

/**
 * Tests for ServiceBusMetricsService
 *
 * Since @opentelemetry/api is an optional dependency and not installed in test environment,
 * these tests verify behavior when OpenTelemetry is NOT available.
 * The service gracefully handles this by returning null from tryLoadOtelApi().
 */
describe('ServiceBusMetricsService', () => {
  describe('without OpenTelemetry installed', () => {
    it('should create service without errors when otel not installed', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(metrics).toBeDefined();
      // isEnabled returns false because otel is not available
      expect(metrics.isEnabled()).toBe(false);
    });

    it('should create service with boolean false', () => {
      const metrics = new ServiceBusMetricsService(false);
      expect(metrics).toBeDefined();
      expect(metrics.isEnabled()).toBe(false);
    });

    it('should create service with undefined options', () => {
      const metrics = new ServiceBusMetricsService(undefined);
      expect(metrics).toBeDefined();
      expect(metrics.isEnabled()).toBe(false);
    });

    it('should create service with object options', () => {
      const metrics = new ServiceBusMetricsService({
        meterName: 'custom-meter',
        prefix: 'custom_prefix',
      });
      expect(metrics).toBeDefined();
      // isEnabled is false because otel is not available (even though options are provided)
      expect(metrics.isEnabled()).toBe(false);
    });

    it('should not fail when calling recordMessagePublished without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordMessagePublished('orders', 'create-order');
      }).not.toThrow();
    });

    it('should not fail when calling recordMessageReceived without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordMessageReceived('orders', 'processor', 'create-order');
      }).not.toThrow();
    });

    it('should not fail when calling recordMessageCompleted without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordMessageCompleted('orders', 'processor');
      }).not.toThrow();
    });

    it('should not fail when calling recordMessageFailed without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordMessageFailed('orders', 'processor', 'ValidationError');
      }).not.toThrow();
    });

    it('should not fail when calling recordMessageFailed without error type', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordMessageFailed('orders', 'processor');
      }).not.toThrow();
    });

    it('should not fail when calling recordMessageAbandoned without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordMessageAbandoned('orders', 'processor');
      }).not.toThrow();
    });

    it('should not fail when calling recordMessageDeadLettered without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordMessageDeadLettered('orders', 'processor', 'MaxDeliveryExceeded');
      }).not.toThrow();
    });

    it('should not fail when calling recordMessageDeadLettered without reason', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordMessageDeadLettered('orders', 'processor');
      }).not.toThrow();
    });

    it('should not fail when calling recordPublishLatency without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordPublishLatency(100, 'orders');
      }).not.toThrow();
    });

    it('should not fail when calling recordHandleLatency without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.recordHandleLatency(100, 'orders', 'processor');
      }).not.toThrow();
    });

    it('should not fail when calling updateConnectionStatus without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.updateConnectionStatus(true);
        metrics.updateConnectionStatus(false);
      }).not.toThrow();
    });

    it('should not fail when calling updatePendingRequests without otel', () => {
      const metrics = new ServiceBusMetricsService(true);
      expect(() => {
        metrics.updatePendingRequests(5);
        metrics.updatePendingRequests(0);
      }).not.toThrow();
    });
  });

  describe('metric attribute constants', () => {
    it('should have correct METRIC_ATTRIBUTES values', () => {
      expect(METRIC_ATTRIBUTES.TOPIC).toBe('messaging.destination.name');
      expect(METRIC_ATTRIBUTES.SUBSCRIPTION).toBe('messaging.consumer.group.name');
      expect(METRIC_ATTRIBUTES.PATTERN).toBe('messaging.message.pattern');
      expect(METRIC_ATTRIBUTES.OPERATION).toBe('messaging.operation');
      expect(METRIC_ATTRIBUTES.STATUS).toBe('messaging.status');
      expect(METRIC_ATTRIBUTES.ERROR_TYPE).toBe('error.type');
    });
  });

  describe('default configuration', () => {
    it('should have correct default observability settings', () => {
      expect(SERVICE_BUS_DEFAULTS.OBSERVABILITY.METER_NAME).toBe('nestjs-azure-service-bus');
      expect(SERVICE_BUS_DEFAULTS.OBSERVABILITY.TRACER_NAME).toBe('nestjs-azure-service-bus');
      expect(SERVICE_BUS_DEFAULTS.OBSERVABILITY.METRICS_PREFIX).toBe('service_bus');
    });
  });
});
