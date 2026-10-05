import { describe, expect, it, vi } from 'vitest';
import { PaymentProviderEventService } from './payment-provider-event.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  eventFirst: vi.fn(),
  query: vi.fn(),
  paymentUpdate: vi.fn(),
  taskFirst: vi.fn(),
  taskUpdate: vi.fn(),
  ledgerCreate: vi.fn(),
  auditCreate: vi.fn(),
  eventCreate: vi.fn(),
  normalizeWebhook: vi.fn(),
  paymentColumns: {
    id: 'payment-id-column',
    taskId: 'payment-task-id-column',
    status: 'payment-status-column',
    amount: 'payment-amount-column',
    currency: 'payment-currency-column',
    provider: 'payment-provider-column',
    providerRef: 'payment-provider-ref-column',
  },
}));

vi.mock('../prisma/db.js', () => ({ db: { transaction: mocks.transaction } }));

vi.mock('./payment-provider.js', () => ({
  PAYMENT_PROVIDER: Symbol.for('PAYMENT_PROVIDER'),
}));

import { PaymentProviderEventService } from './payment-provider-event.service.js';

const event = {
  provider: 'test-provider',
  providerEventId: 'evt-1',
  type: 'FUNDING_SUCCEEDED' as const,
  paymentId: 'payment-id',
  providerRef: 'provider-payment-1',
  metadata: '{"source":"test"}',
};

const payment = {
  id: 'payment-id',
  taskId: 'task-id',
  status: 'PENDING',
  amount: '100.00',
  currency: 'USD',
  provider: 'test-provider',
  providerRef: 'provider-payment-1',
};

function setupTransaction() {
  mocks.transaction.mockImplementation(async (callback) => callback({
    sql: { public: { payment: { columns: mocks.paymentColumns } } },
    raw: {
      sql: vi.fn(() => ({
        returnsRow: vi.fn(() => ({ build: vi.fn(() => 'payment-lock-plan') })),
      })),
    },
    query: mocks.query,
    orm: {
      public: {
        PaymentProviderEvent: { where: vi.fn(() => ({ first: mocks.eventFirst })), create: mocks.eventCreate },
        Payment: { where: vi.fn(() => ({ first: mocks.eventFirst, update: mocks.paymentUpdate })) },
        Task: { where: vi.fn(() => ({ first: mocks.taskFirst, update: mocks.taskUpdate })) },
        LedgerEntry: { create: mocks.ledgerCreate },
        AuditLog: { create: mocks.auditCreate },
      },
    },
  }));
}

function makeService() {
  return new PaymentProviderEventService({
    initiateFunding: vi.fn(),
    normalizeWebhook: mocks.normalizeWebhook,
  });
}

describe('PaymentProviderEventService.processNormalizedEvent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupTransaction();
    mocks.eventFirst.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue([payment]);
    mocks.taskFirst.mockResolvedValue({ id: 'task-id', status: 'AWAITING_PAYMENT' });
    mocks.paymentUpdate.mockResolvedValue({ ...payment, status: 'FUNDED' });
    mocks.taskUpdate.mockResolvedValue({ id: 'task-id', status: 'FUNDED' });
    mocks.ledgerCreate.mockResolvedValue({ id: 'ledger-id' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    mocks.eventCreate.mockResolvedValue({ id: 'event-id' });
  });

  it('confirms funding with the existing PENDING to FUNDED transition', async () => {
    const result = await makeService().processNormalizedEvent(event);

    expect(result.paymentStatus).toBe('FUNDED');
    expect(result.taskStatus).toBe('FUNDED');
    expect(mocks.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'FUNDED',
      provider: 'test-provider',
      providerRef: 'provider-payment-1',
    }));
    expect(mocks.taskUpdate).toHaveBeenCalledWith({ status: 'FUNDED' });
  });

  it('creates one funding ledger entry on successful confirmation', async () => {
    await makeService().processNormalizedEvent(event);

    expect(mocks.ledgerCreate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'FUNDING',
      amount: '100.00',
      currency: 'USD',
      paymentId: 'payment-id',
    }));
  });

  it('returns duplicate without financial writes for an already recorded event', async () => {
    mocks.eventFirst.mockResolvedValueOnce({ id: 'event-id', paymentId: 'payment-id' });

    const result = await makeService().processNormalizedEvent(event);

    expect(result.status).toBe('DUPLICATE');
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it('does not allow a second event to fund a non-pending payment with a different terminal state', async () => {
    mocks.query.mockResolvedValueOnce([{ ...payment, status: 'FAILED' }]);

    await expect(makeService().processNormalizedEvent(event)).rejects.toThrow(
      'Payment cannot transition from FAILED',
    );
  });

  it('records failed provider events without funding the task', async () => {
    mocks.query.mockResolvedValueOnce([{ ...payment }]);

    const result = await makeService().processNormalizedEvent({
      ...event,
      type: 'FUNDING_FAILED',
    });

    expect(result.paymentStatus).toBe('FAILED');
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it('records cancelled provider events without funding the task', async () => {
    const result = await makeService().processNormalizedEvent({
      ...event,
      type: 'FUNDING_CANCELLED',
    });

    expect(result.paymentStatus).toBe('CANCELLED');
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
  });

  it('rejects a mismatched provider', async () => {
    await expect(makeService().processNormalizedEvent({
      ...event,
      provider: 'different-provider',
    })).rejects.toThrow('Payment provider does not match the event');
  });

  it('uses a payment row lock before changing financial state', async () => {
    await makeService().processNormalizedEvent(event);
    expect(mocks.query).toHaveBeenCalledWith('payment-lock-plan');
  });
});

describe('PaymentProviderEventService.processWebhook', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes raw provider input through the verification/normalisation boundary', async () => {
    const service = makeService();
    const normalized = { ...event };
    mocks.normalizeWebhook.mockResolvedValue(normalized);
    vi.spyOn(service, 'processNormalizedEvent').mockResolvedValue({ status: 'PROCESSED' } as never);

    await service.processWebhook({
      body: { example: true },
      headers: { 'x-provider-signature': 'signature' },
    });

    expect(mocks.normalizeWebhook).toHaveBeenCalledWith({
      body: { example: true },
      headers: { 'x-provider-signature': 'signature' },
    });
    expect(service.processNormalizedEvent).toHaveBeenCalledWith(normalized);
  });
});
