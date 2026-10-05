import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { FlutterwavePaymentProvider } from './flutterwave-payment-provider.js';

describe('FlutterwavePaymentProvider', () => {
  const originalSecret = process.env['FLUTTERWAVE_SECRET_KEY'];
  const originalHash = process.env['FLUTTERWAVE_WEBHOOK_SECRET_HASH'];
  const originalRedirect = process.env['FLUTTERWAVE_REDIRECT_URL'];

  beforeEach(() => {
    process.env['FLUTTERWAVE_SECRET_KEY'] = 'test-secret';
    process.env['FLUTTERWAVE_WEBHOOK_SECRET_HASH'] = 'test-hash';
    process.env['FLUTTERWAVE_REDIRECT_URL'] = 'https://example.test/payment-return';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env['FLUTTERWAVE_SECRET_KEY'] = originalSecret;
    process.env['FLUTTERWAVE_WEBHOOK_SECRET_HASH'] = originalHash;
    process.env['FLUTTERWAVE_REDIRECT_URL'] = originalRedirect;
  });

  it('creates a hosted checkout without exposing provider credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 'success',
        data: {
          tx_ref: 'payment-id',
          link: 'https://checkout.flutterwave.com/example',
        },
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FlutterwavePaymentProvider().initiateFunding({
      paymentId: 'payment-id',
      amount: '100.00',
      currency: 'KES',
      customerEmail: 'client@example.com',
    });

    expect(result).toEqual({
      status: 'PENDING',
      provider: 'FLUTTERWAVE',
      providerRef: 'payment-id',
      checkoutUrl: 'https://checkout.flutterwave.com/example',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.flutterwave.com/v3/payments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-secret',
        }),
      }),
    );
  });

  it('verifies webhook signatures and re-verifies the transaction before normalising it', async () => {
    const rawBody = JSON.stringify({
      id: 'webhook-id',
      data: { id: 123, tx_ref: 'payment-id' },
    });
    const signature = createHmac('sha256', 'test-hash')
      .update(rawBody)
      .digest('base64');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 'success',
        data: {
          id: 123,
          tx_ref: 'payment-id',
          flw_ref: 'FLW-123',
          status: 'successful',
          amount: 100,
          currency: 'KES',
        },
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FlutterwavePaymentProvider().normalizeWebhook({
      body: JSON.parse(rawBody),
      headers: { 'flutterwave-signature': signature },
      rawBody,
    });

    expect(result).toMatchObject({
      provider: 'FLUTTERWAVE',
      providerEventId: 'webhook-id',
      type: 'FUNDING_SUCCEEDED',
      paymentId: 'payment-id',
      providerRef: 'FLW-123',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/transactions/verify_by_reference?tx_ref=payment-id'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-secret', Accept: 'application/json' },
      }),
    );
  });
});
