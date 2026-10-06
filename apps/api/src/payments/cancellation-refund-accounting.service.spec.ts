import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CancellationRefundAccountingService } from './cancellation-refund-accounting.service.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  ledgerFirst: vi.fn(),
  ledgerCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    raw: {
      sql: vi.fn(() => ({
        returnsRow: vi.fn(() => ({
          build: vi.fn((value) => value ?? 'plan'),
        })),
      })),
    },
    sql: {
      public: {
        cancellation: { columns: {} },
        refund: { columns: {} },
        payment: { columns: {} },
      },
    },
  },
}));

function txFor({
  cancellation = baseCancellation,
  refund = baseRefund,
  payment = basePayment,
  ledger = undefined,
  queryResults = undefined,
}: {
  cancellation?: any;
  refund?: any;
  payment?: any;
  ledger?: any;
  queryResults?: any[];
} = {}) {
  mocks.ledgerFirst.mockResolvedValue(ledger);
  mocks.ledgerCreate.mockResolvedValue({
    id: 'ledger-new',
  });
  mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });

  let queryIndex = 0;
  const values = queryResults ?? [cancellation, payment];
  mocks.query.mockImplementation(async () => {
    const value = values[queryIndex++];
    return value === null || value === undefined ? [] : [value];
  });

  return {
    query: mocks.query,
    orm: {
      public: {
        LedgerEntry: {
          where: vi.fn(() => ({ first: mocks.ledgerFirst })),
          create: mocks.ledgerCreate,
        },
        Cancellation: {
          where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(cancellation) })),
        },
        AuditLog: { create: mocks.auditCreate },
      },
    },
  } as any;
}

const baseCancellation = {
  id: 'cancellation-id',
  taskId: 'task-id',
  paymentId: 'payment-id',
  cancellationFee: '10',
  clientRefund: '60',
  currency: 'KES',
  financialClassification: 'PARTIAL_REFUND',
};

const baseRefund = {
  id: 'refund-id',
  paymentId: 'payment-id',
  cancellationId: 'cancellation-id',
  amount: '60',
  currency: 'KES',
  status: 'SUCCEEDED',
};

const basePayment = {
  id: 'payment-id',
  taskId: 'task-id',
  clientId: 'client-id',
  amount: '100',
  currency: 'KES',
  status: 'REFUNDED',
};

beforeEach(() => vi.resetAllMocks());

describe('CancellationRefundAccountingService — Phase 4 Step 4.4I', () => {
  it('creates exactly one authoritative CANCELLATION_FEE entry from the cancellation record', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor();

    const result = await service.recordCancellationFeeInTransaction(tx, 'cancellation-id');

    expect(result.status).toBe('ACCOUNTED');
    expect(mocks.ledgerCreate).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'payment-id',
      taskId: 'task-id',
      type: 'CANCELLATION_FEE',
      amount: '10',
      currency: 'KES',
      reference: 'cancellation:cancellation-id:fee',
    }));
  });

  it('does not create a zero-value cancellation fee entry', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({
      cancellation: { ...baseCancellation, cancellationFee: '0', financialClassification: 'FULL_REFUND' },
    });

    const result = await service.recordCancellationFeeInTransaction(tx, 'cancellation-id');

    expect(result.status).toBe('NO_FEE');
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it('does not create entries for NO_FINANCIAL_ACTION cancellations', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({
      cancellation: {
        ...baseCancellation,
        paymentId: null,
        cancellationFee: '0',
        financialClassification: 'NO_FINANCIAL_ACTION',
      },
    });

    const result = await service.recordCancellationFeeInTransaction(tx, 'cancellation-id');

    expect(result.status).toBe('NO_ACTION');
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it('reuses an existing cancellation fee entry idempotently', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({ ledger: { id: 'existing-fee' } });

    const result = await service.recordCancellationFeeInTransaction(tx, 'cancellation-id');

    expect(result).toEqual({
      status: 'ALREADY_ACCOUNTED',
      ledgerEntryId: 'existing-fee',
    });
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it('rejects ordinary cancellation fee accounting for a RELEASED payment', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({ payment: { ...basePayment, status: 'RELEASED' } });

    await expect(
      service.recordCancellationFeeInTransaction(tx, 'cancellation-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates REFUND accounting only for SUCCEEDED refunds', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({ queryResults: [baseRefund, basePayment, baseCancellation] });

    const result = await service.recordRefundInTransaction(tx, 'refund-id');

    expect(result.status).toBe('ACCOUNTED');
    expect(mocks.ledgerCreate).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'payment-id',
      taskId: 'task-id',
      userId: 'client-id',
      type: 'REFUND',
      amount: '60',
      currency: 'KES',
      reference: 'refund:refund-id',
    }));
  });

  it.each(['PENDING', 'PROCESSING', 'FAILED', 'UNKNOWN'])(
    'creates no REFUND entry for %s',
    async (status) => {
      const service = new CancellationRefundAccountingService();
      const tx = txFor({ refund: { ...baseRefund, status }, queryResults: [{ ...baseRefund, status }, basePayment, baseCancellation] });

      const result = await service.recordRefundInTransaction(tx, 'refund-id');

      expect(result.status).toBe('NOT_ELIGIBLE');
      expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    },
  );

  it('reuses an existing refund ledger entry idempotently', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({ ledger: { id: 'existing-refund' }, queryResults: [baseRefund, basePayment, baseCancellation] });

    const result = await service.recordRefundInTransaction(tx, 'refund-id');

    expect(result).toEqual({
      status: 'ALREADY_ACCOUNTED',
      ledgerEntryId: 'existing-refund',
    });
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it('requires refund amount to equal the authoritative cancellation client refund', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({ refund: { ...baseRefund, amount: '59' }, queryResults: [{ ...baseRefund, amount: '59' }, basePayment, baseCancellation] });

    await expect(
      service.recordRefundInTransaction(tx, 'refund-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects refund accounting for a RELEASED payment', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({ payment: { ...basePayment, status: 'RELEASED' }, queryResults: [baseRefund, { ...basePayment, status: 'RELEASED' }, baseCancellation] });

    await expect(
      service.recordRefundInTransaction(tx, 'refund-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves the existing COMMISSION by only querying/creating the targeted accounting type', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({ queryResults: [baseRefund, basePayment, baseCancellation] });

    await service.recordRefundInTransaction(tx, 'refund-id');

    expect(mocks.ledgerCreate).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'COMMISSION',
    }));
  });

  it('writes an audit record containing the accounting source and amount', async () => {
    const service = new CancellationRefundAccountingService();
    const tx = txFor({ queryResults: [baseRefund, basePayment, baseCancellation] });

    await service.recordRefundInTransaction(tx, 'refund-id');

    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REFUND',
      entityType: 'LedgerEntry',
      entityId: 'ledger-new',
      details: expect.stringContaining('REFUND_ACCOUNTED'),
    }));
  });
});
