# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-01-09

### Added

#### Connection Resilience
- `ConnectionManager` utility with exponential backoff reconnection
- Circuit breaker pattern to prevent cascade failures during outages
  - Three states: CLOSED, OPEN, HALF_OPEN
  - Configurable failure threshold and reset timeout
- Auto-reconnection for both client and server
- Sender recovery when connections are restored
- `reconnect()` method for manual reconnection triggers
- `getCircuitState()`, `canProceed()`, `resetCircuit()` methods
- `ServiceBusCircuitOpenError` for circuit breaker failures

#### OpenTelemetry Observability
- `ServiceBusMetricsService` for metrics collection:
  - `service_bus_messages_published_total` counter
  - `service_bus_messages_received_total` counter
  - `service_bus_messages_completed_total` counter
  - `service_bus_messages_failed_total` counter
  - `service_bus_publish_duration_seconds` histogram
  - `service_bus_handle_duration_seconds` histogram
  - `service_bus_connection_status` gauge
  - `service_bus_pending_requests` gauge
- `ServiceBusTracingService` for distributed tracing:
  - Span creation for publish and process operations
  - Context propagation via message applicationProperties
  - W3C trace context headers (traceparent, tracestate)
- Optional dependency: only activates if `@opentelemetry/api` is installed

#### Health Checks
- `ServiceBusHealthModule` for NestJS Terminus integration
- `ServiceBusHealthIndicator` with methods:
  - `registerClient()`, `registerServer()` for monitoring registration
  - `checkClient()`, `checkServer()` for individual checks
  - `checkAllClients()`, `checkAllServers()` for bulk checks
  - `check()` for comprehensive health status
- Compatible with NestJS Terminus `HealthCheckService`
- Optional dependency: only required if using health checks

#### Graceful Shutdown
- Server implements `OnApplicationShutdown` for proper lifecycle management
- `gracefulClose()` method with configurable drain period
- In-flight message tracking with `getInFlightCount()`
- Client module implements `OnModuleDestroy` for auto-cleanup
- Configurable `drainTimeoutMs` and `gracePeriodMs` options

#### Configuration Options
- `reconnect` options: enabled, maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier, jitterFactor
- `circuitBreaker` options: enabled, failureThreshold, resetTimeoutMs, halfOpenMaxAttempts
- `observability` options: metrics, tracing (boolean or detailed config)
- `drainTimeoutMs`, `gracePeriodMs` for shutdown behavior

#### New Events
- `reconnecting` event for client and server

### Changed

- Server class now implements `OnApplicationShutdown` interface
- Client module now implements `OnModuleDestroy` interface
- `SubscriptionManager` now includes `isHealthy()` method and health status in `getInfo()`
- `ReplyQueueManager` now has `cancelAllPending()` and `restart()` methods

### Fixed

- Proper cleanup of connection manager resources on close

## [0.2.0] - 2026-01-08

### Added

#### NestJS Convention Alignment
- `NO_MESSAGE_HANDLER` constant for consistent error messaging
- Server now sends error responses when no handler is found (matching RabbitMQ transporter behavior)
- Full streaming response support using base class `send()` method

#### ServiceBusRecord Pattern
- `ServiceBusRecord` class for per-message options (similar to `RmqRecord`)
- `ServiceBusRecordBuilder` with fluent API for building records
  - `setSessionId()`, `setCorrelationId()`, `setMessageId()`
  - `setTimeToLive()`, `setScheduledEnqueueTime()`
  - `setApplicationProperties()`, `setSubject()`, `setContentType()`

#### Connection Events
- `on('connected', callback)` - Emitted when client connects
- `on('disconnected', callback)` - Emitted when client disconnects  
- `on('error', callback)` - Emitted on connection errors

#### Administration Module
- `ServiceBusAdminModule` with `forRoot()` and `forRootAsync()` configuration
- `ServiceBusAdminService` for managing Azure Service Bus entities:
  - Queue management: `createQueue()`, `updateQueue()`, `deleteQueue()`, `getQueue()`, `listQueues()`
  - Topic management: `createTopic()`, `updateTopic()`, `deleteTopic()`, `getTopic()`, `listTopics()`
  - Subscription management: `createSubscription()`, `updateSubscription()`, `deleteSubscription()`, `getSubscription()`, `listSubscriptions()`
  - Rule management: `createRule()`, `updateRule()`, `deleteRule()`, `getRule()`, `listRules()`
  - Helper methods: `createSqlFilter()`, `createCorrelationFilter()`, `createSqlAction()`
  - Convenience methods: `ensureQueue()`, `ensureTopic()`, `ensureSubscription()`

#### Advanced Client Operations
- Batch operations: `createMessageBatch()`, `sendBatch()`, `sendMany()`
- Message browsing: `peekMessages()`, `peekDeadLetterMessages()`
- Deferred messages: `receiveDeferredMessages()`
- Scheduled messages: `scheduleMessages()`, `cancelScheduledMessages()`
- Session management: `acceptSession()`, `acceptNextSession()`
- Rule management: `createRuleManager()`

### Changed

- Server now uses inherited `transformToObservable()` instead of custom implementation
- Server uses `getOptionsProp()` helper for all option extraction
- Serializer now detects and handles `ServiceBusRecord` instances
- Response batching uses `process.nextTick` for proper streaming support

### Fixed

- Clients no longer timeout silently when no message handler exists

## [0.1.0] - 2026-01-07

### Added

- Initial release of `@nestjs-azure/service-bus`
- Full NestJS custom transporter implementation for Azure Service Bus
- Support for both queues and topics/subscriptions
- Request-response pattern with automatic reply queue management
- Event-based messaging pattern
- Session support with `SessionManager` for ordered message processing
- Dead-letter queue handling with `@DeadLetterHandler()` decorator
- Custom decorators: `@ServiceBusSubscription()`, `@ServiceBusContext()`, `@DeadLetterHandler()`
- Message settlement: complete, abandon, defer, dead-letter
- Configurable retry policies and receive modes
- Support for both connection string and Azure Identity authentication
- `ServiceBusClientModule` for standalone client usage
- Custom serializer/deserializer support
- Comprehensive error types: `ConnectionError`, `SessionError`, `OperationError`, `MessageSettlementError`
- Full TypeScript support with exported interfaces
- 289 unit tests with 87%+ code coverage
