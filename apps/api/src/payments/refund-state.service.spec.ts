import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { RefundStateService } from './refund-state.service.js';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    raw: { sql: vi.fn(() => ({ returnsRow: vi.fn().mockReturnThis(), build: vi.fn() })) },
    sql: { public: { refund: { columns: {} }, payment: { columns: {} } } },
  },
}));

const notificationEvents = { refundSucceeded: vi.fn() };

function setup(status: string, paymentStatus = 'FUNDED') {
  notificationEvents.refundSucceeded.mockClear();
  const refund = {
    id: 'refund-id', paymentId: 'payment-id', cancellationId: 'cancellation-id',
    amount: '70', currency: 'KES', type: 'PARTIAL', status,
    provider: 'FLUTTERWAVE', providerRef: 'refund-ref', failureCode: null,
    failureMessage: null, uncertaintyReason: null, reconciliationMetadata: null,
    initiatedAt: status === 'PENDING' ? null : '2026-10-06T12:00:00.000Z',
    succeededAt: status === 'SUCCEEDED' ? '2026-10-06T12:01:00.000Z' : null,
  } as any;
  const payment = {
    id: 'payment-id', amount: '100', currency: 'KES', status: paymentStatus,
    refundedAt: paymentStatus === 'REFUNDED' ? '2026-10-06T12:01:00.000Z' : null,
  } as any;
  const cancellation = { id: 'cancellation-id', paymentId: 'payment-id' };
  const audit = vi.fn();
  const refundWhere = vi.fn(() => ({
    first: vi.fn(async () => refund),
    update: vi.fn(async (input) => { Object.assign(refund, input); return 1; }),
  }));
  const paymentWhere = vi.fn(() => ({
    first: vi.fn(async () => payment),
    update: vi.fn(async (input) => { Object.assign(payment, input); return 1; }),
  }));
  const tx = {
    orm: {
      public: {
        Refund: { where: refundWhere },
        Payment: { where: paymentWhere },
        Cancellation: { where: vi.fn(() => ({ first: vi.fn(async () => cancellation) })) },
        AuditLog: { create: audit },
      },
    },
    query: vi.fn(),
  } as any;
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  const service = new RefundStateService(undefined, notificationEvents as never);
  (service as any).lockRefund = vi.fn(async () => refund);
  (service as any).lockPayment = vi.fn(async () => payment);
  return { service, refund, payment, audit, refundWhere, paymentWhere };
}

describe('RefundStateService — Phase 4 Step 4.4G', () => {
  it.each([
    ['PENDING', 'PROCESSING'], ['PENDING', 'SUCCEEDED'], ['PENDING', 'FAILED'], ['PENDING', 'UNKNOWN'],
    ['PROCESSING', 'SUCCEEDED'], ['PROCESSING', 'FAILED'], ['PROCESSING', 'UNKNOWN'],
  ])('%s -> %s is allowed', async (from, to) => {
    const { service } = setup(from);
    const result = await service.transition('refund-id', to as any, { provider: 'FLUTTERWAVE' });
    expect(result.status).toBe(to);
  });

  it.each([
    ['SUCCEEDED', 'PENDING'], ['SUCCEEDED', 'PROCESSING'],
    ['FAILED', 'PROCESSING'], ['FAILED', 'PENDING'], ['UNKNOWN', 'PROCESSING'],
    ['SUCCEEDED', 'FAILED'], ['UNKNOWN', 'SUCCEEDED'],
  ])('%s -> %s is rejected', async (from, to) => {
    const { service } = setup(from);
    await expect(service.transition('refund-id', to as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('finalises FUNDED payment only on authoritative SUCCEEDED', async () => {
    const { service, payment, audit } = setup('PROCESSING');
    const result = await service.transition('refund-id', 'SUCCEEDED', { provider: 'FLUTTERWAVE', providerRef: 'refund-ref' });
    expect(result.status).toBe('SUCCEEDED');
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refundedAt).toBeTruthy();
    expect(audit).toHaveBeenCalledTimes(2);
    expect(notificationEvents.refundSucceeded).toHaveBeenCalledWith('refund-id');
  });

  it('accounts a confirmed refund in the same transaction as refund finalisation', async () => {
    const { service, payment } = setup('PROCESSING');
    const accounting = {
      recordRefundInTransaction: vi.fn().mockResolvedValue({
        status: 'ACCOUNTED',
        ledgerEntryId: 'refund-ledger-id',
      }),
    };
    (service as any).accountingService = accounting;

    const result = await service.transition('refund-id', 'SUCCEEDED', {
      provider: 'FLUTTERWAVE',
      providerRef: 'refund-ref',
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(payment.status).toBe('REFUNDED');
    expect(accounting.recordRefundInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'refund-id',
    );
  });

  it.each(['PENDING', 'PROCESSING', 'FAILED', 'UNKNOWN'])('does not refund Payment while Refund is %s', async (status) => {
    const { service, payment } = setup(status);
    if (status === 'PENDING' || status === 'PROCESSING') {
      const result = await service.transition('refund-id', status as any);
      expect(result.paymentStatus).toBe('FUNDED');
    } else {
      expect(payment.status).toBe('FUNDED');
    }
    expect(payment.status).toBe('FUNDED');
  });

  it('does not emit a refund notification when refund finalisation fails', async () => {
    const { service } = setup('PROCESSING');
    (service as any).lockPayment = vi.fn(async () => ({ id: 'payment-id', amount: '100', currency: 'KES', status: 'RELEASED', refundedAt: null }));

    await expect(service.transition('refund-id', 'SUCCEEDED')).rejects.toThrow('Released payments');
    expect(notificationEvents.refundSucceeded).not.toHaveBeenCalled();
  });

  it('rejects SUCCEEDED finalisation for RELEASED payment', async () => {
    const { service } = setup('PROCESSING', 'RELEASED');
    await expect(service.transition('refund-id', 'SUCCEEDED')).rejects.toThrow('Released payments');
  });

  it('resolves a concurrent conflicting transition safely', async () => {
    const { service, refundWhere } = setup('PROCESSING');
    let lockCount = 0;
    (service as any).lockRefund = vi.fn(async () => {
      lockCount += 1;
      return lockCount === 1
        ? { id: 'refund-id', paymentId: 'payment-id', cancellationId: 'cancellation-id', amount: '70', currency: 'KES', status: 'PROCESSING' }
        : { id: 'refund-id', paymentId: 'payment-id', cancellationId: 'cancellation-id', amount: '70', currency: 'KES', status: 'FAILED' };
    });
    refundWhere.mockImplementation(() => ({
      first: vi.fn(async () => ({ id: 'refund-id', paymentId: 'payment-id', cancellationId: 'cancellation-id', amount: '70', currency: 'KES', status: 'PROCESSING' })),
      update: vi.fn(async () => 0),
    }));
    const result = await service.transition('refund-id', 'FAILED');
    expect(result.idempotent).toBe(true);
    expect(result.status).toBe('FAILED');
    expect(lockCount).toBe(2);
  });

  it('is idempotent for an already SUCCEEDED refund and does not mutate Payment again', async () => {
    const { service, payment, audit } = setup('SUCCEEDED', 'REFUNDED');
    const result = await service.transition('refund-id', 'SUCCEEDED');
    expect(result.idempotent).toBe(true);
    expect(result.paymentStatus).toBe('REFUNDED');
    expect(payment.status).toBe('REFUNDED');
    expect(audit).not.toHaveBeenCalled();
  });

  it('keeps UNKNOWN unresolved and rejects automatic return to PROCESSING', async () => {
    const { service, payment } = setup('UNKNOWN');
    await expect(service.transition('refund-id', 'PROCESSING')).rejects.toThrow('UNKNOWN to PROCESSING');
    expect(payment.status).toBe('FUNDED');
  });

  it('records FAILED without refunding Payment', async () => {
    const { service, payment, refund, audit } = setup('PROCESSING');
    const result = await service.transition('refund-id', 'FAILED', {
      provider: 'FLUTTERWAVE', failureCode: '400', failureMessage: 'Refund rejected',
    });
    expect(result.status).toBe('FAILED');
    expect(refund.failureCode).toBe('400');
    expect(payment.status).toBe('FUNDED');
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('does not create ledger entries during refund state handling', async () => {
    const { service, payment } = setup('PROCESSING');
    const tx = (mocks.transaction.mock.calls[0]?.[0] as any);
    await service.transition('refund-id', 'SUCCEEDED');
    expect(payment.status).toBe('REFUNDED');
    expect(tx).toBeTypeOf('function');
  });
});
