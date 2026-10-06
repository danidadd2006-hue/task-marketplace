import { Injectable, Logger } from '@nestjs/common';
import type { MessageCreatedRealtimeEvent, MessageDeliveryTransport } from './message-realtime.event.js';

@Injectable()
export class MessageDeliveryService {
  private readonly logger = new Logger(MessageDeliveryService.name);
  private transport: MessageDeliveryTransport | null = null;

  registerTransport(transport: MessageDeliveryTransport): void {
    this.transport = transport;
  }

  clearTransport(transport: MessageDeliveryTransport): void {
    if (this.transport === transport) {
      this.transport = null;
    }
  }

  async publishMessageCreated(event: MessageCreatedRealtimeEvent): Promise<void> {
    if (!this.transport) {
      return;
    }

    try {
      await this.transport.publishMessageCreated(event);
    } catch (error) {
      this.logger.warn(
        `Realtime delivery failed for message ${event.messageId}; durable message remains authoritative.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
