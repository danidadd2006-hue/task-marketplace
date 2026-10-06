import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { FlutterwavePaymentProvider } from './flutterwave-payment-provider.js';

describe('FlutterwavePaymentProvider', () => {
  const originalSecret = process.env['FLUTTERWAVE_SECRET_KEY'];
  const originalHash = process.env['FLUTTERWAVE_WEBHOOK_SECRET_HASH'];
  const originalRedirect = process.env['FLUTTERWAVE_REDIRECT_URL'];

  beforeEach(() => {
    process.env['FLUTTERWAVE_SECRET_KEY'] = 'test-secret';
    process.env['FLUTTERWAVE_WEBHOOK_SECRET_HASH'] = 'test-hash';
    process.env['FLUTTERWAVE_REDIRECT_URL'] =
      'https://example.test/payment-return';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env['FLUTTERWAVE_SECRET_KEY'] = originalSecret;
    process.env['FLUTTERWAVE_WEBHOOK_SECRET_HASH'] = originalHash;
    process.env['FLUTTERWAVE_REDIRECT_URL'] = originalRedirect;
  });

  it('creates a hosted checkout using the stable local Payment ID as tx_ref', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            tx_ref: 'payment-id',
            link: 'https://checkout.flutterwave.com/example',
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FlutterwavePaymentProvider().initiateFunding({
      paymentId: 'payment-id',
      amount: '100',
      currency: 'KES',
      customerEmail: 'client@example.com',
    });

    expect(result).toEqual({
      status: 'PENDING',
      provider: 'FLUTTERWAVE',
      providerRef: 'payment-id',
      checkoutUrl: 'https://checkout.flutterwave.com/example',
    });

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.tx_ref).toBe('payment-id');
    expect(body.currency).toBe('KES');
    expect(body.amount).toBe(100);
    expect(body.payment_options).toContain('card');
    expect(body.payment_options).toContain('banktransfer');
    expect(body.payment_options).toContain('mpesa');
    expect(request.headers.Authorization).toBe('Bearer test-secret');
  });

  it('does not silently round a decimal amount unsupported by the documented Standard endpoint', async () => {
    await expect(
      new FlutterwavePaymentProvider().initiateFunding({
        paymentId: 'payment-id',
        amount: '100.25',
        currency: 'USD',
        customerEmail: 'client@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reconciles an existing pending transaction by the stable tx_ref without creating another transaction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: [
            {
              tx_ref: 'payment-id',
              status: 'pending',
              amount: 100,
              currency: 'KES',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FlutterwavePaymentProvider().reconcileFunding({
      paymentId: 'payment-id',
      amount: '100',
      currency: 'KES',
    });

    expect(result).toEqual({
      status: 'FOUND',
      provider: 'FLUTTERWAVE',
      providerRef: 'payment-id',
      checkoutUrl: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/transactions?tx_ref=payment-id',
    );
  });

  it('allows a new initiation when provider lookup confirms no transaction exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'success', data: [] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new FlutterwavePaymentProvider().reconcileFunding({
        paymentId: 'payment-id',
        amount: '100',
        currency: 'KES',
      }),
    ).resolves.toEqual({ status: 'NOT_FOUND' });
  });

  it('treats provider lookup failures as uncertain and never assumes no transaction exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'failed', message: 'temporary error' }),
        { status: 500 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new FlutterwavePaymentProvider().reconcileFunding({
        paymentId: 'payment-id',
        amount: '100',
        currency: 'KES',
      }),
    ).rejects.toThrow('temporary error');
  });

  it('rejects webhook signature failures before provider verification', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new FlutterwavePaymentProvider().normalizeWebhook({
        body: { data: { tx_ref: 'payment-id' } },
        headers: { 'flutterwave-signature': 'wrong' },
        rawBody: '{"data":{"tx_ref":"payment-id"}}',
      }),
    ).rejects.toThrow('Invalid Flutterwave webhook signature');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies the raw webhook signature and re-verifies the transaction before normalising it', async () => {
    const rawBody = JSON.stringify({
      id: 'webhook-id',
      data: { id: 123, tx_ref: 'payment-id' },
    });
    const signature = createHmac('sha256', 'test-hash')
      .update(rawBody)
      .digest('base64');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            id: 123,
            tx_ref: 'payment-id',
            flw_ref: 'FLW-123',
            status: 'successful',
            amount: 100,
            currency: 'KES',
          },
        }),
        { status: 200 },
      ),
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
      providerRef: 'payment-id',
      amount: '100',
      currency: 'KES',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/transactions/verify_by_reference?tx_ref=payment-id',
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-secret',
          Accept: 'application/json',
        },
      }),
    );
  });

  it('rejects refund webhook signature failures before refund lookup', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new FlutterwavePaymentProvider().normalizeRefundWebhook({
        body: { id: 89074, status: 'completed' },
        headers: { 'flutterwave-signature': 'wrong' },
        rawBody: '{"id":89074,"status":"completed"}',
      }),
    ).rejects.toThrow('Invalid Flutterwave webhook signature');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies and normalises the documented Flutterwave refund webhook', async () => {
    const rawBody = JSON.stringify({
      id: 89074,
      AmountRefunded: 70,
      status: 'completed-bank-transfer',
      FlwRef: 'URF-123',
      TransactionId: 123456,
    });
    const signature = createHmac('sha256', 'test-hash')
      .update(rawBody)
      .digest('base64');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'success',
            data: {
              id: 89074,
              AmountRefunded: 70,
              status: 'completed-bank-transfer',
              FlwRef: 'URF-123',
              TransactionId: 123456,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'success',
            data: {
              id: 123456,
              tx_ref: 'payment-id',
              amount: 100,
              currency: 'KES',
              status: 'successful',
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FlutterwavePaymentProvider().normalizeRefundWebhook({
      body: JSON.parse(rawBody),
      headers: { 'flutterwave-signature': signature },
      rawBody,
    });

    expect(result).toMatchObject({
      provider: 'FLUTTERWAVE',
      providerEventId: 'refund:89074:completed-bank-transfer',
      type: 'REFUND_SUCCEEDED',
      providerRefundId: '89074',
      providerRef: 'URF-123',
      paymentProviderRef: 'payment-id',
      amount: '70',
      currency: 'KES',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/refunds/89074');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/transactions/123456/verify');
  });

  it('maps Flutterwave completed refund status to PROCESSING rather than success', async () => {
    const rawBody = JSON.stringify({
      id: 89074,
      AmountRefunded: 70,
      status: 'completed',
      FlwRef: 'URF-123',
      TransactionId: 123456,
    });
    const signature = createHmac('sha256', 'test-hash')
      .update(rawBody)
      .digest('base64');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'success',
            data: {
              id: 89074,
              AmountRefunded: 70,
              status: 'completed',
              FlwRef: 'URF-123',
              TransactionId: 123456,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'success',
            data: {
              id: 123456,
              tx_ref: 'payment-id',
              amount: 100,
              currency: 'KES',
              status: 'successful',
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FlutterwavePaymentProvider().normalizeRefundWebhook({
      body: JSON.parse(rawBody),
      headers: { 'flutterwave-signature': signature },
      rawBody,
    });

    expect(result.type).toBe('REFUND_PROCESSING');
  });
});
