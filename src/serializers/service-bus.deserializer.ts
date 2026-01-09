import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import type { Deserializer } from '@nestjs/microservices';
import { MESSAGE_PROPERTIES } from '../constants';
import { deserializeError } from '../utils/error.utils';
import type { IncomingPacket, ResponsePacket } from '../interfaces';

/**
 * Incoming packet (request, event, or response)
 */
export type IncomingMessage = IncomingPacket | ResponsePacket;

/**
 * Deserializer for incoming messages from Azure Service Bus
 * Converts Azure Service Bus messages to NestJS packet format
 */
export class ServiceBusDeserializer implements Deserializer<
  ServiceBusReceivedMessage,
  IncomingMessage
> {
  /**
   * Deserializes an Azure Service Bus message to a NestJS packet
   *
   * @param message - Incoming Service Bus message
   * @returns NestJS packet (request, event, or response)
   */
  deserialize(message: ServiceBusReceivedMessage): IncomingMessage {
    const applicationProperties = message.applicationProperties ?? {};

    // Check if this is a response message
    if (applicationProperties[MESSAGE_PROPERTIES.IS_RESPONSE]) {
      return this.deserializeResponse(message);
    }

    // It's a request or event
    return this.deserializeRequest(message);
  }

  /**
   * Deserializes an incoming request or event
   */
  private deserializeRequest(message: ServiceBusReceivedMessage): IncomingPacket {
    const applicationProperties = message.applicationProperties ?? {};
    const pattern = applicationProperties[MESSAGE_PROPERTIES.PATTERN] as string | undefined;

    return {
      id: message.correlationId as string | undefined,
      pattern: pattern ?? '',
      data: message.body,
    };
  }

  /**
   * Deserializes a response message
   */
  private deserializeResponse(message: ServiceBusReceivedMessage): ResponsePacket {
    const applicationProperties = message.applicationProperties ?? {};
    const isDisposed = applicationProperties[MESSAGE_PROPERTIES.IS_DISPOSED] as boolean;
    const errorJson = applicationProperties[MESSAGE_PROPERTIES.ERROR] as string | undefined;

    let err: Error | undefined;
    if (errorJson) {
      try {
        const errorData = JSON.parse(errorJson);
        err = deserializeError(errorData);
      } catch {
        err = new Error(errorJson);
      }
    }

    return {
      id: message.correlationId as string,
      response: err ? undefined : message.body,
      err,
      isDisposed,
    };
  }

  /**
   * Checks if a message is a NestJS message
   * (has the NestJS marker in applicationProperties)
   */
  isNestJsMessage(message: ServiceBusReceivedMessage): boolean {
    const applicationProperties = message.applicationProperties ?? {};
    return applicationProperties[MESSAGE_PROPERTIES.NESTJS_MARKER] === true;
  }

  /**
   * Checks if a message is a response message
   */
  isResponseMessage(message: ServiceBusReceivedMessage): boolean {
    const applicationProperties = message.applicationProperties ?? {};
    return applicationProperties[MESSAGE_PROPERTIES.IS_RESPONSE] === true;
  }

  /**
   * Extracts the pattern from a message
   */
  getPattern(message: ServiceBusReceivedMessage): string {
    const applicationProperties = message.applicationProperties ?? {};
    return (applicationProperties[MESSAGE_PROPERTIES.PATTERN] as string) ?? '';
  }
}

/**
 * Factory function to create a ServiceBusDeserializer instance
 */
export function createServiceBusDeserializer(): ServiceBusDeserializer {
  return new ServiceBusDeserializer();
}
