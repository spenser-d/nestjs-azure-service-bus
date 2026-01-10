import {
  ServiceBusHealthIndicator,
  ServiceBusHealthCheckError,
} from '../../../src/health/service-bus.health';
import { ServiceBusClientStatus, ServiceBusServerStatus } from '../../../src/constants';

describe('ServiceBusHealthCheckError', () => {
  it('should create error with message and causes', () => {
    const causes = {
      myClient: {
        status: 'down' as const,
        message: 'Connection failed',
      },
    };

    const error = new ServiceBusHealthCheckError('Health check failed', causes);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ServiceBusHealthCheckError');
    expect(error.message).toBe('Health check failed');
    expect(error.causes).toEqual(causes);
  });
});

describe('ServiceBusHealthIndicator', () => {
  let healthIndicator: ServiceBusHealthIndicator;

  beforeEach(() => {
    healthIndicator = new ServiceBusHealthIndicator();
  });

  describe('client registration', () => {
    it('should register a client', () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };

      healthIndicator.registerClient('main', mockClient);

      // Verify by checking the client
      expect(healthIndicator.checkClient('test', 'main')).resolves.toBeDefined();
    });

    it('should unregister a client', async () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };

      healthIndicator.registerClient('main', mockClient);
      healthIndicator.unregisterClient('main');

      await expect(healthIndicator.checkClient('test', 'main')).rejects.toThrow(
        ServiceBusHealthCheckError,
      );
    });
  });

  describe('server registration', () => {
    it('should register a server', () => {
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };

      healthIndicator.registerServer('main', mockServer);

      // Verify by checking the server
      expect(healthIndicator.checkServer('test', 'main')).resolves.toBeDefined();
    });

    it('should unregister a server', async () => {
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };

      healthIndicator.registerServer('main', mockServer);
      healthIndicator.unregisterServer('main');

      await expect(healthIndicator.checkServer('test', 'main')).rejects.toThrow(
        ServiceBusHealthCheckError,
      );
    });
  });

  describe('checkClient', () => {
    it('should return healthy result for connected client', async () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };

      healthIndicator.registerClient('main', mockClient);

      const result = await healthIndicator.checkClient('serviceBus', 'main');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          clientName: 'main',
          connectionStatus: ServiceBusClientStatus.CONNECTED,
        },
      });
    });

    it('should throw for disconnected client', async () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.DISCONNECTED),
      };

      healthIndicator.registerClient('main', mockClient);

      await expect(healthIndicator.checkClient('serviceBus', 'main')).rejects.toThrow(
        ServiceBusHealthCheckError,
      );

      try {
        await healthIndicator.checkClient('serviceBus', 'main');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceBusHealthCheckError);
        expect((error as ServiceBusHealthCheckError).causes).toEqual({
          serviceBus: {
            status: 'down',
            clientName: 'main',
            connectionStatus: ServiceBusClientStatus.DISCONNECTED,
          },
        });
      }
    });

    it('should throw for reconnecting client', async () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.RECONNECTING),
      };

      healthIndicator.registerClient('main', mockClient);

      await expect(healthIndicator.checkClient('serviceBus', 'main')).rejects.toThrow(
        ServiceBusHealthCheckError,
      );
    });

    it('should throw for unregistered client', async () => {
      await expect(healthIndicator.checkClient('serviceBus', 'unknown')).rejects.toThrow(
        "Client 'unknown' not registered",
      );
    });
  });

  describe('checkServer', () => {
    it('should return healthy result for connected server', async () => {
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };

      healthIndicator.registerServer('main', mockServer);

      const result = await healthIndicator.checkServer('serviceBus', 'main');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          serverName: 'main',
          connectionStatus: ServiceBusServerStatus.CONNECTED,
        },
      });
    });

    it('should throw for disconnected server', async () => {
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.DISCONNECTED),
      };

      healthIndicator.registerServer('main', mockServer);

      await expect(healthIndicator.checkServer('serviceBus', 'main')).rejects.toThrow(
        ServiceBusHealthCheckError,
      );

      try {
        await healthIndicator.checkServer('serviceBus', 'main');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceBusHealthCheckError);
        expect((error as ServiceBusHealthCheckError).causes).toEqual({
          serviceBus: {
            status: 'down',
            serverName: 'main',
            connectionStatus: ServiceBusServerStatus.DISCONNECTED,
          },
        });
      }
    });

    it('should throw for reconnecting server', async () => {
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.RECONNECTING),
      };

      healthIndicator.registerServer('main', mockServer);

      await expect(healthIndicator.checkServer('serviceBus', 'main')).rejects.toThrow(
        ServiceBusHealthCheckError,
      );
    });

    it('should throw for unregistered server', async () => {
      await expect(healthIndicator.checkServer('serviceBus', 'unknown')).rejects.toThrow(
        "Server 'unknown' not registered",
      );
    });
  });

  describe('checkAllClients', () => {
    it('should return healthy result when all clients are connected', async () => {
      const mockClient1 = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };
      const mockClient2 = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };

      healthIndicator.registerClient('client1', mockClient1);
      healthIndicator.registerClient('client2', mockClient2);

      const result = await healthIndicator.checkAllClients('serviceBus');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          clients: {
            client1: {
              status: 'up',
              connectionStatus: ServiceBusClientStatus.CONNECTED,
            },
            client2: {
              status: 'up',
              connectionStatus: ServiceBusClientStatus.CONNECTED,
            },
          },
        },
      });
    });

    it('should throw when one client is unhealthy', async () => {
      const mockClient1 = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };
      const mockClient2 = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.DISCONNECTED),
      };

      healthIndicator.registerClient('client1', mockClient1);
      healthIndicator.registerClient('client2', mockClient2);

      await expect(healthIndicator.checkAllClients('serviceBus')).rejects.toThrow(
        'One or more clients are unhealthy',
      );

      try {
        await healthIndicator.checkAllClients('serviceBus');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceBusHealthCheckError);
        const causes = (error as ServiceBusHealthCheckError).causes;
        expect(causes.serviceBus.status).toBe('down');
        expect(causes.serviceBus.clients.client1.status).toBe('up');
        expect(causes.serviceBus.clients.client2.status).toBe('down');
      }
    });

    it('should return healthy result when no clients are registered', async () => {
      const result = await healthIndicator.checkAllClients('serviceBus');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          clients: {},
        },
      });
    });
  });

  describe('checkAllServers', () => {
    it('should return healthy result when all servers are connected', async () => {
      const mockServer1 = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };
      const mockServer2 = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };

      healthIndicator.registerServer('server1', mockServer1);
      healthIndicator.registerServer('server2', mockServer2);

      const result = await healthIndicator.checkAllServers('serviceBus');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          servers: {
            server1: {
              status: 'up',
              connectionStatus: ServiceBusServerStatus.CONNECTED,
            },
            server2: {
              status: 'up',
              connectionStatus: ServiceBusServerStatus.CONNECTED,
            },
          },
        },
      });
    });

    it('should throw when one server is unhealthy', async () => {
      const mockServer1 = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };
      const mockServer2 = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.DISCONNECTED),
      };

      healthIndicator.registerServer('server1', mockServer1);
      healthIndicator.registerServer('server2', mockServer2);

      await expect(healthIndicator.checkAllServers('serviceBus')).rejects.toThrow(
        'One or more servers are unhealthy',
      );

      try {
        await healthIndicator.checkAllServers('serviceBus');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceBusHealthCheckError);
        const causes = (error as ServiceBusHealthCheckError).causes;
        expect(causes.serviceBus.status).toBe('down');
        expect(causes.serviceBus.servers.server1.status).toBe('up');
        expect(causes.serviceBus.servers.server2.status).toBe('down');
      }
    });

    it('should return healthy result when no servers are registered', async () => {
      const result = await healthIndicator.checkAllServers('serviceBus');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          servers: {},
        },
      });
    });
  });

  describe('check', () => {
    it('should return healthy result when all clients and servers are connected', async () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };

      healthIndicator.registerClient('client', mockClient);
      healthIndicator.registerServer('server', mockServer);

      const result = await healthIndicator.check('serviceBus');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          clients: {
            client: {
              status: 'up',
              connectionStatus: ServiceBusClientStatus.CONNECTED,
            },
          },
          servers: {
            server: {
              status: 'up',
              connectionStatus: ServiceBusServerStatus.CONNECTED,
            },
          },
        },
      });
    });

    it('should throw when a client is unhealthy', async () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.DISCONNECTED),
      };
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };

      healthIndicator.registerClient('client', mockClient);
      healthIndicator.registerServer('server', mockServer);

      await expect(healthIndicator.check('serviceBus')).rejects.toThrow(
        'One or more connections are unhealthy',
      );
    });

    it('should throw when a server is unhealthy', async () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.DISCONNECTED),
      };

      healthIndicator.registerClient('client', mockClient);
      healthIndicator.registerServer('server', mockServer);

      await expect(healthIndicator.check('serviceBus')).rejects.toThrow(
        'One or more connections are unhealthy',
      );
    });

    it('should return healthy result with only clients registered', async () => {
      const mockClient = {
        getStatus: jest.fn().mockReturnValue(ServiceBusClientStatus.CONNECTED),
      };

      healthIndicator.registerClient('client', mockClient);

      const result = await healthIndicator.check('serviceBus');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          clients: {
            client: {
              status: 'up',
              connectionStatus: ServiceBusClientStatus.CONNECTED,
            },
          },
        },
      });
      expect(result.serviceBus.servers).toBeUndefined();
    });

    it('should return healthy result with only servers registered', async () => {
      const mockServer = {
        getStatus: jest.fn().mockReturnValue(ServiceBusServerStatus.CONNECTED),
      };

      healthIndicator.registerServer('server', mockServer);

      const result = await healthIndicator.check('serviceBus');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
          servers: {
            server: {
              status: 'up',
              connectionStatus: ServiceBusServerStatus.CONNECTED,
            },
          },
        },
      });
      expect(result.serviceBus.clients).toBeUndefined();
    });

    it('should return healthy result when nothing is registered', async () => {
      const result = await healthIndicator.check('serviceBus');

      expect(result).toEqual({
        serviceBus: {
          status: 'up',
        },
      });
    });
  });
});
