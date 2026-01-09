import { ServiceBusRecord, ServiceBusRecordBuilder } from '../../../src/record-builders';

describe('ServiceBusRecord', () => {
  describe('constructor', () => {
    it('should create a record with data only', () => {
      const record = new ServiceBusRecord({ foo: 'bar' });

      expect(record.data).toEqual({ foo: 'bar' });
      expect(record.options).toBeUndefined();
    });

    it('should create a record with data and options', () => {
      const options = { sessionId: 'session-123', timeToLiveMs: 60000 };
      const record = new ServiceBusRecord({ foo: 'bar' }, options);

      expect(record.data).toEqual({ foo: 'bar' });
      expect(record.options).toEqual(options);
    });

    it('should have readonly data property', () => {
      const record = new ServiceBusRecord({ foo: 'bar' });
      expect(record.data).toEqual({ foo: 'bar' });
      // TypeScript prevents modification, but the object reference is the same
    });
  });
});

describe('ServiceBusRecordBuilder', () => {
  describe('constructor', () => {
    it('should create builder with initial data', () => {
      const builder = new ServiceBusRecordBuilder({ foo: 'bar' });
      const record = builder.build();

      expect(record.data).toEqual({ foo: 'bar' });
    });

    it('should create builder without initial data', () => {
      const builder = new ServiceBusRecordBuilder();
      const record = builder.build();

      expect(record.data).toBeUndefined();
    });
  });

  describe('setData', () => {
    it('should set the data', () => {
      const record = new ServiceBusRecordBuilder().setData({ orderId: 123 }).build();

      expect(record.data).toEqual({ orderId: 123 });
    });

    it('should override initial data', () => {
      const record = new ServiceBusRecordBuilder<any>({ initial: true })
        .setData({ updated: true })
        .build();

      expect(record.data).toEqual({ updated: true });
    });
  });

  describe('setOptions', () => {
    it('should set all options at once', () => {
      const options = {
        sessionId: 'session-123',
        timeToLiveMs: 60000,
        subject: 'test-subject',
      };

      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setOptions(options)
        .build();

      expect(record.options).toMatchObject(options);
    });

    it('should merge with existing options', () => {
      const record = new ServiceBusRecordBuilder()
        .setSessionId('session-123')
        .setOptions({ timeToLiveMs: 60000 })
        .build();

      expect(record.options?.sessionId).toBe('session-123');
      expect(record.options?.timeToLiveMs).toBe(60000);
    });
  });

  describe('setSessionId', () => {
    it('should set session ID', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setSessionId('my-session')
        .build();

      expect(record.options?.sessionId).toBe('my-session');
    });
  });

  describe('setPartitionKey', () => {
    it('should set partition key', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setPartitionKey('partition-1')
        .build();

      expect(record.options?.partitionKey).toBe('partition-1');
    });
  });

  describe('setCorrelationId', () => {
    it('should set correlation ID', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setCorrelationId('corr-123')
        .build();

      expect(record.options?.correlationId).toBe('corr-123');
    });
  });

  describe('setContentType', () => {
    it('should set content type', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setContentType('text/plain')
        .build();

      expect(record.options?.contentType).toBe('text/plain');
    });
  });

  describe('setSubject', () => {
    it('should set subject', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setSubject('order-created')
        .build();

      expect(record.options?.subject).toBe('order-created');
    });
  });

  describe('setTimeToLive', () => {
    it('should set time to live', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setTimeToLive(120000)
        .build();

      expect(record.options?.timeToLiveMs).toBe(120000);
    });
  });

  describe('setScheduledEnqueueTime', () => {
    it('should set scheduled enqueue time', () => {
      const futureDate = new Date(Date.now() + 3600000);
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setScheduledEnqueueTime(futureDate)
        .build();

      expect(record.options?.scheduledEnqueueTimeUtc).toBe(futureDate);
    });
  });

  describe('setMessageId', () => {
    it('should set message ID', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setMessageId('msg-123')
        .build();

      expect(record.options?.messageId).toBe('msg-123');
    });
  });

  describe('setReplyTo', () => {
    it('should set reply-to address', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setReplyTo('reply-topic')
        .build();

      expect(record.options?.replyTo).toBe('reply-topic');
    });
  });

  describe('setReplyToSessionId', () => {
    it('should set reply-to session ID', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setReplyToSessionId('reply-session')
        .build();

      expect(record.options?.replyToSessionId).toBe('reply-session');
    });
  });

  describe('setApplicationProperties', () => {
    it('should set application properties', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setApplicationProperties({ priority: 'high', region: 'us-west' })
        .build();

      expect(record.options?.applicationProperties).toEqual({
        priority: 'high',
        region: 'us-west',
      });
    });

    it('should merge with existing application properties', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .setApplicationProperties({ priority: 'high' })
        .setApplicationProperties({ region: 'us-west' })
        .build();

      expect(record.options?.applicationProperties).toEqual({
        priority: 'high',
        region: 'us-west',
      });
    });
  });

  describe('addApplicationProperty', () => {
    it('should add a single application property', () => {
      const record = new ServiceBusRecordBuilder()
        .setData({ foo: 'bar' })
        .addApplicationProperty('priority', 'high')
        .addApplicationProperty('count', 42)
        .build();

      expect(record.options?.applicationProperties).toEqual({
        priority: 'high',
        count: 42,
      });
    });
  });

  describe('fluent API', () => {
    it('should support method chaining', () => {
      const futureDate = new Date(Date.now() + 3600000);

      const record = new ServiceBusRecordBuilder<{ orderId: string; amount: number }>()
        .setData({ orderId: 'order-123', amount: 99.99 })
        .setSessionId('user-abc')
        .setPartitionKey('partition-1')
        .setTimeToLive(60000)
        .setSubject('order-created')
        .setScheduledEnqueueTime(futureDate)
        .setApplicationProperties({ priority: 'high' })
        .addApplicationProperty('region', 'us-west')
        .build();

      expect(record.data).toEqual({ orderId: 'order-123', amount: 99.99 });
      expect(record.options).toEqual({
        sessionId: 'user-abc',
        partitionKey: 'partition-1',
        timeToLiveMs: 60000,
        subject: 'order-created',
        scheduledEnqueueTimeUtc: futureDate,
        applicationProperties: {
          priority: 'high',
          region: 'us-west',
        },
      });
    });
  });

  describe('instanceof check', () => {
    it('ServiceBusRecord should be instanceof ServiceBusRecord', () => {
      const record = new ServiceBusRecord({ foo: 'bar' });
      expect(record instanceof ServiceBusRecord).toBe(true);
    });

    it('built record should be instanceof ServiceBusRecord', () => {
      const record = new ServiceBusRecordBuilder().setData({ foo: 'bar' }).build();
      expect(record instanceof ServiceBusRecord).toBe(true);
    });
  });
});
