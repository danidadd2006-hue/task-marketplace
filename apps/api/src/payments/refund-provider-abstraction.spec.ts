import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlutterwavePaymentProvider } from './flutterwave-payment-provider.js';
import { PendingPaymentProvider } from './payment-provider.js';

describe('refund provider abstraction — Step 4.4F', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['FLUTTERWAVE_SECRET_KEY'];
  });

  it('keeps refund capability provider-neutral and safely unsupported in the pending provider', async () => {
    const provider = new PendingPaymentProvider();
    await expect(provider.initiateRefund({
      refundId: 'refund-id', paymentProviderRef: 'payment-ref', amount: '70', currency: 'KES',
      idempotencyKey: 'refund:cancellation:cancellation-id',
    })).rejects.toThrow('does not support refunds');
  });

  it('normalizes Flutterwave processing refund initiation', async () => {
    process.env['FLUTTERWAVE_SECRET_KEY'] = 'secret';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { id: 123, amount: 100, currency: 'KES', status: 'successful' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { id: 456, flw_ref: 'FLW-REF', amount_refunded: 70, status: 'completed' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FlutterwavePaymentProvider().initiateRefund({
      refundId: 'refund-id', paymentProviderRef: 'payment-ref', amount: '70', currency: 'KES',
      idempotencyKey: 'refund:cancellation:cancellation-id',
    });

    expect(result.status).toBe('PROCESSING');
    expect(result.providerRef).toBe('FLW-REF');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/transactions/123/refund');
  });

  it('normalizes an explicitly final Flutterwave success', async () => {
    process.env['FLUTTERWAVE_SECRET_KEY'] = 'secret';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { id: 123, amount: 100, currency: 'KES', status: 'successful' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { id: 456, flw_ref: 'FLW-REF', status: 'completed-momo' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new FlutterwavePaymentProvider().initiateRefund({ refundId: 'refund-id', paymentProviderRef: 'payment-ref', amount: '70', currency: 'KES', idempotencyKey: 'key' });
    expect(result.status).toBe('SUCCEEDED');
  });

  it('normalizes provider failure without claiming a refund', async () => {
    process.env['FLUTTERWAVE_SECRET_KEY'] = 'secret';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { id: 123, amount: 100, currency: 'KES', status: 'successful' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error', message: 'Refund rejected', data: null }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new FlutterwavePaymentProvider().initiateRefund({ refundId: 'refund-id', paymentProviderRef: 'payment-ref', amount: '70', currency: 'KES', idempotencyKey: 'key' });
    expect(result.status).toBe('FAILED');
    expect(result.failureCode).toBe('400');
  });

  it('normalizes an unrecognized provider refund state as UNKNOWN', async () => {
    process.env['FLUTTERWAVE_SECRET_KEY'] = 'secret';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { id: 123, amount: 100, currency: 'KES', status: 'successful' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { id: 456, flw_ref: 'FLW-REF', status: 'mystery' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new FlutterwavePaymentProvider().initiateRefund({ refundId: 'refund-id', paymentProviderRef: 'payment-ref', amount: '70', currency: 'KES', idempotencyKey: 'key' });
    expect(result.status).toBe('UNKNOWN');
  });
});
