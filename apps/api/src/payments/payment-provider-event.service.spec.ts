import { describe, expect, it, vi } from 'vitest';
import { PaymentProviderEventService } from './payment-provider-event.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  eventFirst: vi.fn(),
  query: vi.fn(),
  paymentUpdate: vi.fn(),
  taskUpdate: vi.fn(),
  ledgerCreate: vi.fn(),
  auditCreate: vi.fn(),
  eventCreate: vi.fn(),
  normalizeWebhook: vi.fn(),
  paymentColumns: {
    id: 'payment-id-column',
    taskId: 'payment-task-id-column',
    contractId: 'payment-contract-id-column',
    status: 'payment-status-column',
    amount: 'payment-amount-column',
    currency: 'payment-currency-column',
    provider: 'payment-provider-column',
    providerRef: 'payment-provider-ref-column',
  },
  taskColumns: {
    id: 'task-id-column',
    status: 'task-status-column',
    currency: 'task-currency-column',
  },
  contractFirst: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({ db: { transaction: mocks.transaction } }));

vi.mock('./payment-provider.js', () => ({
  PAYMENT_PROVIDER: Symbol.for('PAYMENT_PROVIDER'),
}));

const event = {
  provider: 'test-provider',
  providerEventId: 'evt-1',
  type: 'FUNDING_SUCCEEDED' as const,
  paymentId: 'payment-id',
  providerRef: 'provider-payment-1',
  amount: '100.00',
  currency: 'USD',
  metadata: '{"source":"test","amount":"100.00","currency":"USD"}',
};

const payment = {
  id: 'payment-id',
  taskId: 'task-id',
  contractId: 'contract-id',
  status: 'PENDING',
  amount: '100.00',
  currency: 'USD',
  provider: 'test-provider',
  providerRef: 'provider-payment-1',
};

function setupTransaction() {
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      sql: {
        public: {
          payment: { columns: mocks.paymentColumns },
          task: { columns: mocks.taskColumns },
        },
      },
      raw: {
        sql: vi.fn(() => ({
          returnsRow: vi.fn(() => ({
            build: vi.fn((plan) => plan ?? 'lock-plan'),
          })),
        })),
      },
      query: mocks.query,
      orm: {
        public: {
          PaymentProviderEvent: {
            where: vi.fn(() => ({ first: mocks.eventFirst })),
            create: mocks.eventCreate,
          },
          Payment: {
            where: vi.fn(() => ({
              first: mocks.eventFirst,
              update: mocks.paymentUpdate,
            })),
          },
          Task: {
            where: vi.fn(() => ({ update: mocks.taskUpdate })),
          },
          Contract: {
            where: vi.fn(() => ({ first: mocks.contractFirst })),
          },
          LedgerEntry: { create: mocks.ledgerCreate },
          AuditLog: { create: mocks.auditCreate },
        },
      },
    }),
  );
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
    mocks.query
      .mockResolvedValueOnce([payment])
      .mockResolvedValueOnce([
        { id: 'task-id', status: 'AWAITING_PAYMENT', currency: 'USD' },
      ]);
    mocks.contractFirst.mockResolvedValue({
      id: 'contract-id',
      taskId: 'task-id',
      status: 'ACTIVE',
      agreedPrice: '100.00',
    });
    mocks.paymentUpdate.mockResolvedValue({ ...payment, status: 'FUNDED' });
    mocks.taskUpdate.mockResolvedValue({ id: 'task-id', status: 'FUNDED' });
    mocks.ledgerCreate.mockResolvedValue({ id: 'ledger-id' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    mocks.eventCreate.mockResolvedValue({ id: 'event-id' });
  });

  it('confirms funding with PENDING to FUNDED and preserves contract/currency', async () => {
    const result = await makeService().processNormalizedEvent(event);

    expect(result.paymentStatus).toBe('FUNDED');
    expect(result.taskStatus).toBe('FUNDED');
    expect(mocks.paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FUNDED',
        provider: 'test-provider',
        providerRef: 'provider-payment-1',
      }),
    );
    expect(mocks.ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FUNDING',
        amount: '100.00',
        currency: 'USD',
        paymentId: 'payment-id',
      }),
    );
  });

  it('returns a duplicate without financial writes for an already recorded event', async () => {
    mocks.eventFirst.mockResolvedValueOnce({
      id: 'event-id',
      paymentId: 'payment-id',
    });

    const result = await makeService().processNormalizedEvent(event);

    expect(result.status).toBe('DUPLICATE');
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
  });

  it('serializes concurrent deliveries by locking the payment and task rows', async () => {
    await makeService().processNormalizedEvent(event);

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0][0]).toBe('lock-plan');
    expect(mocks.query.mock.calls[1][0]).toBe('lock-plan');
  });

  it('rejects a second event that targets a terminal payment', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([
      { ...payment, status: 'FAILED' },
    ]);

    await expect(
      makeService().processNormalizedEvent(event),
    ).rejects.toThrow('Payment cannot transition from FAILED');
  });

  it('records failed provider events without funding the task', async () => {
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

  it('rejects provider/reference, amount, and currency mismatches', async () => {
    await expect(
      makeService().processNormalizedEvent({
        ...event,
        provider: 'different-provider',
      }),
    ).rejects.toThrow('Payment provider does not match the event');

    await expect(
      makeService().processNormalizedEvent({
        ...event,
        providerRef: 'different-reference',
      }),
    ).rejects.toThrow('Payment provider reference does not match the event');

    await expect(
      makeService().processNormalizedEvent({
        ...event,
        amount: '99.00',
      }),
    ).rejects.toThrow(
      'Provider transaction amount or currency does not match the payment',
    );

    await expect(
      makeService().processNormalizedEvent({
        ...event,
        currency: 'KES',
      }),
    ).rejects.toThrow(
      'Provider transaction amount or currency does not match the payment',
    );
  });

  it('does not fund when the task currency differs from the payment', async () => {
    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce([payment])
      .mockResolvedValueOnce([
        { id: 'task-id', status: 'AWAITING_PAYMENT', currency: 'KES' },
      ]);

    await expect(
      makeService().processNormalizedEvent(event),
    ).rejects.toThrow('Payment currency does not match the task currency');

    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it('does not fund when the contract amount no longer matches the payment', async () => {
    mocks.contractFirst.mockResolvedValueOnce({
      id: 'contract-id',
      taskId: 'task-id',
      status: 'ACTIVE',
      agreedPrice: '101.00',
    });

    await expect(
      makeService().processNormalizedEvent(event),
    ).rejects.toThrow('Payment amount does not match the contract amount');

    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });
});

describe('PaymentProviderEventService.processWebhook', () => {
  it('passes the raw body through the verification boundary before processing', async () => {
    setupTransaction();
    const service = makeService();
    const normalized = { ...event };
    mocks.normalizeWebhook.mockResolvedValue(normalized);
    vi.spyOn(service, 'processNormalizedEvent').mockResolvedValue({
      status: 'PROCESSED',
    } as never);

    await service.processWebhook({
      body: { example: true },
      headers: { 'x-provider-signature': 'signature' },
      rawBody: '{"example":true}',
    });

    expect(mocks.normalizeWebhook).toHaveBeenCalledWith({
      body: { example: true },
      headers: { 'x-provider-signature': 'signature' },
      rawBody: '{"example":true}',
    });
    expect(service.processNormalizedEvent).toHaveBeenCalledWith(normalized);
  });
});
