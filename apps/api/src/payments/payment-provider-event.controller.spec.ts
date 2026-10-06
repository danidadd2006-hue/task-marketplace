import { describe, expect, it, vi } from 'vitest';
import { PaymentProviderEventController } from './payment-provider-event.controller.js';

describe('PaymentProviderEventController', () => {
  it('passes the raw request body to the provider-event boundary without user authentication', async () => {
    const service = {
      processWebhook: vi.fn().mockResolvedValue({ status: 'PROCESSED' }),
    };
    const controller = new PaymentProviderEventController(service as never);

    const rawBody = Buffer.from('{"payment":"provider-payload"}');

    await controller.receiveProviderEvent(
      { payment: 'provider-payload' },
      { 'x-provider-signature': 'signature' },
      { rawBody } as never,
    );

    expect(service.processWebhook).toHaveBeenCalledWith({
      body: { payment: 'provider-payload' },
      headers: { 'x-provider-signature': 'signature' },
      rawBody: '{"payment":"provider-payload"}',
    });
  });
});
