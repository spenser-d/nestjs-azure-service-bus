import {
  ServiceBusSerializer,
  OutgoingMessage,
  OutgoingResponse,
} from '../../../src/serializers/service-bus.serializer';
import { ServiceBusDeserializer } from '../../../src/serializers/service-bus.deserializer';
import { MESSAGE_PROPERTIES } from '../../../src/constants';
import { createMockMessage } from '../../mocks';
import { IncomingPacket, ResponsePacket } from '../../../src/interfaces';

describe('ServiceBusSerializer', () => {
  let serializer: ServiceBusSerializer;

  beforeEach(() => {
    serializer = new ServiceBusSerializer();
  });

  describe('serialize request/event', () => {
    it('should serialize a basic request with string pattern', () => {
      const packet: OutgoingMessage = {
        pattern: 'test.pattern',
        data: { foo: 'bar' },
        id: 'test-correlation-id',
      };

      const result = serializer.serialize(packet);

      expect(result.body).toEqual({ foo: 'bar' });
      expect(result.correlationId).toBe('test-correlation-id');
      expect(result.applicationProperties?.[MESSAGE_PROPERTIES.PATTERN]).toBe('test.pattern');
      expect(result.applicationProperties?.[MESSAGE_PROPERTIES.NESTJS_MARKER]).toBe(true);
      expect(result.contentType).toBe('application/json');
    });

    it('should serialize a request with object pattern', () => {
      const packet: OutgoingMessage = {
        pattern: { cmd: 'create_user', version: 1 },
        data: { name: 'John' },
      };

      const result = serializer.serialize(packet);

      // Object patterns are serialized to JSON with sorted keys
      const expectedPattern = JSON.stringify({ cmd: 'create_user', version: 1 });
      expect(result.applicationProperties?.[MESSAGE_PROPERTIES.PATTERN]).toBe(expectedPattern);
    });

    it('should serialize an event (no correlation ID)', () => {
      const packet: OutgoingMessage = {
        pattern: 'user.created',
        data: { userId: '123' },
      };

      const result = serializer.serialize(packet);

      expect(result.body).toEqual({ userId: '123' });
      expect(result.correlationId).toBeUndefined();
    });

    it('should handle custom options', () => {
      const packet: OutgoingMessage = {
        pattern: 'test',
        data: { test: true },
        options: {
          sessionId: 'session-123',
          subject: 'Test Subject',
          timeToLiveMs: 60000,
          contentType: 'text/plain',
          applicationProperties: {
            customProp: 'value',
          },
        },
      };

      const result = serializer.serialize(packet);

      expect(result.sessionId).toBe('session-123');
      expect(result.subject).toBe('Test Subject');
      expect(result.timeToLive).toBe(60000);
      expect(result.contentType).toBe('text/plain');
      expect(result.applicationProperties?.customProp).toBe('value');
    });

    it('should extract sessionId from __sessionId in data', () => {
      const packet: OutgoingMessage = {
        pattern: 'test',
        data: { foo: 'bar', __sessionId: 'extracted-session' },
      };

      const result = serializer.serialize(packet);

      expect(result.sessionId).toBe('extracted-session');
      expect(result.body.__sessionId).toBeUndefined();
    });

    it('should prioritize options.sessionId over __sessionId', () => {
      const packet: OutgoingMessage = {
        pattern: 'test',
        data: { foo: 'bar', __sessionId: 'data-session' },
        options: { sessionId: 'options-session' },
      };

      const result = serializer.serialize(packet);

      expect(result.sessionId).toBe('options-session');
    });
  });

  describe('serialize response', () => {
    it('should serialize a successful response', () => {
      const packet: OutgoingResponse = {
        id: 'correlation-123',
        response: { result: 'success' },
      };

      const result = serializer.serialize(packet);

      expect(result.body).toEqual({ result: 'success' });
      expect(result.correlationId).toBe('correlation-123');
      expect(result.applicationProperties?.[MESSAGE_PROPERTIES.IS_RESPONSE]).toBe(true);
      expect(result.applicationProperties?.[MESSAGE_PROPERTIES.IS_DISPOSED]).toBe(false);
    });

    it('should serialize a response with error', () => {
      const error = new Error('Test error');
      const packet: OutgoingResponse = {
        id: 'correlation-123',
        err: error,
      };

      const result = serializer.serialize(packet);

      expect(result.body).toBeUndefined();
      expect(result.correlationId).toBe('correlation-123');
      expect(result.applicationProperties?.[MESSAGE_PROPERTIES.IS_RESPONSE]).toBe(true);
      expect(result.applicationProperties?.[MESSAGE_PROPERTIES.ERROR]).toBeDefined();

      const errorData = JSON.parse(
        result.applicationProperties?.[MESSAGE_PROPERTIES.ERROR] as string,
      );
      expect(errorData.message).toBe('Test error');
    });

    it('should serialize a disposed response', () => {
      const packet: OutgoingResponse = {
        id: 'correlation-123',
        response: { final: true },
        isDisposed: true,
      };

      const result = serializer.serialize(packet);

      expect(result.applicationProperties?.[MESSAGE_PROPERTIES.IS_DISPOSED]).toBe(true);
    });
  });
});

describe('ServiceBusDeserializer', () => {
  let deserializer: ServiceBusDeserializer;

  beforeEach(() => {
    deserializer = new ServiceBusDeserializer();
  });

  describe('deserialize request/event', () => {
    it('should deserialize a request message', () => {
      const message = createMockMessage({
        body: { foo: 'bar' },
        correlationId: 'correlation-123',
        pattern: 'test.pattern',
      });

      const result = deserializer.deserialize(message);

      expect(result).toEqual({
        id: 'correlation-123',
        pattern: 'test.pattern',
        data: { foo: 'bar' },
      });
    });

    it('should deserialize an event message (no correlation ID)', () => {
      const message = createMockMessage({
        body: { event: 'data' },
        pattern: 'user.created',
      });
      // Remove correlationId to simulate event
      (message as any).correlationId = undefined;

      const result = deserializer.deserialize(message);

      expect(result).toEqual({
        id: undefined,
        pattern: 'user.created',
        data: { event: 'data' },
      });
    });

    it('should handle missing pattern', () => {
      const message = createMockMessage({
        body: { data: true },
        applicationProperties: {
          nestjs: true,
        },
      });

      const result = deserializer.deserialize(message) as IncomingPacket;

      expect(result.pattern).toBe('');
    });
  });

  describe('deserialize response', () => {
    it('should deserialize a successful response', () => {
      const message = createMockMessage({
        body: { result: 'success' },
        correlationId: 'correlation-123',
        applicationProperties: {
          [MESSAGE_PROPERTIES.NESTJS_MARKER]: true,
          [MESSAGE_PROPERTIES.IS_RESPONSE]: true,
          [MESSAGE_PROPERTIES.IS_DISPOSED]: true,
        },
      });

      const result = deserializer.deserialize(message);

      expect(result).toEqual({
        id: 'correlation-123',
        response: { result: 'success' },
        err: undefined,
        isDisposed: true,
      });
    });

    it('should deserialize a response with error', () => {
      const errorData = JSON.stringify({
        name: 'Error',
        message: 'Something went wrong',
      });

      const message = createMockMessage({
        correlationId: 'correlation-123',
        applicationProperties: {
          [MESSAGE_PROPERTIES.NESTJS_MARKER]: true,
          [MESSAGE_PROPERTIES.IS_RESPONSE]: true,
          [MESSAGE_PROPERTIES.IS_DISPOSED]: true,
          [MESSAGE_PROPERTIES.ERROR]: errorData,
        },
      });

      const result = deserializer.deserialize(message) as ResponsePacket;

      expect(result.id).toBe('correlation-123');
      expect(result.err).toBeInstanceOf(Error);
      expect(result.err?.message).toBe('Something went wrong');
      expect(result.response).toBeUndefined();
    });

    it('should handle malformed error JSON', () => {
      const message = createMockMessage({
        correlationId: 'correlation-123',
        applicationProperties: {
          [MESSAGE_PROPERTIES.NESTJS_MARKER]: true,
          [MESSAGE_PROPERTIES.IS_RESPONSE]: true,
          [MESSAGE_PROPERTIES.ERROR]: 'not-valid-json',
        },
      });

      const result = deserializer.deserialize(message) as ResponsePacket;

      expect(result.err).toBeInstanceOf(Error);
      expect(result.err?.message).toBe('not-valid-json');
    });
  });

  describe('helper methods', () => {
    it('should identify NestJS messages', () => {
      const nestjsMessage = createMockMessage({
        applicationProperties: {
          [MESSAGE_PROPERTIES.NESTJS_MARKER]: true,
        },
      });

      const nonNestjsMessage = createMockMessage({
        applicationProperties: {},
      });

      expect(deserializer.isNestJsMessage(nestjsMessage)).toBe(true);
      expect(deserializer.isNestJsMessage(nonNestjsMessage)).toBe(false);
    });

    it('should identify response messages', () => {
      const responseMessage = createMockMessage({
        applicationProperties: {
          [MESSAGE_PROPERTIES.IS_RESPONSE]: true,
        },
      });

      const requestMessage = createMockMessage({});

      expect(deserializer.isResponseMessage(responseMessage)).toBe(true);
      expect(deserializer.isResponseMessage(requestMessage)).toBe(false);
    });

    it('should extract pattern from message', () => {
      const message = createMockMessage({
        pattern: 'extracted.pattern',
      });

      expect(deserializer.getPattern(message)).toBe('extracted.pattern');
    });
  });
});
