import 'reflect-metadata';
import { PATTERN_METADATA, PATTERN_EXTRAS_METADATA } from '@nestjs/microservices/constants';
import { METADATA_KEYS } from '../../../src/constants';
import {
  ServiceBusSubscription,
  ServiceBusMessage,
  ServiceBusEvent,
} from '../../../src/decorators/service-bus-subscription.decorator';
import { DeadLetterHandler } from '../../../src/decorators/dead-letter-handler.decorator';
import { ServiceBusCtx, SBContext } from '../../../src/decorators/service-bus-context.decorator';
import { ServiceBusContext, ServiceBusContextArgs } from '../../../src/server/service-bus.context';

describe('Decorators', () => {
  describe('ServiceBusSubscription', () => {
    it('should apply metadata for event pattern by default', () => {
      class TestController {
        @ServiceBusSubscription('test.pattern')
        handleEvent() {}
      }

      const patternMetadata = Reflect.getMetadata(
        PATTERN_METADATA,
        TestController.prototype.handleEvent,
      );
      const extrasMetadata = Reflect.getMetadata(
        PATTERN_EXTRAS_METADATA,
        TestController.prototype.handleEvent,
      );
      const subscriptionMetadata = Reflect.getMetadata(
        METADATA_KEYS.SUBSCRIPTION,
        TestController.prototype.handleEvent,
      );
      const handlerExtrasMetadata = Reflect.getMetadata(
        METADATA_KEYS.HANDLER_EXTRAS,
        TestController.prototype.handleEvent,
      );

      expect(patternMetadata).toEqual(['test.pattern']);
      expect(extrasMetadata).toBeDefined();
      expect(extrasMetadata).toMatchObject({
        isDeadLetterHandler: false,
      });
      expect(subscriptionMetadata).toBeUndefined();
      expect(handlerExtrasMetadata).toMatchObject({
        isDeadLetterHandler: false,
      });
    });

    it('should apply subscription options metadata', () => {
      const options = {
        topic: 'orders',
        subscription: 'order-processor',
        autoComplete: false,
      };

      class TestController {
        @ServiceBusSubscription('order.created', options)
        handleOrder() {}
      }

      const subscriptionMetadata = Reflect.getMetadata(
        METADATA_KEYS.SUBSCRIPTION,
        TestController.prototype.handleOrder,
      );
      const handlerExtrasMetadata = Reflect.getMetadata(
        METADATA_KEYS.HANDLER_EXTRAS,
        TestController.prototype.handleOrder,
      );

      expect(subscriptionMetadata).toEqual(options);
      expect(handlerExtrasMetadata).toMatchObject({
        subscription: options,
        isDeadLetterHandler: false,
      });
    });

    it('should apply message pattern when isEventPattern is false', () => {
      class TestController {
        @ServiceBusSubscription('order.get', undefined, false)
        getOrder() {}
      }

      const patternMetadata = Reflect.getMetadata(
        PATTERN_METADATA,
        TestController.prototype.getOrder,
      );
      const extrasMetadata = Reflect.getMetadata(
        PATTERN_EXTRAS_METADATA,
        TestController.prototype.getOrder,
      );

      expect(patternMetadata).toEqual(['order.get']);
      expect(extrasMetadata).toBeDefined();
      expect(extrasMetadata).toMatchObject({
        isDeadLetterHandler: false,
      });
    });

    it('should handle object patterns', () => {
      const objectPattern = { cmd: 'getOrder', version: 1 };

      class TestController {
        @ServiceBusSubscription(objectPattern)
        handleObjectPattern() {}
      }

      const patternMetadata = Reflect.getMetadata(
        PATTERN_METADATA,
        TestController.prototype.handleObjectPattern,
      );

      expect(patternMetadata).toEqual([objectPattern]);
    });
  });

  describe('ServiceBusMessage', () => {
    it('should be shorthand for request-response pattern', () => {
      class TestController {
        @ServiceBusMessage('order.query')
        queryOrder() {}
      }

      const patternMetadata = Reflect.getMetadata(
        PATTERN_METADATA,
        TestController.prototype.queryOrder,
      );
      const extrasMetadata = Reflect.getMetadata(
        PATTERN_EXTRAS_METADATA,
        TestController.prototype.queryOrder,
      );

      expect(patternMetadata).toEqual(['order.query']);
      expect(extrasMetadata).toBeDefined();
      expect(extrasMetadata).toMatchObject({
        isDeadLetterHandler: false,
      });
    });

    it('should apply subscription options', () => {
      const options = { subscription: 'query-handler' };

      class TestController {
        @ServiceBusMessage('order.query', options)
        queryOrder() {}
      }

      const subscriptionMetadata = Reflect.getMetadata(
        METADATA_KEYS.SUBSCRIPTION,
        TestController.prototype.queryOrder,
      );

      expect(subscriptionMetadata).toEqual(options);
    });
  });

  describe('ServiceBusEvent', () => {
    it('should be shorthand for event pattern', () => {
      class TestController {
        @ServiceBusEvent('order.created')
        handleEvent() {}
      }

      const patternMetadata = Reflect.getMetadata(
        PATTERN_METADATA,
        TestController.prototype.handleEvent,
      );
      const extrasMetadata = Reflect.getMetadata(
        PATTERN_EXTRAS_METADATA,
        TestController.prototype.handleEvent,
      );

      expect(patternMetadata).toEqual(['order.created']);
      expect(extrasMetadata).toBeDefined();
      expect(extrasMetadata).toMatchObject({
        isDeadLetterHandler: false,
      });
    });

    it('should apply subscription options', () => {
      const options = {
        topic: 'events',
        subscription: 'event-handler',
        maxConcurrentCalls: 5,
      };

      class TestController {
        @ServiceBusEvent('order.created', options)
        handleEvent() {}
      }

      const subscriptionMetadata = Reflect.getMetadata(
        METADATA_KEYS.SUBSCRIPTION,
        TestController.prototype.handleEvent,
      );
      const handlerExtrasMetadata = Reflect.getMetadata(
        METADATA_KEYS.HANDLER_EXTRAS,
        TestController.prototype.handleEvent,
      );

      expect(subscriptionMetadata).toEqual(options);
      expect(handlerExtrasMetadata.subscription).toEqual(options);
    });
  });

  describe('DeadLetterHandler', () => {
    it('should apply DLQ pattern with $dlq: prefix for string patterns', () => {
      class TestController {
        @DeadLetterHandler('order.created')
        handleDeadLetter() {}
      }

      const patternMetadata = Reflect.getMetadata(
        PATTERN_METADATA,
        TestController.prototype.handleDeadLetter,
      );
      const extrasMetadata = Reflect.getMetadata(
        PATTERN_EXTRAS_METADATA,
        TestController.prototype.handleDeadLetter,
      );
      const handlerExtrasMetadata = Reflect.getMetadata(
        METADATA_KEYS.HANDLER_EXTRAS,
        TestController.prototype.handleDeadLetter,
      );

      expect(patternMetadata).toEqual(['$dlq:order.created']);
      expect(extrasMetadata).toBeDefined();
      expect(extrasMetadata).toMatchObject({
        isDeadLetterHandler: true,
      });
      expect(handlerExtrasMetadata.isDeadLetterHandler).toBe(true);
    });

    it('should apply DLQ pattern with $dlq: prefix for object patterns', () => {
      const objectPattern = { cmd: 'processOrder' };

      class TestController {
        @DeadLetterHandler(objectPattern)
        handleDeadLetter() {}
      }

      const patternMetadata = Reflect.getMetadata(
        PATTERN_METADATA,
        TestController.prototype.handleDeadLetter,
      );

      expect(patternMetadata).toEqual([`$dlq:${JSON.stringify(objectPattern)}`]);
    });

    it('should apply dead letter handler metadata', () => {
      const options = {
        topic: 'orders',
        subscription: 'order-processor',
      };

      class TestController {
        @DeadLetterHandler('order.failed', options)
        handleDeadLetter() {}
      }

      const dlqMetadata = Reflect.getMetadata(
        METADATA_KEYS.DEAD_LETTER_HANDLER,
        TestController.prototype.handleDeadLetter,
      );
      const handlerExtrasMetadata = Reflect.getMetadata(
        METADATA_KEYS.HANDLER_EXTRAS,
        TestController.prototype.handleDeadLetter,
      );

      expect(dlqMetadata).toEqual(options);
      expect(handlerExtrasMetadata).toMatchObject({
        deadLetter: options,
        isDeadLetterHandler: true,
      });
    });

    it('should work without options', () => {
      class TestController {
        @DeadLetterHandler('payment.failed')
        handleDeadLetter() {}
      }

      const dlqMetadata = Reflect.getMetadata(
        METADATA_KEYS.DEAD_LETTER_HANDLER,
        TestController.prototype.handleDeadLetter,
      );
      const handlerExtrasMetadata = Reflect.getMetadata(
        METADATA_KEYS.HANDLER_EXTRAS,
        TestController.prototype.handleDeadLetter,
      );

      expect(dlqMetadata).toBeUndefined();
      expect(handlerExtrasMetadata.isDeadLetterHandler).toBe(true);
    });
  });

  describe('ServiceBusCtx', () => {
    // NestJS constants for route args metadata
    const ROUTE_ARGS_METADATA = '__routeArguments__';

    // Create a mock ExecutionContext
    const createMockExecutionContext = (rpcContext: any) => ({
      switchToRpc: () => ({
        getContext: () => rpcContext,
        getData: () => ({}),
      }),
      getType: () => 'rpc',
      getClass: () => class {},
      getHandler: () => () => {},
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToHttp: () => ({}) as any,
      switchToWs: () => ({}) as any,
    });

    // Helper to extract factory from param decorator applied to a method
    const getFactory = () => {
      class TestController {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handler(@ServiceBusCtx() _ctx: any) {}
      }
      const routeArgsMetadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'handler');
      const factoryKey = Object.keys(routeArgsMetadata)[0];
      return routeArgsMetadata[factoryKey].factory;
    };

    it('should extract ServiceBusContext directly', () => {
      const mockReceiver = { completeMessage: jest.fn() };
      const mockMessage = { body: 'test', messageId: '123' };
      const contextArgs: ServiceBusContextArgs = {
        message: mockMessage as any,
        receiver: mockReceiver as any,
        topic: 'test-topic',
        subscription: 'test-subscription',
        isDeadLetter: false,
      };
      const serviceBusContext = new ServiceBusContext(contextArgs);

      const ctx = createMockExecutionContext(serviceBusContext);
      const factory = getFactory();
      const result = factory(undefined, ctx);

      expect(result).toBe(serviceBusContext);
      expect(result).toBeInstanceOf(ServiceBusContext);
    });

    it('should extract ServiceBusContext from array (BaseRpcContext format)', () => {
      const mockReceiver = { completeMessage: jest.fn() };
      const mockMessage = { body: 'test', messageId: '123' };
      const contextArgs: ServiceBusContextArgs = {
        message: mockMessage as any,
        receiver: mockReceiver as any,
        topic: 'test-topic',
        subscription: 'test-subscription',
        isDeadLetter: false,
      };
      const serviceBusContext = new ServiceBusContext(contextArgs);

      // Wrap in array as BaseRpcContext might do
      const ctx = createMockExecutionContext([serviceBusContext]);
      const factory = getFactory();
      const result = factory(undefined, ctx);

      expect(result).toBe(serviceBusContext);
    });

    it('should return context as-is when not a ServiceBusContext instance', () => {
      const plainContext = { someProperty: 'value' };
      const ctx = createMockExecutionContext(plainContext);
      const factory = getFactory();
      const result = factory(undefined, ctx);

      expect(result).toBe(plainContext);
    });

    it('should handle array with non-ServiceBusContext first element', () => {
      const plainContext = [{ notServiceBusContext: true }];
      const ctx = createMockExecutionContext(plainContext);
      const factory = getFactory();
      const result = factory(undefined, ctx);

      // Should return the array as-is since first element is not ServiceBusContext
      expect(result).toBe(plainContext);
    });
  });

  describe('SBContext', () => {
    it('should be an alias for ServiceBusCtx', () => {
      expect(SBContext).toBe(ServiceBusCtx);
    });
  });
});
