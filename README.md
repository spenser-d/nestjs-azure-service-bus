# @nestjs-azure/service-bus

[![npm version](https://badge.fury.io/js/@nestjs-azure%2Fservice-bus.svg)](https://www.npmjs.com/package/@nestjs-azure/service-bus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A fully-featured NestJS custom transporter for Azure Service Bus with pub-sub (Topics/Subscriptions) support.

## Features

- **Topics/Subscriptions (Pub-Sub)** - Full support for Azure Service Bus Topics and Subscriptions
- **Session Support** - FIFO ordering and session state management for ordered message processing
- **Both Authentication Methods** - Connection string and Azure AD (Managed Identity/DefaultAzureCredential)
- **Message Settlement** - Manual and auto-complete modes (complete, abandon, defer, dead-letter)
- **Dead-Letter Queue** - Built-in DLQ handling with dedicated `@DeadLetterHandler` decorator
- **Scheduled Messages** - Schedule messages for future delivery
- **Request-Response Pattern** - Full support for send/receive patterns via shared reply queue
- **Event Pattern** - Fire-and-forget message publishing with `emit()`
- **Custom Decorators** - `@ServiceBusSubscription`, `@DeadLetterHandler`, `@ServiceBusCtx`
- **ServiceBusRecord Builder** - Per-message options with fluent API (like RmqRecord)
- **Batch Operations** - Efficient batch sending of multiple messages
- **Message Browsing** - Peek messages without consuming them
- **Deferred Messages** - Defer and retrieve messages by sequence number
- **Administration Service** - Manage queues, topics, subscriptions, and rules programmatically
- **Connection Resilience** - Auto-reconnection with exponential backoff and circuit breaker pattern
- **OpenTelemetry Observability** - Built-in metrics and distributed tracing support
- **Health Checks** - NestJS Terminus integration for production monitoring
- **Graceful Shutdown** - Proper lifecycle management with drain period for in-flight messages
- **Connection Events** - Subscribe to connect/disconnect/reconnecting events for observability
- **Comprehensive Error Handling** - Typed errors for connection, authentication, settlement, and session issues
- **Full NestJS Convention Compliance** - Aligned with official NestJS microservices patterns
- **Full TypeScript Support** - Complete type definitions included

## Installation

### From npm

```bash
npm install @nestjs-azure/service-bus @azure/service-bus
```

### From GitHub

You can install directly from GitHub without the package being published to npm:

```bash
# Latest from main branch
npm install github:spenser-d/nestjs-azure-service-bus @azure/service-bus

# Specific version (recommended)
npm install github:spenser-d/nestjs-azure-service-bus#v0.1.0 @azure/service-bus
```

Or add to your `package.json` dependencies:

```json
{
  "dependencies": {
    "@nestjs-azure/service-bus": "github:spenser-d/nestjs-azure-service-bus#v0.1.0",
    "@azure/service-bus": "^7.9.0"
  }
}
```

### Azure AD Authentication (optional)

For Azure AD authentication (recommended for production):

```bash
npm install @azure/identity
```

## Requirements

- Node.js >= 18.0.0
- NestJS >= 10.0.0
- @azure/service-bus >= 7.9.0

## Quick Start

### Server Setup (Consumer)

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { ServiceBusServer } from '@nestjs-azure/service-bus';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      strategy: new ServiceBusServer({
        connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
        subscriptions: [
          {
            topic: 'orders',
            subscription: 'order-processor',
            sessionEnabled: true,
            handleDeadLetter: true,
          },
          {
            topic: 'notifications',
            subscription: 'notification-handler',
          },
        ],
        autoComplete: false, // Manual settlement
        autoDeadLetter: true, // Dead-letter on errors
      }),
    },
  );

  await app.listen();
  console.log('Microservice is listening');
}
bootstrap();
```

### Client Setup (Producer)

#### Synchronous Registration

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ServiceBusClientModule } from '@nestjs-azure/service-bus';

@Module({
  imports: [
    ServiceBusClientModule.register([
      {
        name: 'ORDER_SERVICE',
        connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
        topic: 'orders',
      },
    ]),
  ],
})
export class AppModule {}
```

#### Asynchronous Registration (with ConfigService)

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServiceBusClientModule } from '@nestjs-azure/service-bus';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ServiceBusClientModule.registerAsync([
      {
        name: 'ORDER_SERVICE',
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => ({
          connectionString: config.get('SERVICE_BUS_CONNECTION_STRING'),
          topic: config.get('SERVICE_BUS_TOPIC'),
        }),
        inject: [ConfigService],
      },
    ]),
  ],
})
export class AppModule {}
```

### Message Handlers

```typescript
// order.controller.ts
import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { 
  ServiceBusCtx, 
  ServiceBusContext,
  DeadLetterHandler,
} from '@nestjs-azure/service-bus';

@Controller()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // Fire-and-forget event handler
  @EventPattern('order.created')
  async handleOrderCreated(
    @Payload() data: CreateOrderDto,
    @ServiceBusCtx() ctx: ServiceBusContext,
  ) {
    try {
      await this.orderService.process(data);
      await ctx.complete(); // Manual settlement
    } catch (error) {
      if (shouldRetry(error)) {
        await ctx.abandon({ propertiesToModify: { retryCount: ctx.getDeliveryCount() } });
      } else {
        await ctx.deadLetter({
          deadLetterReason: 'ProcessingFailed',
          deadLetterErrorDescription: error.message,
        });
      }
    }
  }

  // Request-response handler
  @MessagePattern('order.get')
  async getOrder(@Payload() data: { orderId: string }) {
    return this.orderService.findById(data.orderId);
  }

  // Session-aware handler (messages with same sessionId processed in order)
  @EventPattern('order.step')
  async handleOrderStep(
    @Payload() data: OrderStepDto,
    @ServiceBusCtx() ctx: ServiceBusContext,
  ) {
    // Get session state
    const state = await ctx.getSessionState();
    const orderState = state ? JSON.parse(state.toString()) : {};
    
    // Process step in order
    orderState.steps = [...(orderState.steps || []), data.step];
    
    // Save session state
    await ctx.setSessionState(Buffer.from(JSON.stringify(orderState)));
    await ctx.complete();
  }

  // Dead-letter queue handler
  @DeadLetterHandler('order.created')
  async handleFailedOrder(
    @Payload() data: any,
    @ServiceBusCtx() ctx: ServiceBusContext,
  ) {
    const reason = ctx.getDeadLetterReason();
    const description = ctx.getDeadLetterErrorDescription();
    
    await this.alertService.notifyFailedOrder(data, reason, description);
    await ctx.complete();
  }
}
```

### Sending Messages

```typescript
// order.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ServiceBusClientProxy } from '@nestjs-azure/service-bus';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class OrderService {
  constructor(
    @Inject('ORDER_SERVICE') private client: ServiceBusClientProxy,
  ) {}

  async onModuleInit() {
    // Connect the client (optional - auto-connects on first message)
    await this.client.connect();
  }

  // Fire-and-forget
  async createOrder(dto: CreateOrderDto) {
    await lastValueFrom(this.client.emit('order.created', dto));
  }

  // Request-response
  async getOrder(orderId: string): Promise<Order> {
    return lastValueFrom(this.client.send('order.get', { orderId }));
  }

  // Scheduled message
  async scheduleReminder(orderId: string, date: Date) {
    const sequenceNumber = await this.client.scheduleMessage(
      'order.reminder',
      { orderId },
      date,
    );
    return sequenceNumber; // Can be used to cancel later
  }

  // Cancel scheduled message
  async cancelReminder(sequenceNumber: Long) {
    await this.client.cancelScheduledMessage(sequenceNumber);
  }

  // Session-targeted message (for FIFO ordering)
  async sendOrderStep(orderId: string, step: number) {
    await lastValueFrom(
      this.client.emit('order.step', {
        step,
        __sessionId: orderId, // Messages with same sessionId processed in order
      }),
    );
  }
}
```

## ServiceBusRecord (Per-Message Options)

Similar to NestJS's `RmqRecord`, the `ServiceBusRecord` allows you to set per-message options:

```typescript
import { ServiceBusRecord, ServiceBusRecordBuilder } from '@nestjs-azure/service-bus';

// Using constructor directly
const record = new ServiceBusRecord(
  { orderId: '12345', amount: 99.99 },
  { sessionId: 'user-abc', timeToLiveMs: 60000 }
);
client.send('process-order', record).subscribe();

// Using fluent builder (recommended)
const record = new ServiceBusRecordBuilder<OrderData>()
  .setData({ orderId: '12345', amount: 99.99 })
  .setSessionId('user-abc')
  .setTimeToLive(60000)
  .setSubject('order-created')
  .setApplicationProperties({ priority: 'high', region: 'us-west' })
  .build();

client.send('process-order', record).subscribe();
client.emit('order-created', record);
```

### Available Options

| Option | Type | Description |
|--------|------|-------------|
| `sessionId` | `string` | Session ID for session-enabled entities |
| `partitionKey` | `string` | Partition key for message grouping |
| `correlationId` | `string` | Custom correlation ID |
| `contentType` | `string` | Content type (default: `application/json`) |
| `subject` | `string` | Subject/label for the message |
| `timeToLiveMs` | `number` | Time to live in milliseconds |
| `scheduledEnqueueTimeUtc` | `Date` | Scheduled delivery time |
| `messageId` | `string` | Custom message ID |
| `replyTo` | `string` | Reply-to address |
| `replyToSessionId` | `string` | Reply-to session ID |
| `applicationProperties` | `Record<string, any>` | Custom properties |

## Batch Operations

Send multiple messages efficiently:

```typescript
// Simple batch (array of messages)
await client.sendMany('create-order', [
  { orderId: '1', amount: 10 },
  { orderId: '2', amount: 20 },
  { orderId: '3', amount: 30 },
]);

// Advanced batch with size control
const batch = await client.createMessageBatch('orders');
for (const order of largeOrderList) {
  const message = client.serializeMessage('create-order', order);
  if (!batch.tryAddMessage(message)) {
    // Batch is full, send it and create a new one
    await client.sendBatch(batch, 'orders');
    batch = await client.createMessageBatch('orders');
    batch.tryAddMessage(message);
  }
}
// Send remaining messages
await client.sendBatch(batch, 'orders');
```

## Message Browsing (Peek)

Peek messages without consuming them:

```typescript
// Peek first 10 messages
const messages = await client.peekMessages('orders', 'processor', 10);
for (const msg of messages) {
  console.log('Preview:', msg.body);
}

// Peek from dead letter queue
const dlqMessages = await client.peekDeadLetterMessages('orders', 'processor', 10);
```

## Deferred Messages

Defer messages for later processing:

```typescript
// In handler - defer the message
@MessagePattern('process-order')
async handleOrder(data: OrderData, @Ctx() ctx: ServiceBusContext) {
  if (!isReadyToProcess()) {
    // Store the sequence number for later
    const sequenceNumber = ctx.getSequenceNumber();
    await storeDeferredSequenceNumber(sequenceNumber);
    await ctx.defer();
    return;
  }
  // Process normally...
}

// Later - retrieve and process deferred messages
const sequenceNumbers = await getStoredDeferredSequenceNumbers();
const messages = await client.receiveDeferredMessages(
  'orders',
  'processor',
  sequenceNumbers,
);

for (const msg of messages) {
  await processOrder(msg.body);
}
```

## Connection Events

Subscribe to connection state changes:

```typescript
const client = new ServiceBusClientProxy(options);

client.on('connected', () => {
  console.log('Connected to Service Bus');
});

client.on('disconnected', (error) => {
  console.log('Disconnected:', error?.message);
});

client.on('error', (error) => {
  console.error('Connection error:', error);
});

await client.connect();
```

## Administration Service

Manage Azure Service Bus entities programmatically:

### Setup

```typescript
import { ServiceBusAdminModule } from '@nestjs-azure/service-bus';

@Module({
  imports: [
    ServiceBusAdminModule.forRoot({
      connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
    }),
    // Or with async configuration
    ServiceBusAdminModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connectionString: config.get('SERVICE_BUS_CONNECTION_STRING'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### Using the Admin Service

```typescript
import { ServiceBusAdminService } from '@nestjs-azure/service-bus';

@Injectable()
export class SetupService {
  constructor(private readonly admin: ServiceBusAdminService) {}

  async setupInfrastructure() {
    // Ensure topic exists
    await this.admin.ensureTopic('orders');

    // Create subscription with filter
    await this.admin.createSubscription('orders', 'high-priority', {
      defaultRuleOptions: {
        name: 'high-priority-filter',
        filter: this.admin.createSqlFilter("priority = 'high'"),
      },
    });

    // Add another filter rule
    await this.admin.createRule(
      'orders',
      'high-priority',
      'region-filter',
      this.admin.createCorrelationFilter({
        applicationProperties: { region: 'us-west' },
      }),
    );

    // Get runtime info
    const info = await this.admin.getSubscriptionRuntimeProperties('orders', 'high-priority');
    console.log('Active messages:', info.activeMessageCount);
    console.log('Dead letter count:', info.deadLetterMessageCount);
  }
}
```

### Available Operations

**Queues:**
- `createQueue`, `getQueue`, `updateQueue`, `deleteQueue`, `queueExists`
- `getQueueRuntimeProperties`, `listQueues`, `listQueuesRuntimeProperties`
- `ensureQueue` - create if not exists

**Topics:**
- `createTopic`, `getTopic`, `updateTopic`, `deleteTopic`, `topicExists`
- `getTopicRuntimeProperties`, `listTopics`, `listTopicsRuntimeProperties`
- `ensureTopic` - create if not exists

**Subscriptions:**
- `createSubscription`, `getSubscription`, `updateSubscription`, `deleteSubscription`, `subscriptionExists`
- `getSubscriptionRuntimeProperties`, `listSubscriptions`, `listSubscriptionsRuntimeProperties`
- `ensureSubscription` - create if not exists

**Rules/Filters:**
- `createRule`, `getRule`, `deleteRule`, `ruleExists`, `listRules`
- Helper methods: `createSqlFilter`, `createCorrelationFilter`, `createSqlAction`

## Authentication

### Connection String

```typescript
new ServiceBusServer({
  connectionString: 'Endpoint=sb://mynamespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...',
  subscriptions: [...],
});
```

### Azure AD (Managed Identity) - Recommended for Production

```typescript
import { DefaultAzureCredential } from '@azure/identity';

new ServiceBusServer({
  fullyQualifiedNamespace: 'mynamespace.servicebus.windows.net',
  credential: new DefaultAzureCredential(),
  subscriptions: [...],
});
```

This supports:
- Managed Identity (in Azure)
- Azure CLI credentials (local development)
- Environment variables
- Visual Studio Code credentials

## Connection Resilience

The transporter includes built-in connection resilience with automatic reconnection and circuit breaker patterns.

### Auto-Reconnection

Enable automatic reconnection when the connection to Azure Service Bus is lost:

```typescript
new ServiceBusServer({
  connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
  subscriptions: [...],
  // Reconnection options
  reconnect: {
    enabled: true,           // Enable auto-reconnection (default: true)
    maxRetries: Infinity,    // Maximum reconnection attempts
    initialDelayMs: 1000,    // Initial delay between attempts
    maxDelayMs: 30000,       // Maximum delay (exponential backoff)
    backoffMultiplier: 2,    // Backoff multiplier
    jitterFactor: 0.1,       // Random jitter to prevent thundering herd
  },
});
```

### Circuit Breaker

Prevent cascade failures during outages with the circuit breaker pattern:

```typescript
new ServiceBusClientProxy({
  connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
  topic: 'orders',
  // Circuit breaker options
  circuitBreaker: {
    enabled: true,           // Enable circuit breaker (default: true)
    failureThreshold: 5,     // Failures before opening circuit
    resetTimeoutMs: 30000,   // Time before attempting to close
    halfOpenMaxAttempts: 3,  // Attempts in half-open state
  },
});
```

The circuit breaker has three states:
- **CLOSED** - Normal operation, requests flow through
- **OPEN** - Requests fail immediately (after threshold reached)
- **HALF_OPEN** - Testing if service recovered

```typescript
// Check circuit state programmatically
const state = client.getCircuitState(); // 'closed' | 'open' | 'half_open'
const canProceed = client.canProceed(); // boolean

// Manually reset the circuit
client.resetCircuit();
```

### Connection Events

Subscribe to connection and reconnection events:

```typescript
client.on('connected', () => console.log('Connected'));
client.on('disconnected', (error) => console.log('Disconnected:', error?.message));
client.on('reconnecting', () => console.log('Attempting to reconnect...'));
client.on('error', (error) => console.error('Error:', error));
```

## OpenTelemetry Observability

Built-in support for OpenTelemetry metrics and distributed tracing. Install the optional dependency:

```bash
npm install @opentelemetry/api
```

### Enabling Observability

```typescript
new ServiceBusServer({
  connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
  subscriptions: [...],
  observability: {
    metrics: true,   // Enable metrics (or { meterName: 'my-app' })
    tracing: true,   // Enable tracing (or { tracerName: 'my-app' })
  },
});
```

### Metrics Collected

| Metric | Type | Description |
|--------|------|-------------|
| `service_bus_messages_published_total` | Counter | Messages published |
| `service_bus_messages_received_total` | Counter | Messages received |
| `service_bus_messages_completed_total` | Counter | Messages completed |
| `service_bus_messages_failed_total` | Counter | Messages failed |
| `service_bus_publish_duration_seconds` | Histogram | Publish latency |
| `service_bus_handle_duration_seconds` | Histogram | Handler latency |
| `service_bus_connection_status` | Gauge | Connection status (0/1) |
| `service_bus_pending_requests` | Gauge | Pending request-response operations |

### Distributed Tracing

Trace context is automatically propagated through message headers, enabling end-to-end tracing across services.

## Health Checks

Integrate with NestJS Terminus for health monitoring. Install the optional dependency:

```bash
npm install @nestjs/terminus
```

### Setup

```typescript
import { ServiceBusHealthModule, ServiceBusHealthIndicator } from '@nestjs-azure/service-bus';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [
    ServiceBusHealthModule,
    TerminusModule,
  ],
})
export class AppModule {}
```

### Health Controller

```typescript
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ServiceBusHealthIndicator, ServiceBusClientProxy } from '@nestjs-azure/service-bus';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private serviceBusHealth: ServiceBusHealthIndicator,
    @Inject('ORDER_SERVICE') private client: ServiceBusClientProxy,
  ) {
    // Register client for monitoring
    this.serviceBusHealth.registerClient('orders', client);
  }

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.serviceBusHealth.checkClient('serviceBus', 'orders'),
    ]);
  }
}
```

## Graceful Shutdown

The server automatically handles graceful shutdown when the application stops.

### Configuration

```typescript
new ServiceBusServer({
  connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
  subscriptions: [...],
  drainTimeoutMs: 30000,  // Wait for in-flight messages (default: 30s)
  gracePeriodMs: 5000,    // Additional grace period (default: 5s)
});
```

### Behavior

1. On shutdown signal (SIGTERM, etc.), the server stops accepting new messages
2. Waits for in-flight messages to complete (up to `drainTimeoutMs`)
3. Waits additional `gracePeriodMs` before closing connections
4. Closes all subscription managers and the client

The client module also automatically closes all registered clients when the module is destroyed.

## Configuration Options

### Server Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connectionString` | string | - | Service Bus connection string |
| `fullyQualifiedNamespace` | string | - | Namespace for AAD auth (e.g., `mynamespace.servicebus.windows.net`) |
| `credential` | TokenCredential | - | Azure credential for AAD auth |
| `subscriptions` | SubscriptionConfig[] | required | Subscription configurations |
| `receiveMode` | `'peekLock'` \| `'receiveAndDelete'` | `'peekLock'` | Default receive mode |
| `autoComplete` | boolean | `true` | Auto-complete successful messages |
| `autoDeadLetter` | boolean | `false` | Auto dead-letter on handler errors |
| `maxConcurrentCalls` | number | `1` | Max concurrent message handlers |
| `sessionEnabled` | boolean | `false` | Default session setting |
| `maxConcurrentSessions` | number | `5` | Max concurrent sessions |
| `sessionIdleTimeoutMs` | number | `60000` | Session idle timeout in ms |

### Subscription Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `topic` | string | required | Topic name |
| `subscription` | string | required | Subscription name |
| `sessionEnabled` | boolean | inherited | Enable sessions for this subscription |
| `receiveMode` | `'peekLock'` \| `'receiveAndDelete'` | inherited | Receive mode |
| `handleDeadLetter` | boolean | `false` | Also process DLQ messages |
| `autoComplete` | boolean | inherited | Auto-complete setting |
| `autoDeadLetter` | boolean | inherited | Auto dead-letter setting |
| `maxConcurrentCalls` | number | inherited | Max concurrent handlers |
| `maxConcurrentSessions` | number | inherited | Max concurrent sessions |

### Client Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | required | Injection token name |
| `connectionString` | string | - | Service Bus connection string |
| `fullyQualifiedNamespace` | string | - | Namespace for AAD auth |
| `credential` | TokenCredential | - | Azure credential |
| `topic` | string | required | Default topic for sending |
| `replyTopic` | string | same as topic | Topic for reply queue |
| `replySubscription` | string | auto-generated | Subscription for replies |
| `requestTimeout` | number | `30000` | Request-response timeout (ms) |

## ServiceBusContext API

The context object provides access to message details and settlement methods.

### Message Properties

| Method | Returns | Description |
|--------|---------|-------------|
| `getMessage()` | `ServiceBusReceivedMessage` | Original Azure SDK message |
| `getPattern()` | `string` | Message pattern |
| `getData()` | `any` | Message body/payload |
| `getCorrelationId()` | `string \| undefined` | Correlation ID |
| `getMessageId()` | `string \| undefined` | Message ID |
| `getDeliveryCount()` | `number` | Delivery attempt count |
| `getSequenceNumber()` | `bigint` | Message sequence number |
| `getEnqueuedTime()` | `Date \| undefined` | When message was enqueued |
| `getLockedUntil()` | `Date \| undefined` | Lock expiration time |
| `getExpiresAt()` | `Date \| undefined` | Message expiration time |
| `getApplicationProperties()` | `Record<string, any>` | Custom properties |
| `getApplicationProperty<T>(key)` | `T \| undefined` | Specific custom property |
| `getTopic()` | `string` | Topic name |
| `getSubscription()` | `string` | Subscription name |

### Dead-Letter Properties

| Method | Returns | Description |
|--------|---------|-------------|
| `isFromDeadLetterQueue()` | `boolean` | Whether from DLQ |
| `getDeadLetterReason()` | `string \| undefined` | DLQ reason |
| `getDeadLetterErrorDescription()` | `string \| undefined` | DLQ error description |

### Settlement Methods

| Method | Description |
|--------|-------------|
| `complete()` | Mark message as successfully processed |
| `abandon(options?)` | Return to queue for retry |
| `defer(options?)` | Defer for later processing by sequence number |
| `deadLetter(options?)` | Move to dead-letter queue |
| `renewLock()` | Renew message lock (returns new lock time) |
| `isSettled()` | Check if message has been settled |

### Session Methods (when `sessionEnabled: true`)

| Method | Returns | Description |
|--------|---------|-------------|
| `getSessionId()` | `string \| undefined` | Session ID |
| `isSessionReceiver()` | `boolean` | Whether using session receiver |
| `getSessionState()` | `Promise<Buffer \| undefined>` | Get session state |
| `setSessionState(state)` | `Promise<void>` | Set session state |
| `renewSessionLock()` | `Promise<Date>` | Renew session lock |

## Custom Decorators

### @ServiceBusSubscription

Enhanced pattern decorator with subscription-specific options:

```typescript
import { ServiceBusSubscription } from '@nestjs-azure/service-bus';

@ServiceBusSubscription('order.created', {
  topic: 'orders',
  subscription: 'order-processor',
  autoComplete: false,
})
async handleOrder(@Payload() data: OrderDto) {
  // ...
}
```

Aliases available:
- `@ServiceBusEvent(pattern, options?)` - For event patterns
- `@ServiceBusMessage(pattern, options?)` - For request-response patterns

### @DeadLetterHandler

Handler for dead-lettered messages:

```typescript
import { DeadLetterHandler, ServiceBusCtx, ServiceBusContext } from '@nestjs-azure/service-bus';

@DeadLetterHandler('order.created', {
  topic: 'orders',
  subscription: 'order-processor',
})
async handleFailedOrder(
  @Payload() data: any,
  @ServiceBusCtx() ctx: ServiceBusContext,
) {
  console.log('Dead letter reason:', ctx.getDeadLetterReason());
  await ctx.complete();
}
```

### @ServiceBusCtx / @SBContext

Parameter decorator to inject ServiceBusContext:

```typescript
import { ServiceBusCtx, SBContext } from '@nestjs-azure/service-bus';

// Both are equivalent
async handle(@ServiceBusCtx() ctx: ServiceBusContext) { }
async handle(@SBContext() ctx: ServiceBusContext) { }
```

## Error Handling

The package provides typed error classes for better error handling:

```typescript
import {
  ServiceBusTransportError,
  ServiceBusConnectionError,
  ServiceBusAuthenticationError,
  ServiceBusConnectionLostError,
  ServiceBusMessageSettlementError,
  ServiceBusMessageLockLostError,
  ServiceBusMessageTooLargeError,
  ServiceBusSessionLockLostError,
  ServiceBusSessionCannotBeLockedError,
  ServiceBusSessionTimeoutError,
  ServiceBusTimeoutError,
  ServiceBusQuotaExceededError,
  ServiceBusEntityNotFoundError,
  ServiceBusSerializationError,
  ServiceBusDeserializationError,
} from '@nestjs-azure/service-bus';

try {
  await ctx.complete();
} catch (error) {
  if (error instanceof ServiceBusMessageLockLostError) {
    // Message lock expired - message will be redelivered
    console.log('Lock lost, message will be retried');
  } else if (error instanceof ServiceBusMessageSettlementError) {
    // Settlement failed for another reason
    console.log('Settlement action:', error.action);
    console.log('Message ID:', error.messageId);
  }
}
```

### Error Properties

All errors extend `ServiceBusTransportError` and include:
- `code` - Error code (e.g., `'MESSAGE_LOCK_LOST'`)
- `isTransient` - Whether the error is transient (retryable)
- `originalError` - Original Azure SDK error
- `context` - Additional context information
- `toJSON()` - Serialize error for logging

### Utility Functions

```typescript
import { wrapError, isTransientError, isServiceBusError } from '@nestjs-azure/service-bus';

// Wrap any error in appropriate ServiceBusTransportError
const wrappedError = wrapError(error, { topic: 'orders' });

// Check if error is transient (retryable)
if (isTransientError(error)) {
  // Safe to retry
}

// Check if error is from Azure SDK
if (isServiceBusError(error)) {
  console.log('Azure error code:', error.code);
}
```

## Hybrid Application (HTTP + Microservice)

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { ServiceBusServer } from '@nestjs-azure/service-bus';
import { AppModule } from './app.module';

async function bootstrap() {
  // Create HTTP application
  const app = await NestFactory.create(AppModule);
  
  // Connect microservice
  app.connectMicroservice<MicroserviceOptions>({
    strategy: new ServiceBusServer({
      connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
      subscriptions: [
        { topic: 'orders', subscription: 'api-handler' },
      ],
    }),
  });

  // Start all
  await app.startAllMicroservices();
  await app.listen(3000);
}
bootstrap();
```

## Testing

The package is designed to be testable. You can mock the `ServiceBusClientProxy`:

```typescript
const mockClient = {
  emit: jest.fn().mockReturnValue(of(undefined)),
  send: jest.fn().mockReturnValue(of({ result: 'test' })),
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

const module = await Test.createTestingModule({
  providers: [
    OrderService,
    { provide: 'ORDER_SERVICE', useValue: mockClient },
  ],
}).compile();
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Spenser Dubin

## Links

- [GitHub Repository](https://github.com/spenser-d/nestjs-azure-service-bus)
- [npm Package](https://www.npmjs.com/package/@nestjs-azure/service-bus)
- [Azure Service Bus Documentation](https://docs.microsoft.com/en-us/azure/service-bus-messaging/)
- [NestJS Microservices Documentation](https://docs.nestjs.com/microservices/basics)
