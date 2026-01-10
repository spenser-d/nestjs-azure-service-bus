import type { ServiceBusMessage } from '@azure/service-bus';
import type { Serializer } from '@nestjs/microservices';
import { MESSAGE_PROPERTIES } from '../constants';
import { normalizePattern } from '../utils/pattern.utils';
import { serializeError } from '../utils/error.utils';
import type { SendMessageOptions } from '../interfaces';
import { ServiceBusRecord, ServiceBusRecordOptions } from '../record-builders';

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
 *
 * Follows NestJS RmqRecordSerializer pattern for ServiceBusRecord support
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

    // Handle ServiceBusRecord pattern (NestJS convention like RmqRecord)
    const outgoingPacket = packet as OutgoingMessage;
    if (this.isRecordPacket(outgoingPacket)) {
      const record = outgoingPacket.data as ServiceBusRecord;
      return this.serializeRequest({
        ...outgoingPacket,
        data: record.data,
        options: this.mergeOptions(outgoingPacket.options, record.options),
      });
    }

    // It's an outgoing request/event
    return this.serializeRequest(outgoingPacket);
  }

  /**
   * Serializes an outgoing request or event
   */
  private serializeRequest(packet: OutgoingMessage): ServiceBusMessage {
    const { pattern, id, options } = packet;
    let { data } = packet;

    // Extract session ID from data without mutating the original
    const extractedSessionId = this.extractSessionId(data);
    if (extractedSessionId !== undefined && data && typeof data === 'object') {
      // Create a shallow copy without __sessionId
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { __sessionId: _sessionId, ...cleanData } = data;
      data = cleanData;
    }

    const message: ServiceBusMessage = {
      body: data,
      correlationId: options?.correlationId ?? id,
      contentType: options?.contentType ?? 'application/json',
      subject: options?.subject,
      sessionId: options?.sessionId ?? extractedSessionId,
      messageId: options?.messageId,
      partitionKey: options?.partitionKey,
      replyTo: options?.replyTo,
      replyToSessionId: options?.replyToSessionId,
      timeToLive: options?.timeToLiveMs,
      scheduledEnqueueTimeUtc: options?.scheduledEnqueueTimeUtc,
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
   * Type guard to check if packet data is a ServiceBusRecord
   * Follows NestJS RmqRecordSerializer pattern
   */
  private isRecordPacket(packet: OutgoingMessage): boolean {
    return packet?.data instanceof ServiceBusRecord;
  }

  /**
   * Merges packet options with record options
   * Record options take precedence (closer to the message)
   */
  private mergeOptions(
    packetOptions?: SendMessageOptions,
    recordOptions?: ServiceBusRecordOptions,
  ): SendMessageOptions {
    if (!recordOptions) {
      return packetOptions ?? {};
    }

    return {
      ...packetOptions,
      ...recordOptions,
      applicationProperties: {
        ...packetOptions?.applicationProperties,
        ...recordOptions?.applicationProperties,
      },
    };
  }

  /**
   * Extracts session ID from data if present
   * Looks for __sessionId property (legacy support)
   * Does NOT mutate the original data
   */
  private extractSessionId(data: unknown): string | undefined {
    if (data && typeof data === 'object' && '__sessionId' in data) {
      const sessionId = (data as Record<string, unknown>).__sessionId;
      return typeof sessionId === 'string' ? sessionId : undefined;
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
