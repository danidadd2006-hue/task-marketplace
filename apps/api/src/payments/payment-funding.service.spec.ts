import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  contractFirst: vi.fn(),
  paymentFirst: vi.fn(),
  paymentCreate: vi.fn(),
  paymentUpdate: vi.fn(),
  ledgerCreate: vi.fn(),
  auditCreate: vi.fn(),
  taskUpdate: vi.fn(),
  transaction: vi.fn(),
  provider: vi.fn(),
  committedPaymentFirst: vi.fn(),
  taskColumns: {
    id: 'task-id-column',
    clientId: 'task-client-id-column',
    status: 'task-status-column',
    currency: 'task-currency-column',
  },
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: {
      public: {
        Payment: {
          where: vi.fn(() => ({ first: mocks.committedPaymentFirst })),
        },
      },
    },
  },
}));

vi.mock('./payment-provider.js', () => ({
  PAYMENT_PROVIDER: Symbol.for('PAYMENT_PROVIDER'),
}));

const client = {
  userId: 'client-id',
  email: 'client@example.com',
  roles: ['CLIENT'] as const,
};

const worker = {
  userId: 'worker-id',
  email: 'worker@example.com',
  roles: ['WORKER'] as const,
};

const task = {
  id: 'task-id',
  clientId: 'client-id',
  status: 'WORKER_SELECTED',
  currency: 'KES',
};

const contract = {
  id: 'contract-id',
  taskId: 'task-id',
  workerId: 'worker-id',
  status: 'ACTIVE',
  agreedPrice: '100',
};

const payment = {
  id: 'payment-id',
  taskId: 'task-id',
  clientId: 'client-id',
  workerId: 'worker-id',
  contractId: 'contract-id',
  amount: '100',
  currency: 'KES',
  status: 'PENDING',
  provider: null,
  providerRef: null,
  fundedAt: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
};

function setupTransaction() {
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      sql: { public: { task: { columns: mocks.taskColumns } } },
      raw: {
        sql: vi.fn(() => ({
          returnsRow: vi.fn(() => ({
            build: vi.fn(() => 'task-lock-plan'),
          })),
        })),
      },
      query: mocks.query,
      orm: {
        public: {
          Contract: {
            where: vi.fn(() => ({ first: mocks.contractFirst })),
          },
          Payment: {
            where: vi.fn(() => ({
              first: mocks.paymentFirst,
              update: mocks.paymentUpdate,
            })),
            create: mocks.paymentCreate,
          },
          LedgerEntry: { create: mocks.ledgerCreate },
          AuditLog: { create: mocks.auditCreate },
          Task: {
            where: vi.fn(() => ({ update: mocks.taskUpdate })),
          },
        },
      },
    }),
  );
}

function makeService() {
  return new PaymentFundingService({
    initiateFunding: mocks.provider,
    normalizeWebhook: vi.fn(),
  });
}

describe('PaymentFundingService.initiateFunding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupTransaction();
    mocks.query.mockResolvedValueOnce([task]);
    mocks.contractFirst.mockResolvedValue(contract);
    mocks.paymentFirst.mockResolvedValue(undefined);
    mocks.provider.mockResolvedValue({
      status: 'PENDING',
      provider: 'TEST_PROVIDER',
      providerRef: 'provider-ref',
      checkoutUrl: 'https://provider.example/checkout',
    });
    mocks.paymentCreate.mockResolvedValue(payment);
    mocks.paymentUpdate.mockResolvedValue({
      ...payment,
      provider: 'TEST_PROVIDER',
      providerRef: 'provider-ref',
    });
    mocks.committedPaymentFirst.mockResolvedValue({
      ...payment,
      provider: 'TEST_PROVIDER',
      providerRef: 'provider-ref',
    });
    mocks.ledgerCreate.mockResolvedValue({ id: 'ledger-id' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    mocks.taskUpdate.mockResolvedValue({ ...task, status: 'AWAITING_PAYMENT' });
  });

  it('creates the local Payment before calling the external provider', async () => {
    let transactionFinished = false;
    mocks.transaction.mockImplementationOnce(async (callback) => {
      const result = await callback({
        sql: { public: { task: { columns: mocks.taskColumns } } },
        raw: {
          sql: vi.fn(() => ({
            returnsRow: vi.fn(() => ({
              build: vi.fn(() => 'task-lock-plan'),
            })),
          })),
        },
        query: mocks.query,
        orm: {
          public: {
            Contract: { where: vi.fn(() => ({ first: mocks.contractFirst })) },
            Payment: {
              where: vi.fn(() => ({
                first: mocks.paymentFirst,
                update: mocks.paymentUpdate,
              })),
              create: mocks.paymentCreate,
            },
            LedgerEntry: { create: mocks.ledgerCreate },
            AuditLog: { create: mocks.auditCreate },
            Task: { where: vi.fn(() => ({ update: mocks.taskUpdate })) },
          },
        },
      });
      transactionFinished = true;
      return result;
    });
    mocks.provider.mockImplementationOnce(async () => {
      expect(transactionFinished).toBe(true);
      return {
        status: 'PENDING',
        provider: 'TEST_PROVIDER',
        providerRef: 'provider-ref',
        checkoutUrl: 'https://provider.example/checkout',
      };
    });

    const result = await makeService().initiateFunding(client, 'task-id');

    expect(result.payment.status).toBe('PENDING');
    expect(mocks.paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        amount: '100',
        currency: 'KES',
        status: 'PENDING',
      }),
    );
  });

  it('allows the authorised task owner to initiate funding', async () => {
    const result = await makeService().initiateFunding(client, 'task-id');

    expect(result.task.status).toBe('AWAITING_PAYMENT');
    expect(result.payment.provider).toBe('TEST_PROVIDER');
    expect(result.payment.checkoutUrl).toBe(
      'https://provider.example/checkout',
    );
  });

  it('requires an effective CLIENT role', async () => {
    await expect(
      makeService().initiateFunding(worker, 'task-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a missing authentication context', async () => {
    await expect(
      makeService().initiateFunding(undefined as never, 'task-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unrelated client before creating a payment', async () => {
    mocks.query.mockResolvedValueOnce([
      { ...task, clientId: 'different-client-id' },
    ]);

    await expect(
      makeService().initiateFunding(client, 'task-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it('rejects a missing contract', async () => {
    mocks.contractFirst.mockResolvedValueOnce(undefined);

    await expect(
      makeService().initiateFunding(client, 'task-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects task states outside WORKER_SELECTED and AWAITING_PAYMENT', async () => {
    for (const status of [
      'DRAFT',
      'PUBLISHED',
      'RECEIVING_APPLICATIONS',
      'FUNDED',
      'IN_PROGRESS',
      'SUBMITTED',
      'AWAITING_APPROVAL',
      'COMPLETED',
      'CANCELLED',
      'DISPUTED',
      'EXPIRED',
    ]) {
      mocks.query.mockReset();
      mocks.query.mockResolvedValueOnce([{ ...task, status }]);

      await expect(
        makeService().initiateFunding(client, 'task-id'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('retries an existing PENDING payment using the same local Payment identity', async () => {
    mocks.paymentFirst.mockResolvedValueOnce(payment);
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'AWAITING_PAYMENT' }]);

    const result = await makeService().initiateFunding(client, 'task-id');

    expect(mocks.paymentCreate).not.toHaveBeenCalled();
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'payment-id',
        amount: '100',
        currency: 'KES',
      }),
    );
    expect(result.payment.id).toBe('payment-id');
  });

  it('reopens FAILED/CANCELLED payments for a safe retry instead of permanently blocking /fund', async () => {
    mocks.paymentFirst.mockResolvedValueOnce({
      ...payment,
      status: 'FAILED',
    });
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'AWAITING_PAYMENT' }]);
    mocks.paymentUpdate.mockResolvedValueOnce({
      ...payment,
      status: 'PENDING',
      provider: null,
      providerRef: null,
    });

    const result = await makeService().initiateFunding(client, 'task-id');

    expect(mocks.paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING',
        provider: null,
        providerRef: null,
      }),
    );
    expect(result.payment.id).toBe('payment-id');
  });

  it('leaves the local payment retryable when provider initiation fails', async () => {
    mocks.provider.mockRejectedValueOnce(
      new ServiceUnavailableException('provider unavailable'),
    );

    await expect(
      makeService().initiateFunding(client, 'task-id'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(mocks.paymentCreate).toHaveBeenCalled();
    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      status: 'AWAITING_PAYMENT',
    });
  });

  it('does not call the provider if the local transaction rolls back', async () => {
    mocks.transaction.mockImplementationOnce(async () => {
      throw new Error('database rollback');
    });

    await expect(
      makeService().initiateFunding(client, 'task-id'),
    ).rejects.toThrow('database rollback');

    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('uses the authoritative contract amount and immutable task currency', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '100',
        currency: 'KES',
        contractId: 'contract-id',
      }),
    );
  });

  it('records the 10% commission once when the Payment intent is first created', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMISSION',
        amount: '10',
        currency: 'KES',
        reference: 'contract-id',
      }),
    );
  });

  it('uses a task row lock before financial writes', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.query).toHaveBeenCalledWith('task-lock-plan');
  });

  it('maps a database uniqueness race to a funding conflict', async () => {
    mocks.paymentCreate.mockRejectedValueOnce({ sqlState: '23505' });

    await expect(
      makeService().initiateFunding(client, 'task-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
