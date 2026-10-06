import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutProviderEventService } from './payout-provider-event.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  payoutFirst: vi.fn(),
  eventFirst: vi.fn(),
  eventCreate: vi.fn(),
  applyProviderEvent: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({ db: { transaction: mocks.transaction } }));

const payout = { id: 'payout-id', amount: '90.00', currency: 'KES', status: 'PENDING', provider: 'TEST', providerRef: null };
const event = { provider: 'TEST', providerEventId: 'payout-event-1', type: 'PAYOUT_SUCCEEDED' as const, payoutId: 'payout-id', providerRef: 'payout-ref', amount: '90.00', currency: 'KES', metadata: '{"status":"successful"}' };

function setup() {
  mocks.transaction.mockImplementation(async (callback) => callback({
    orm: { public: {
      PayoutProviderEvent: { where: vi.fn(() => ({ first: mocks.eventFirst })), create: mocks.eventCreate },
      Payout: { where: vi.fn(() => ({ first: mocks.payoutFirst })) },
    } },
  }));
}

describe('PayoutProviderEventService — Step 4.3C', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setup();
    mocks.eventFirst.mockResolvedValue(undefined);
    mocks.payoutFirst.mockResolvedValue(payout);
    mocks.eventCreate.mockResolvedValue({ id: 'event-id', payoutId: 'payout-id' });
    mocks.applyProviderEvent.mockResolvedValue({ status: 'RELEASED' });
  });

  function service() {
    return new PayoutProviderEventService({ applyProviderEvent: mocks.applyProviderEvent } as any);
  }

  it('processes a verified payout success and delegates atomic release completion', async () => {
    const result = await service().processNormalizedEvent(event);
    expect(result).toMatchObject({ status: 'PROCESSED', payoutId: 'payout-id' });
    expect(mocks.applyProviderEvent).toHaveBeenCalledWith(event, expect.anything());
  });

  it('returns duplicate for an already recorded provider event', async () => {
    mocks.eventFirst.mockResolvedValueOnce({ id: 'event-id', payoutId: 'payout-id' });
    const result = await service().processNormalizedEvent(event);
    expect(result.status).toBe('DUPLICATE');
    expect(mocks.applyProviderEvent).not.toHaveBeenCalled();
  });

  it('handles a concurrent provider-event uniqueness conflict idempotently', async () => {
    mocks.eventCreate.mockRejectedValueOnce({ sqlState: '23505' });
    mocks.eventFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 'event-id', payoutId: 'payout-id' });
    const result = await service().processNormalizedEvent(event);
    expect(result).toMatchObject({ status: 'DUPLICATE', payoutId: 'payout-id' });
    expect(mocks.applyProviderEvent).not.toHaveBeenCalled();
  });

  it('rejects provider reference mismatch without changing payout state', async () => {
    mocks.payoutFirst.mockResolvedValueOnce({ ...payout, providerRef: 'existing-payout-ref' });
    await expect(service().processNormalizedEvent({ ...event, providerRef: 'other-ref' })).rejects.toThrow('provider reference');
    expect(mocks.applyProviderEvent).not.toHaveBeenCalled();
  });

  it('rejects provider amount mismatch', async () => {
    await expect(service().processNormalizedEvent({ ...event, amount: '91.00' })).rejects.toThrow('amount or currency');
    expect(mocks.applyProviderEvent).not.toHaveBeenCalled();
  });

  it('rejects provider currency mismatch', async () => {
    await expect(service().processNormalizedEvent({ ...event, currency: 'USD' })).rejects.toThrow('amount or currency');
    expect(mocks.applyProviderEvent).not.toHaveBeenCalled();
  });

  it('delegates verified processing transition', async () => {
    mocks.payoutFirst.mockResolvedValueOnce({ ...payout, status: 'PENDING' });
    mocks.applyProviderEvent.mockResolvedValueOnce({ status: 'PROCESSING' });
    const result = await service().processNormalizedEvent({ ...event, type: 'PAYOUT_PROCESSING', providerRef: 'payout-ref' });
    expect(result).toMatchObject({ status: 'PROCESSED', payoutStatus: 'PROCESSING' });
  });

  it('delegates verified UNKNOWN transition', async () => {
    mocks.payoutFirst.mockResolvedValueOnce({ ...payout, status: 'PROCESSING' });
    mocks.applyProviderEvent.mockResolvedValueOnce({ status: 'UNKNOWN' });
    const result = await service().processNormalizedEvent({ ...event, type: 'PAYOUT_UNKNOWN', providerRef: 'payout-ref' });
    expect(result).toMatchObject({ status: 'PROCESSED', payoutStatus: 'UNKNOWN' });
  });

  it('delegates verified failure without releasing the Payment', async () => {
    mocks.payoutFirst.mockResolvedValueOnce({ ...payout, status: 'PROCESSING' });
    mocks.applyProviderEvent.mockResolvedValueOnce({ status: 'FAILED' });
    const result = await service().processNormalizedEvent({ ...event, type: 'PAYOUT_FAILED', providerRef: 'payout-ref' });
    expect(result).toMatchObject({ status: 'PROCESSED', payoutStatus: 'FAILED' });
  });
});
