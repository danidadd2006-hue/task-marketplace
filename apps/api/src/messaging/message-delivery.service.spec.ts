import { describe, expect, it, vi } from 'vitest';
import { MessageDeliveryService } from './message-delivery.service.js';

const event = {
  eventType: 'MESSAGE_CREATED' as const,
  messageId: 'message-1',
  conversationId: 'conversation-1',
  senderId: 'user-1',
  type: 'TEXT' as const,
  content: 'hello',
  attachments: [],
  location: null,
  createdAt: new Date().toISOString(),
};

describe('MessageDeliveryService', () => {
  it('does nothing when no realtime transport is registered', async () => {
    const service = new MessageDeliveryService();
    await expect(service.publishMessageCreated(event)).resolves.toBeUndefined();
  });

  it('does not propagate transport failure into durable messaging flow', async () => {
    const service = new MessageDeliveryService();
    const transport = {
      publishMessageCreated: vi.fn().mockRejectedValue(new Error('socket unavailable')),
    };

    service.registerTransport(transport);

    await expect(service.publishMessageCreated(event)).resolves.toBeUndefined();
    expect(transport.publishMessageCreated).toHaveBeenCalledWith(event);
  });
});
