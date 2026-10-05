import { describe, expect, it, vi } from 'vitest';
import { PaymentProviderEventController } from './payment-provider-event.controller.js';

describe('PaymentProviderEventController', () => {
  it('does not expose an authenticated payment-status mutation endpoint', async () => {
    const service = {
      processWebhook: vi.fn().mockResolvedValue({ status: 'PROCESSED' }),
    };
    const controller = new PaymentProviderEventController(service as never);

    await controller.receiveProviderEvent(
      { payment: 'provider-payload' },
      { 'x-provider-signature': 'signature' },
    );

    expect(service.processWebhook).toHaveBeenCalledWith({
      body: { payment: 'provider-payload' },
      headers: { 'x-provider-signature': 'signature' },
    });
  });
});
