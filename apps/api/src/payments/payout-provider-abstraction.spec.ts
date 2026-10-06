import { describe, expect, it, vi } from 'vitest';
import { FlutterwavePaymentProvider } from './flutterwave-payment-provider.js';
import { PendingPaymentProvider } from './payment-provider.js';

describe('payout provider abstraction', () => {
  it('exposes payout operations without making them operational in the pending provider', async () => {
    const provider = new PendingPaymentProvider();
    await expect(provider.initiatePayout({ payoutId: 'payout-id', destination: { provider: 'TEST', method: 'BANK', providerAccountRef: 'token' }, amount: '90', currency: 'KES' })).rejects.toThrow('payout initiation is not configured');
    await expect(provider.reconcilePayout({ payoutId: 'payout-id', providerRef: 'payout-ref', amount: '90', currency: 'KES' })).rejects.toThrow('payout reconciliation is not configured');
  });

  it('does not reuse Flutterwave funding endpoints for payout operations', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new FlutterwavePaymentProvider();
    await expect(provider.initiatePayout({ payoutId: 'payout-id', destination: { provider: 'FLUTTERWAVE', method: 'BANK', providerAccountRef: 'token' }, amount: '90', currency: 'KES' })).rejects.toThrow('payout initiation is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
