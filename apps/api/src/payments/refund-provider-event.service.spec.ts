import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefundProviderEventService } from './refund-provider-event.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  eventFirst: vi.fn(),
  eventQuery: vi.fn(),
  refundFirst: vi.fn(),
  refundAll: vi.fn(),
  paymentFirst: vi.fn(),
  auditCreate: vi.fn(),
  refundUpdate: vi.fn(),
  stateTransition: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    raw: {
      sql: vi.fn(() => ({
        returnsRow: vi.fn(() => ({
          build: vi.fn((plan) => plan ?? 'lock-plan'),
        })),
      })),
    },
    sql: {
      public: {
        refund: {
          columns: {
            id: 'refund-id',
            paymentId: 'refund-payment-id',
            cancellationId: 'refund-cancellation-id',
            amount: 'refund-amount',
            currency: 'refund-currency',
            status: 'refund-status',
            provider: 'refund-provider',
            providerRef: 'refund-provider-ref',
            reconciliationMetadata: 'refund-metadata',
          },
        },
        payment: {
          columns: {
            id: 'payment-id',
            provider: 'payment-provider',
            providerRef: 'payment-provider-ref',
            amount: 'payment-amount',
            currency: 'payment-currency',
            status: 'payment-status',
          },
        },
      },
    },
    orm: {
      public: {
        Refund: { where: vi.fn(() => ({ first: mocks.refundFirst })) },
      },
    },
  },
}));

const baseEvent = {
  provider: 'FLUTTERWAVE',
  providerEventId: 'refund-event-1',
  type: 'REFUND_SUCCEEDED' as const,
  providerRefundId: 'provider-refund-id',
  providerRef: 'provider-refund-ref',
  paymentProviderRef: 'payment-provider-ref',
  amount: '70',
  currency: 'KES',
  metadata: '{"providerRefundId":"provider-refund-id"}',
};

const refund = {
  id: 'refund-id',
  paymentId: 'payment-id',
  cancellationId: 'cancellation-id',
  amount: '70',
  currency: 'KES',
  status: 'UNKNOWN',
  provider: 'FLUTTERWAVE',
  providerRef: 'provider-refund-ref',
  reconciliationMetadata: '{"providerRefundId":"provider-refund-id"}',
};

const payment = {
  id: 'payment-id',
  provider: 'FLUTTERWAVE',
  providerRef: 'payment-provider-ref',
  amount: '100',
  currency: 'KES',
  status: 'FUNDED',
};

function setupTransaction() {
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      sql: {
        public: {
          refundProviderEvent: {
            columns: { id: 'event-id', refundId: 'event-refund-id' },
          },
        },
      },
      raw: {
        sql: vi.fn(() => ({
          returnsRow: vi.fn(() => ({
            build: vi.fn((plan) => plan ?? 'lock-plan'),
          })),
        })),
      },
      query: mocks.eventQuery,
      orm: {
        public: {
          RefundProviderEvent: {
            where: vi.fn(() => ({ first: mocks.eventFirst })),
          },
          Refund: {
            where: vi.fn(() => ({
              first: mocks.refundFirst,
              all: mocks.refundAll,
              update: mocks.refundUpdate,
            })),
          },
          Payment: {
            where: vi.fn(() => ({ first: mocks.paymentFirst })),
          },
          AuditLog: { create: mocks.auditCreate },
        },
      },
    }),
  );
}

function makeService() {
  return new RefundProviderEventService({
    transitionInTransaction: mocks.stateTransition,
  } as any);
}

beforeEach(() => {
  vi.resetAllMocks();
  setupTransaction();
  mocks.eventFirst.mockResolvedValue(undefined);
  mocks.refundFirst.mockResolvedValue(refund);
  mocks.refundAll.mockResolvedValue([]);
  mocks.paymentFirst.mockResolvedValue(payment);
  mocks.eventQuery
    .mockResolvedValueOnce([payment])
    .mockResolvedValueOnce([{ id: 'event-id', refundId: 'refund-id' }]);
  mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
  mocks.refundUpdate.mockResolvedValue({ id: 'refund-id' });
  mocks.stateTransition.mockImplementation(async (_id, status) => ({
    idempotent: false,
    status,
    paymentStatus: status === 'SUCCEEDED' ? 'REFUNDED' : 'FUNDED',
  }));
});

describe('RefundProviderEventService.processNormalizedEvent — Step 4.4H', () => {
  it('resolves UNKNOWN to SUCCEEDED and finalises through RefundStateService', async () => {
    const result = await makeService().processNormalizedEvent(baseEvent);

    expect(result).toMatchObject({
      status: 'PROCESSED',
      eventId: 'event-id',
      refundId: 'refund-id',
      refundStatus: 'SUCCEEDED',
      paymentStatus: 'REFUNDED',
    });
    expect(mocks.stateTransition).toHaveBeenCalledWith(
      'refund-id',
      'SUCCEEDED',
      expect.anything(),
      expect.objectContaining({
        provider: 'FLUTTERWAVE',
        providerRef: 'provider-refund-ref',
      }),
    );
    expect(mocks.refundUpdate).toHaveBeenCalledWith({
      reconciledAt: expect.any(String),
    });
  });

  it('resolves PROCESSING to FAILED without refunding the Payment', async () => {
    mocks.refundFirst.mockResolvedValue({ ...refund, status: 'PROCESSING' });

    const result = await makeService().processNormalizedEvent({
      ...baseEvent,
      type: 'REFUND_FAILED',
    });

    expect(result.refundStatus).toBe('FAILED');
    expect(mocks.stateTransition).toHaveBeenCalledWith(
      'refund-id',
      'FAILED',
      expect.anything(),
      expect.objectContaining({
        failureMessage: 'Provider reported refund failure',
      }),
    );
  });

  it('resolves PROCESSING to UNKNOWN without finalising the Payment', async () => {
    mocks.refundFirst.mockResolvedValue({ ...refund, status: 'PROCESSING' });

    const result = await makeService().processNormalizedEvent({
      ...baseEvent,
      type: 'REFUND_UNKNOWN',
    });

    expect(result.refundStatus).toBe('UNKNOWN');
    expect(mocks.stateTransition).toHaveBeenCalledWith(
      'refund-id',
      'UNKNOWN',
      expect.anything(),
      expect.objectContaining({
        uncertaintyReason: expect.any(String),
      }),
    );
  });

  it('returns a duplicate without repeating the transition or audit mutation', async () => {
    mocks.eventFirst.mockResolvedValue({
      id: 'existing-event',
      refundId: 'refund-id',
    });

    const result = await makeService().processNormalizedEvent(baseEvent);

    expect(result).toEqual({
      status: 'DUPLICATE',
      eventId: 'existing-event',
      refundId: 'refund-id',
      refundStatus: 'UNCHANGED',
    });
    expect(mocks.stateTransition).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('handles the unique-key race as a safe duplicate', async () => {
    mocks.eventQuery.mockReset()
      .mockResolvedValueOnce([payment])
      .mockResolvedValueOnce([]);
    mocks.eventFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 'raced-event', refundId: 'refund-id' });

    const result = await makeService().processNormalizedEvent(baseEvent);

    expect(result).toEqual({
      status: 'DUPLICATE',
      eventId: 'raced-event',
      refundId: 'refund-id',
      refundStatus: 'UNCHANGED',
    });
    expect(mocks.stateTransition).not.toHaveBeenCalled();
  });

  it('does not guess when payment-based correlation is ambiguous', async () => {
    mocks.refundFirst.mockResolvedValue(undefined);
    mocks.refundAll.mockResolvedValue([
      { ...refund, id: 'refund-a' },
      { ...refund, id: 'refund-b' },
    ]);

    const result = await makeService().processNormalizedEvent({
      ...baseEvent,
      providerRef: null,
      providerRefundId: null,
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.refundId).toBeNull();
    expect(mocks.stateTransition).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'RefundProviderEvent',
    }));
  });

  it('preserves a conflicting terminal event without moving the Refund backwards', async () => {
    mocks.refundFirst.mockResolvedValue({ ...refund, status: 'SUCCEEDED' });

    const result = await makeService().processNormalizedEvent({
      ...baseEvent,
      type: 'REFUND_FAILED',
    });

    expect(result.status).toBe('CONFLICTING_TERMINAL');
    expect(result.refundStatus).toBe('SUCCEEDED');
    expect(mocks.stateTransition).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining('CONFLICTING_TERMINAL_PROVIDER_EVENT'),
    }));
  });

  it('records a successful post-release event but never reverses the Payment', async () => {
    mocks.refundFirst.mockResolvedValue({ ...refund, status: 'PROCESSING' });
    mocks.eventQuery.mockReset()
      .mockResolvedValueOnce([{ ...payment, status: 'RELEASED' }])
      .mockResolvedValueOnce([{ id: 'event-id', refundId: 'refund-id' }]);

    const result = await makeService().processNormalizedEvent(baseEvent);

    expect(result.status).toBe('POST_RELEASE_CONFLICT');
    expect(result.paymentStatus).toBe('RELEASED');
    expect(mocks.stateTransition).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining('POST_RELEASE_REFUND_EVENT'),
    }));
  });
});

describe('RefundProviderEventService.reconcileRefund — Step 4.4H', () => {
  it('reconciles UNKNOWN through the provider lookup and existing state service', async () => {
    mocks.eventQuery.mockReset().mockResolvedValueOnce([refund]);
    const providerResult = vi.fn().mockResolvedValue({
      provider: 'FLUTTERWAVE',
      status: 'SUCCEEDED',
      providerRef: 'provider-ref',
      metadata: '{"providerRefundId":"provider-refund-id"}',
    });
    const service = makeService();
    const result = await service.reconcileRefund('refund-id', providerResult);

    expect(providerResult).toHaveBeenCalledWith(expect.objectContaining({
      refundId: 'refund-id',
      providerRef: 'provider-refund-ref',
      amount: '70',
      currency: 'KES',
    }));
    expect(result).toMatchObject({
      status: 'RECONCILED',
      refundId: 'refund-id',
      refundStatus: 'SUCCEEDED',
      paymentStatus: 'REFUNDED',
    });
  });

  it('does not perform another provider lookup for an already terminal refund', async () => {
    const terminal = { ...refund, status: 'FAILED' };
    const providerResult = vi.fn();
    mocks.refundFirst.mockResolvedValue(terminal);

    const result = await makeService().reconcileRefund('refund-id', providerResult);

    expect(result).toEqual({
      status: 'ALREADY_TERMINAL',
      refundId: 'refund-id',
      refundStatus: 'FAILED',
    });
    expect(providerResult).not.toHaveBeenCalled();
  });
});
