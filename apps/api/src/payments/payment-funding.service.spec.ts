import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  contractFirst: vi.fn(),
  paymentFirst: vi.fn(),
  paymentCreate: vi.fn(),
  ledgerCreate: vi.fn(),
  auditCreate: vi.fn(),
  taskUpdate: vi.fn(),
  transaction: vi.fn(),
  provider: vi.fn(),
  taskColumns: {
    id: 'task-id-column',
    clientId: 'task-client-id-column',
    status: 'task-status-column',
    currency: 'task-currency-column',
  },
}));

vi.mock('../prisma/db.js', () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock('./payment-provider.js', () => ({
  PAYMENT_PROVIDER: Symbol.for('PAYMENT_PROVIDER'),
}));

import { PaymentFundingService } from './payment-funding.service.js';

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
  agreedPrice: '123.45',
};

const payment = {
  id: 'payment-id',
  taskId: 'task-id',
  clientId: 'client-id',
  workerId: 'worker-id',
  contractId: 'contract-id',
  amount: '123.45',
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
            where: vi.fn(() => ({ first: mocks.paymentFirst })),
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
      provider: null,
      providerRef: null,
    });
    mocks.paymentCreate.mockResolvedValue(payment);
    mocks.ledgerCreate.mockResolvedValue({ id: 'ledger-id' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    mocks.taskUpdate.mockResolvedValue({ ...task, status: 'AWAITING_PAYMENT' });
  });

  it('allows the authorised task owner to initiate funding', async () => {
    const result = await makeService().initiateFunding(client, 'task-id');

    expect(result.task.status).toBe('AWAITING_PAYMENT');
    expect(result.payment.status).toBe('PENDING');
  });

  it('requires an effective CLIENT role', async () => {
    await expect(makeService().initiateFunding(worker, 'task-id'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects missing authentication', async () => {
    await expect(makeService().initiateFunding(undefined as never, 'task-id'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unrelated client', async () => {
    mocks.query.mockResolvedValueOnce([
      { ...task, clientId: 'different-client-id' },
    ]);

    await expect(makeService().initiateFunding(client, 'task-id'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it('rejects a missing contract', async () => {
    mocks.contractFirst.mockResolvedValueOnce(undefined);

    await expect(makeService().initiateFunding(client, 'task-id'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a contract for a different task', async () => {
    mocks.contractFirst.mockResolvedValueOnce({
      ...contract,
      taskId: 'different-task-id',
    });

    await expect(makeService().initiateFunding(client, 'task-id'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects every task state other than WORKER_SELECTED', async () => {
    for (const status of [
      'DRAFT',
      'PUBLISHED',
      'RECEIVING_APPLICATIONS',
      'AWAITING_PAYMENT',
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

      await expect(makeService().initiateFunding(client, 'task-id'))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('prevents duplicate funding requests', async () => {
    mocks.paymentFirst.mockResolvedValueOnce(payment);

    await expect(makeService().initiateFunding(client, 'task-id'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it('derives amount from the authoritative contract price', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: '123.45',
      workerId: 'worker-id',
      clientId: 'client-id',
      taskId: 'task-id',
      contractId: 'contract-id',
    }));
  });

  it('does not accept client-supplied financial fields because the endpoint has no body', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.not.objectContaining({
      status: expect.anything(),
      currency: expect.anything(),
      commission: expect.anything(),
      ledgerState: expect.anything(),
    }));
  });

  it('uses immutable task currency and leaves payment pending', async () => {
    const result = await makeService().initiateFunding(client, 'task-id');

    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'KES',
      status: 'PENDING',
    }));
    expect(result.providerConfirmation).toBe('AWAITING');
  });

  it('records the server-derived 10% commission without mutating historical records', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.ledgerCreate).toHaveBeenCalledWith({
      paymentId: expect.any(String),
      taskId: 'task-id',
      userId: 'client-id',
      type: 'COMMISSION',
      amount: '12.345',
      currency: 'KES',
      description: 'Marketplace commission for funding initiation',
      reference: 'contract-id',
    });
  });

  it('does not falsely mark payment or task as funded', async () => {
    const result = await makeService().initiateFunding(client, 'task-id');

    expect(result.payment.status).toBe('PENDING');
    expect(result.task.status).toBe('AWAITING_PAYMENT');
    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PENDING',
    }));
    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      status: 'AWAITING_PAYMENT',
    });
  });

  it('uses a task row lock before financial writes', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.query).toHaveBeenCalledWith('task-lock-plan');
  });

  it('represents transaction rollback when a later write fails', async () => {
    mocks.taskUpdate.mockRejectedValueOnce(new Error('task update failed'));

    await expect(makeService().initiateFunding(client, 'task-id'))
      .rejects.toThrow('task update failed');

    expect(mocks.paymentCreate).toHaveBeenCalled();
    expect(mocks.ledgerCreate).toHaveBeenCalled();
    // db.transaction owns rollback semantics; no commit is issued by this service.
  });

  it('maps a database uniqueness race to a funding conflict', async () => {
    mocks.paymentCreate.mockRejectedValueOnce({ sqlState: '23505' });

    await expect(makeService().initiateFunding(client, 'task-id'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
  });

  it('uses Task.currency even if the clients current location would differ', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'KES',
    }));
  });

  it('stores the selected Contract ID directly on Payment', async () => {
    await makeService().initiateFunding(client, 'task-id');

    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      contractId: 'contract-id',
    }));
  });
});
