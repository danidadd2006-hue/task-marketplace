import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { RefundProviderService } from './refund-provider.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  provider: { initiateRefund: vi.fn() },
}));

let stateService: { transition: ReturnType<typeof vi.fn> };

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: { public: { Refund: { where: vi.fn() } } },
  },
}));

function setup({
  cancellation = {
    id: 'cancellation-id',
    paymentId: 'payment-id',
    financialClassification: 'PARTIAL_REFUND',
    clientRefund: '70',
    fundedAmount: '100',
    currency: 'KES',
  },
  payment = {
    id: 'payment-id',
    amount: '100',
    currency: 'KES',
    status: 'FUNDED',
    providerRef: 'payment-provider-ref',
  },
  refund = null as any,
} = {}) {
  let refundRow = refund;
  const refundWhere = vi.fn(() => ({
    first: vi.fn(async () => refundRow),
    create: vi.fn(async (input) => {
      refundRow = { id: 'refund-id', ...input };
      return refundRow;
    }),
    update: vi.fn(async (input) => {
      if (!refundRow) return 0;
      refundRow = { ...refundRow, ...input };
      return 1;
    }),
  }));
  const tx = {
    orm: {
      public: {
        Cancellation: { where: vi.fn(() => ({ first: vi.fn(async () => cancellation) })) },
        Payment: { where: vi.fn(() => ({ first: vi.fn(async () => payment) })) },
        Refund: { where: refundWhere, create: vi.fn(async (input) => { refundRow = { id: 'refund-id', ...input }; return refundRow; }) },
      },
    },
  };
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  mocks.provider.initiateRefund.mockReset();
  stateService = {
    transition: vi.fn(async (_id: string, status: string) => {
      refundRow = { ...refundRow, status, uncertaintyReason: status === 'UNKNOWN' ? 'Provider refund initiation outcome is uncertain' : refundRow?.uncertaintyReason };
      return {
      refundId: 'refund-id', paymentId: 'payment-id', cancellationId: 'cancellation-id',
      previousStatus: status === 'PROCESSING' ? 'PENDING' : 'PROCESSING',
      status, amount: '70', currency: 'KES', paymentStatus: status === 'SUCCEEDED' ? 'REFUNDED' : 'FUNDED',
      paymentRefundedAt: status === 'SUCCEEDED' ? new Date().toISOString() : null, idempotent: false,
      };
    }),
  };
  return { getRefund: () => refundRow, refundWhere, stateService };
}

describe('RefundProviderService — Step 4.4F', () => {
  it('creates one authoritative refund from Cancellation.clientRefund and preserves server currency', async () => {
    const { refundWhere, stateService } = setup();
    mocks.provider.initiateRefund.mockResolvedValue({
      provider: 'FLUTTERWAVE',
      status: 'PROCESSING',
      providerRef: 'refund-provider-ref',
    });

    const service = new RefundProviderService(mocks.provider as any, stateService as any);
    const result = await service.initiateForCancellation('cancellation-id');

    expect(refundWhere).toHaveBeenCalled();
    expect(mocks.provider.initiateRefund).toHaveBeenCalledWith(expect.objectContaining({
      refundId: 'refund-id',
      paymentProviderRef: 'payment-provider-ref',
      amount: '70',
      currency: 'KES',
      idempotencyKey: 'refund:cancellation:cancellation-id',
    }));
    expect(result?.status).toBe('PROCESSING');
    expect(result?.amount).toBe('70');
  });

  it('does not create a refund for NO_FINANCIAL_ACTION', async () => {
    setup({ cancellation: {
      id: 'cancellation-id', paymentId: null as any, financialClassification: 'NO_FINANCIAL_ACTION',
      clientRefund: '0', fundedAmount: null as any, currency: 'KES',
    } });
    const service = new RefundProviderService(mocks.provider as any, stateService as any);
    expect(await service.initiateForCancellation('cancellation-id')).toBeNull();
    expect(mocks.provider.initiateRefund).not.toHaveBeenCalled();
  });

  it('reuses PROCESSING and never starts a second external refund', async () => {
    setup({ refund: {
      id: 'refund-id', cancellationId: 'cancellation-id', paymentId: 'payment-id', amount: '70',
      currency: 'KES', type: 'PARTIAL', status: 'PROCESSING', provider: 'FLUTTERWAVE',
      providerRef: 'provider-ref', idempotencyKey: 'refund:cancellation:cancellation-id',
    } });
    const service = new RefundProviderService(mocks.provider as any, stateService as any);
    const result = await service.initiateForCancellation('cancellation-id');
    expect(result?.status).toBe('PROCESSING');
    expect(mocks.provider.initiateRefund).not.toHaveBeenCalled();
  });

  it('reuses SUCCEEDED and UNKNOWN without another provider call', async () => {
    for (const status of ['SUCCEEDED', 'UNKNOWN'] as const) {
      setup({ refund: {
        id: 'refund-id', cancellationId: 'cancellation-id', paymentId: 'payment-id', amount: '70',
        currency: 'KES', type: 'PARTIAL', status, provider: 'FLUTTERWAVE',
        providerRef: 'provider-ref', idempotencyKey: 'refund:cancellation:cancellation-id',
      } });
      const service = new RefundProviderService(mocks.provider as any, stateService as any);
      const result = await service.initiateForCancellation('cancellation-id');
      expect(result?.status).toBe(status);
      expect(mocks.provider.initiateRefund).not.toHaveBeenCalled();
    }
  });

  it('blocks RELEASED payments before any provider call', async () => {
    setup({ payment: {
      id: 'payment-id', amount: '100', currency: 'KES', status: 'RELEASED', providerRef: 'payment-provider-ref',
    } });
    const service = new RefundProviderService(mocks.provider as any, stateService as any);
    await expect(service.initiateForCancellation('cancellation-id')).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.provider.initiateRefund).not.toHaveBeenCalled();
  });

  it('turns an uncertain provider exception into UNKNOWN and does not retry', async () => {
    const { getRefund } = setup();
    mocks.provider.initiateRefund.mockRejectedValue(new ServiceUnavailableException('timeout'));
    const service = new RefundProviderService(mocks.provider as any, stateService as any);
    await expect(service.initiateForCancellation('cancellation-id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(getRefund()?.status).toBe('UNKNOWN');
    expect(getRefund()?.uncertaintyReason).toContain('uncertain');
    await expect(service.initiateForCancellation('cancellation-id')).resolves.toMatchObject({ status: 'UNKNOWN' });
    expect(mocks.provider.initiateRefund).toHaveBeenCalledTimes(1);
  });
});
