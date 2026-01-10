import { Injectable, Logger } from '@nestjs/common';
import { ServiceBusClientStatus, ServiceBusServerStatus } from '../constants';

/**
 * Health indicator result interface
 * Compatible with @nestjs/terminus HealthIndicatorResult
 */
export interface HealthIndicatorResult {
  [key: string]: {
    status: 'up' | 'down';
    message?: string;
    [optionalKeys: string]: any;
  };
}

/**
 * Health check error
 * Compatible with @nestjs/terminus HealthCheckError
 */
export class ServiceBusHealthCheckError extends Error {
  constructor(
    message: string,
    public readonly causes: HealthIndicatorResult,
  ) {
    super(message);
    this.name = 'ServiceBusHealthCheckError';
  }
}

/**
 * Interface for objects with getStatus method
 */
interface StatusProvider<T> {
  getStatus(): T;
}

/**
 * Health indicator for Azure Service Bus connections
 *
 * Provides health checks compatible with NestJS Terminus.
 * Can check both client and server connections.
 *
 * @example
 * ```typescript
 * // In your health controller
 * @Controller('health')
 * export class HealthController {
 *   constructor(
 *     private health: HealthCheckService,
 *     private serviceBusHealth: ServiceBusHealthIndicator,
 *     @Inject('SERVICE_BUS_CLIENT') private client: ServiceBusClientProxy,
 *   ) {
 *     this.serviceBusHealth.registerClient('main', client);
 *   }
 *
 *   @Get()
 *   @HealthCheck()
 *   check() {
 *     return this.health.check([
 *       () => this.serviceBusHealth.checkClient('serviceBus', 'main'),
 *     ]);
 *   }
 * }
 * ```
 */
@Injectable()
export class ServiceBusHealthIndicator {
  private readonly logger = new Logger(ServiceBusHealthIndicator.name);
  private readonly clients = new Map<string, StatusProvider<ServiceBusClientStatus>>();
  private readonly servers = new Map<string, StatusProvider<ServiceBusServerStatus>>();

  /**
   * Registers a client for health monitoring
   *
   * @param name - Unique name for the client
   * @param client - Client instance with getStatus method
   */
  registerClient(name: string, client: StatusProvider<ServiceBusClientStatus>): void {
    this.clients.set(name, client);
    this.logger.debug(`Registered client '${name}' for health monitoring`);
  }

  /**
   * Unregisters a client from health monitoring
   *
   * @param name - Name of the client to unregister
   */
  unregisterClient(name: string): void {
    this.clients.delete(name);
  }

  /**
   * Registers a server for health monitoring
   *
   * @param name - Unique name for the server
   * @param server - Server instance with getStatus method
   */
  registerServer(name: string, server: StatusProvider<ServiceBusServerStatus>): void {
    this.servers.set(name, server);
    this.logger.debug(`Registered server '${name}' for health monitoring`);
  }

  /**
   * Unregisters a server from health monitoring
   *
   * @param name - Name of the server to unregister
   */
  unregisterServer(name: string): void {
    this.servers.delete(name);
  }

  /**
   * Checks the health of a specific client
   *
   * @param key - Key for the health check result
   * @param clientName - Name of the registered client
   * @returns Health indicator result
   * @throws ServiceBusHealthCheckError if unhealthy
   */
  async checkClient(key: string, clientName: string): Promise<HealthIndicatorResult> {
    const client = this.clients.get(clientName);

    if (!client) {
      const result: HealthIndicatorResult = {
        [key]: {
          status: 'down',
          message: `Client '${clientName}' not registered`,
        },
      };
      throw new ServiceBusHealthCheckError(`Client '${clientName}' not registered`, result);
    }

    const status = client.getStatus();
    const isHealthy = status === ServiceBusClientStatus.CONNECTED;

    const result: HealthIndicatorResult = {
      [key]: {
        status: isHealthy ? 'up' : 'down',
        clientName,
        connectionStatus: status,
      },
    };

    if (!isHealthy) {
      throw new ServiceBusHealthCheckError(`Client '${clientName}' is ${status}`, result);
    }

    return result;
  }

  /**
   * Checks the health of a specific server
   *
   * @param key - Key for the health check result
   * @param serverName - Name of the registered server
   * @returns Health indicator result
   * @throws ServiceBusHealthCheckError if unhealthy
   */
  async checkServer(key: string, serverName: string): Promise<HealthIndicatorResult> {
    const server = this.servers.get(serverName);

    if (!server) {
      const result: HealthIndicatorResult = {
        [key]: {
          status: 'down',
          message: `Server '${serverName}' not registered`,
        },
      };
      throw new ServiceBusHealthCheckError(`Server '${serverName}' not registered`, result);
    }

    const status = server.getStatus();
    const isHealthy = status === ServiceBusServerStatus.CONNECTED;

    const result: HealthIndicatorResult = {
      [key]: {
        status: isHealthy ? 'up' : 'down',
        serverName,
        connectionStatus: status,
      },
    };

    if (!isHealthy) {
      throw new ServiceBusHealthCheckError(`Server '${serverName}' is ${status}`, result);
    }

    return result;
  }

  /**
   * Checks the health of all registered clients
   *
   * @param key - Key for the health check result
   * @returns Health indicator result
   * @throws ServiceBusHealthCheckError if any client is unhealthy
   */
  async checkAllClients(key: string): Promise<HealthIndicatorResult> {
    const results: Record<string, { status: 'up' | 'down'; connectionStatus: string }> = {};
    let allHealthy = true;

    for (const [name, client] of this.clients) {
      const status = client.getStatus();
      const isHealthy = status === ServiceBusClientStatus.CONNECTED;

      results[name] = {
        status: isHealthy ? 'up' : 'down',
        connectionStatus: status,
      };

      if (!isHealthy) {
        allHealthy = false;
      }
    }

    const result: HealthIndicatorResult = {
      [key]: {
        status: allHealthy ? 'up' : 'down',
        clients: results,
      },
    };

    if (!allHealthy) {
      throw new ServiceBusHealthCheckError('One or more clients are unhealthy', result);
    }

    return result;
  }

  /**
   * Checks the health of all registered servers
   *
   * @param key - Key for the health check result
   * @returns Health indicator result
   * @throws ServiceBusHealthCheckError if any server is unhealthy
   */
  async checkAllServers(key: string): Promise<HealthIndicatorResult> {
    const results: Record<string, { status: 'up' | 'down'; connectionStatus: string }> = {};
    let allHealthy = true;

    for (const [name, server] of this.servers) {
      const status = server.getStatus();
      const isHealthy = status === ServiceBusServerStatus.CONNECTED;

      results[name] = {
        status: isHealthy ? 'up' : 'down',
        connectionStatus: status,
      };

      if (!isHealthy) {
        allHealthy = false;
      }
    }

    const result: HealthIndicatorResult = {
      [key]: {
        status: allHealthy ? 'up' : 'down',
        servers: results,
      },
    };

    if (!allHealthy) {
      throw new ServiceBusHealthCheckError('One or more servers are unhealthy', result);
    }

    return result;
  }

  /**
   * Checks the health of all registered clients and servers
   *
   * @param key - Key for the health check result
   * @returns Health indicator result
   * @throws ServiceBusHealthCheckError if any client or server is unhealthy
   */
  async check(key: string): Promise<HealthIndicatorResult> {
    const clientResults: Record<string, any> = {};
    const serverResults: Record<string, any> = {};
    let allHealthy = true;

    // Check all clients
    for (const [name, client] of this.clients) {
      const status = client.getStatus();
      const isHealthy = status === ServiceBusClientStatus.CONNECTED;

      clientResults[name] = {
        status: isHealthy ? 'up' : 'down',
        connectionStatus: status,
      };

      if (!isHealthy) {
        allHealthy = false;
      }
    }

    // Check all servers
    for (const [name, server] of this.servers) {
      const status = server.getStatus();
      const isHealthy = status === ServiceBusServerStatus.CONNECTED;

      serverResults[name] = {
        status: isHealthy ? 'up' : 'down',
        connectionStatus: status,
      };

      if (!isHealthy) {
        allHealthy = false;
      }
    }

    const result: HealthIndicatorResult = {
      [key]: {
        status: allHealthy ? 'up' : 'down',
        ...(Object.keys(clientResults).length > 0 && { clients: clientResults }),
        ...(Object.keys(serverResults).length > 0 && { servers: serverResults }),
      },
    };

    if (!allHealthy) {
      throw new ServiceBusHealthCheckError('One or more connections are unhealthy', result);
    }

    return result;
  }
}
