import type { ServiceBusMessage } from '@azure/service-bus';
import type { Serializer } from '@nestjs/microservices';
import { MESSAGE_PROPERTIES } from '../constants';
import { normalizePattern } from '../utils/pattern.utils';
import { serializeError } from '../utils/error.utils';
import type { SendMessageOptions } from '../interfaces';

/**
 * Outgoing message packet (request or event)
 */
export interface OutgoingMessage {
  pattern: any;
  data: any;
  id?: string;
  options?: SendMessageOptions;
}

/**
 * Outgoing response packet
 */
export interface OutgoingResponse {
  id: string;
  response?: any;
  err?: any;
  isDisposed?: boolean;
  replyTo?: string;
}

/**
 * Serializer for outgoing messages to Azure Service Bus
 * Converts NestJS packets to Azure Service Bus message format
 */
export class ServiceBusSerializer implements Serializer<
  OutgoingMessage | OutgoingResponse,
  ServiceBusMessage
> {
  /**
   * Serializes a NestJS packet to an Azure Service Bus message
   *
   * @param packet - Outgoing packet to serialize
   * @returns Azure Service Bus message
   */
  serialize(packet: OutgoingMessage | OutgoingResponse): ServiceBusMessage {
    // Check if this is a response packet
    if (this.isResponsePacket(packet)) {
      return this.serializeResponse(packet);
    }

    // It's an outgoing request/event
    return this.serializeRequest(packet as OutgoingMessage);
  }

  /**
   * Serializes an outgoing request or event
   */
  private serializeRequest(packet: OutgoingMessage): ServiceBusMessage {
    const { pattern, data, id, options } = packet;

    const message: ServiceBusMessage = {
      body: data,
      correlationId: id,
      contentType: options?.contentType ?? 'application/json',
      subject: options?.subject,
      sessionId: options?.sessionId ?? this.extractSessionId(data),
      timeToLive: options?.timeToLiveMs,
      applicationProperties: {
        [MESSAGE_PROPERTIES.NESTJS_MARKER]: true,
        [MESSAGE_PROPERTIES.PATTERN]: normalizePattern(pattern),
        ...options?.applicationProperties,
      },
    };

    return message;
  }

  /**
   * Serializes a response packet
   */
  private serializeResponse(packet: OutgoingResponse): ServiceBusMessage {
    const { id, response, err, isDisposed } = packet;

    const message: ServiceBusMessage = {
      body: err ? undefined : response,
      correlationId: id,
      contentType: 'application/json',
      applicationProperties: {
        [MESSAGE_PROPERTIES.NESTJS_MARKER]: true,
        [MESSAGE_PROPERTIES.IS_RESPONSE]: true,
        [MESSAGE_PROPERTIES.IS_DISPOSED]: isDisposed ?? false,
      },
    };

    // Serialize error if present
    if (err) {
      message.applicationProperties![MESSAGE_PROPERTIES.ERROR] = JSON.stringify(
        serializeError(err),
      );
    }

    return message;
  }

  /**
   * Type guard to check if packet is a response
   */
  private isResponsePacket(packet: OutgoingMessage | OutgoingResponse): packet is OutgoingResponse {
    return 'response' in packet || 'err' in packet || 'isDisposed' in packet;
  }

  /**
   * Extracts session ID from data if present
   * Looks for __sessionId property
   */
  private extractSessionId(data: any): string | undefined {
    if (data && typeof data === 'object' && '__sessionId' in data) {
      const sessionId = data.__sessionId;
      // Remove the internal property from data
      delete data.__sessionId;
      return sessionId;
    }
    return undefined;
  }
}

/**
 * Factory function to create a ServiceBusSerializer instance
 */
export function createServiceBusSerializer(): ServiceBusSerializer {
  return new ServiceBusSerializer();
}
