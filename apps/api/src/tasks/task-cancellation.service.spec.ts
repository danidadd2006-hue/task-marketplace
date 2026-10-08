import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCancellationService } from './task-cancellation.service.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  cancellationCreate: vi.fn(),
  taskUpdate: vi.fn(),
  contractUpdate: vi.fn(),
  auditCreate: vi.fn(),
  penaltyFirst: vi.fn(),
  penaltyCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({ db: { transaction: mocks.transaction, sql: { public: { task: { columns: { id: 'id', clientId: 'clientId', status: 'status', currency: 'currency' } }, contract: { columns: { id: 'id', taskId: 'taskId', workerId: 'workerId', status: 'status', agreedPrice: 'agreedPrice', hiredAt: 'hiredAt', agreedDurationDays: 'agreedDurationDays', extensionStartedAt: 'extensionStartedAt' } }, payment: { columns: { id: 'id', taskId: 'taskId', clientId: 'clientId', workerId: 'workerId', contractId: 'contractId', amount: 'amount', currency: 'currency', status: 'status' } } } }, raw: { sql: vi.fn(() => ({ returnsRow: vi.fn(() => ({ build: vi.fn((value) => value ?? 'FOR UPDATE') })) })) } } }));

const client = { userId: 'client-id', email: 'client@example.com', roles: ['CLIENT'] as const };
const worker = { userId: 'worker-id', email: 'worker@example.com', roles: ['WORKER'] as const };
const admin = { userId: 'admin-id', email: 'admin@example.com', roles: ['ADMIN'] as const };
const unrelatedWorker = { userId: 'other-worker', email: 'other@example.com', roles: ['WORKER'] as const };

const task = {
  id: 'task-id',
  clientId: 'client-id',
  status: 'FUNDED',
  currency: 'KES',
};

const contract = {
  id: 'contract-id',
  taskId: 'task-id',
  workerId: 'worker-id',
  status: 'ACTIVE',
  agreedPrice: '100',
  hiredAt: '2026-10-01T00:00:00.000Z',
  agreedDurationDays: 10,
  extensionStartedAt: null,
};

const fundedPayment = {
  id: 'payment-id',
  taskId: 'task-id',
  clientId: 'client-id',
  workerId: 'worker-id',
  contractId: 'contract-id',
  amount: '100',
  currency: 'KES',
  status: 'FUNDED',
};

const createdCancellation = {
  id: 'cancellation-id',
  cancellationAt: '2026-10-06T12:00:00.000Z',
  fundedAmount: '100',
  currency: 'KES',
  workerPercentage: '20',
  workerAmount: '20',
  cancellationFee: '10',
  clientRefund: '70',
  financialClassification: 'PARTIAL_REFUND',
};

function setup(taskOverride = task, payment: typeof fundedPayment | null = fundedPayment) {
  mocks.query.mockReset();
  mocks.cancellationCreate.mockReset();
  mocks.taskUpdate.mockReset();
  mocks.contractUpdate.mockReset();
  mocks.auditCreate.mockReset();
  mocks.penaltyFirst.mockReset();
  mocks.penaltyCreate.mockReset();
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      sql: {
        public: {
          task: { columns: { id: 'id', clientId: 'clientId', status: 'status', currency: 'currency' } },
          contract: {
            columns: {
              id: 'id', taskId: 'taskId', workerId: 'workerId', status: 'status',
              agreedPrice: 'agreedPrice', hiredAt: 'hiredAt',
              agreedDurationDays: 'agreedDurationDays', extensionStartedAt: 'extensionStartedAt',
            },
          },
          payment: {
            columns: {
              id: 'id', taskId: 'taskId', clientId: 'clientId', workerId: 'workerId',
              contractId: 'contractId', amount: 'amount', currency: 'currency', status: 'status',
            },
          },
        },
      },
      raw: {
        sql: vi.fn(() => ({
          returnsRow: vi.fn(() => ({ build: vi.fn((value) => value) })),
        })),
      },
      query: mocks.query,
      orm: {
        public: {
          Cancellation: { create: mocks.cancellationCreate },
          Task: { where: vi.fn(() => ({ update: mocks.taskUpdate })) },
          Contract: { where: vi.fn(() => ({ update: mocks.contractUpdate })) },
          AuditLog: { create: mocks.auditCreate },
          WorkerCancellationPenalty: {
            where: vi.fn(() => ({ orderBy: vi.fn(() => ({ first: mocks.penaltyFirst })) })),
            create: mocks.penaltyCreate,
          },
        },
      },
    }),
  );

  mocks.query
    .mockResolvedValueOnce([taskOverride])
    .mockResolvedValueOnce([contract])
    .mockResolvedValueOnce(payment ? [payment] : []);
  mocks.cancellationCreate.mockImplementation(async (input) => ({ id: 'cancellation-id', ...input }));
  mocks.taskUpdate.mockResolvedValue({ id: taskOverride.id, status: 'CANCELLED' });
  mocks.contractUpdate.mockResolvedValue({ id: contract.id, status: 'CANCELLED' });
  mocks.auditCreate.mockResolvedValue({});
  mocks.penaltyFirst.mockResolvedValue(null);
  mocks.penaltyCreate.mockImplementation(async (input) => ({
    id: 'penalty-id',
    ...input,
  }));
}

describe('TaskCancellationService', () => {
  const refundProviderService = {
    initiateForCancellation: vi.fn(),
  };
  const accountingService = {
    recordCancellationFeeInTransaction: vi.fn(),
  };
  const service = new TaskCancellationService(
    refundProviderService as any,
    accountingService as any,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    refundProviderService.initiateForCancellation.mockResolvedValue(null);
    accountingService.recordCancellationFeeInTransaction.mockResolvedValue({
      status: 'ACCOUNTED',
      ledgerEntryId: 'ledger-fee-id',
    });
    setup();
  });

  afterEach(() => vi.useRealTimers());

  it('allows the client to cancel their own eligible task', async () => {
    const result = await service.cancelTask(client, 'task-id');
    expect(result.cancellation.stage).toBe('FUNDED');
    expect(mocks.cancellationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.taskUpdate).toHaveBeenCalledWith({ status: 'CANCELLED' });
    expect(mocks.contractUpdate).toHaveBeenCalledWith({ status: 'CANCELLED' });
    expect(accountingService.recordCancellationFeeInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'cancellation-id',
    );
  });

  it('rejects an unrelated worker', async () => {
    await expect(service.cancelTask(unrelatedWorker, 'task-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.cancellationCreate).not.toHaveBeenCalled();
  });

  it('allows the selected worker and derives WORKER actor type from the relationship', async () => {
    const result = await service.cancelTask(worker, 'task-id');
    expect(result.cancellation.actorType).toBe('WORKER');
  });

  it('allows an ADMIN to cancel and derives ADMIN actor type from effective roles', async () => {
    const result = await service.cancelTask(admin, 'task-id');
    expect(result.cancellation.actorType).toBe('ADMIN');
  });

  it('rejects an unauthenticated actor', async () => {
    await expect(service.cancelTask(undefined as never, 'task-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects SUBMITTED before reading cancellation financial state', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'SUBMITTED' }]);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.cancellationCreate).not.toHaveBeenCalled();
  });

  it('rejects AWAITING_APPROVAL', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'AWAITING_APPROVAL' }]);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects COMPLETED', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'COMPLETED' }]);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an already-cancelled task deterministically', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'CANCELLED' }]);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.cancellationCreate).not.toHaveBeenCalled();
  });

  it('rejects an already released payment', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([task])
      .mockResolvedValueOnce([contract])
      .mockResolvedValueOnce([{ ...fundedPayment, status: 'RELEASED' }]);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it('calculates first-day full refund', async () => {
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    setup({ ...task, status: 'FUNDED' });
    const result = await service.cancelTask(client, 'task-id');
    expect(result.cancellation.workerPercentage).toBe('0');
    expect(result.cancellation.workerAmount).toBe('0');
    expect(result.cancellation.cancellationFee).toBe('0');
    expect(result.cancellation.clientRefund).toBe('100');
    expect(result.cancellation.category).toBe('PRE_WORK_FIRST_DAY');
  });

  it('charges only the 10% cancellation fee on a 3-day job after the first day', async () => {
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
    setup();
    const shortContract = { ...contract, agreedDurationDays: 3 };
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([task]).mockResolvedValueOnce([shortContract]).mockResolvedValueOnce([fundedPayment]);
    const result = await service.cancelTask(client, 'task-id');
    expect(result.cancellation.workerPercentage).toBe('0');
    expect(result.cancellation.workerAmount).toBe('0');
    expect(result.cancellation.cancellationFee).toBe('10');
    expect(result.cancellation.clientRefund).toBe('90');
  });

  it('calculates long-job allocation proportionally and preserves the total', async () => {
    const result = await service.cancelTask(client, 'task-id');
    const c = result.cancellation;
    expect(c.workerPercentage).toBe('22.5');
    expect(c.workerAmount).toBe('22.5');
    expect(c.cancellationFee).toBe('10');
    expect(c.clientRefund).toBe('67.5');
    expect(Number(c.workerAmount) + Number(c.cancellationFee) + Number(c.clientRefund)).toBe(100);
  });

  it('caps long-job worker allocation at 50%', async () => {
    vi.setSystemTime(new Date('2026-10-12T00:00:00.000Z'));
    setup();
    const result = await service.cancelTask(client, 'task-id');
    expect(result.cancellation.workerPercentage).toBe('50');
    expect(result.cancellation.workerAmount).toBe('50');
    expect(result.cancellation.cancellationFee).toBe('10');
    expect(result.cancellation.clientRefund).toBe('40');
  });

  it('refunds 90% to the client and sends 10% to the platform after an extension starts', async () => {
    setup();
    const extensionContract = { ...contract, extensionStartedAt: '2026-10-05T00:00:00.000Z' };
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([task]).mockResolvedValueOnce([extensionContract]).mockResolvedValueOnce([fundedPayment]);
    const result = await service.cancelTask(client, 'task-id');
    expect(result.cancellation.category).toBe('EXTENSION');
    expect(result.cancellation.workerPercentage).toBe('0');
    expect(result.cancellation.workerAmount).toBe('0');
    expect(result.cancellation.cancellationFee).toBe('10');
    expect(result.cancellation.clientRefund).toBe('90');
    expect(result.cancellation.calculationBasis).toBe('EXTENSION_90_PERCENT_REFUND');
  });

  it('requires an explicit refund choice for expiry', async () => {
    setup({ ...task, status: 'EXPIRED' });
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calculates expiry refund only when explicitly requested', async () => {
    setup({ ...task, status: 'EXPIRED' });
    const result = await service.cancelTask(client, 'task-id', { refundRequested: true });
    expect(result.cancellation.category).toBe('EXPIRY_REFUND');
    expect(result.cancellation.clientRefund).toBe('100');
  });

  it('records no financial action before funding', async () => {
    setup({ ...task, status: 'AWAITING_PAYMENT' }, { ...fundedPayment, status: 'PENDING' });
    const result = await service.cancelTask(client, 'task-id');
    expect(result.cancellation.financialClassification).toBe('NO_FINANCIAL_ACTION');
    expect(result.cancellation.workerAmount).toBe('0');
    expect(result.cancellation.cancellationFee).toBe('0');
    expect(result.cancellation.clientRefund).toBe('0');
    expect(result.refund).toBeNull();
  });

  it('fails safely when authoritative duration is missing', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([task])
      .mockResolvedValueOnce([{ ...contract, agreedDurationDays: null }])
      .mockResolvedValueOnce([fundedPayment]);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records the first worker cancellation as a warning with no ban', async () => {
    const result = await service.cancelTask(worker, 'task-id');
    expect(mocks.penaltyCreate).toHaveBeenCalledWith(expect.objectContaining({
      workerId: 'worker-id',
      sequenceNumber: 1,
      banDurationDays: 0,
      cancellationId: 'cancellation-id',
    }));
    expect(result.workerPenalty?.sequenceNumber).toBe(1);
    expect(result.workerPenalty?.banDurationDays).toBe(0);
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'WorkerCancellation',
      entityId: 'cancellation-id',
      details: expect.stringContaining('WARNING'),
    }));
  });

  it('gives a 3-day ban on the second worker cancellation within 30 days', async () => {
    mocks.penaltyFirst.mockResolvedValueOnce({
      sequenceNumber: 1,
      banDurationDays: 0,
      rollingPeriodAnchorAt: '2026-10-01T00:00:00.000Z',
      warningIssuedAt: '2026-10-01T00:00:00.000Z',
    });
    const result = await service.cancelTask(worker, 'task-id');
    expect(result.workerPenalty?.sequenceNumber).toBe(2);
    expect(result.workerPenalty?.banDurationDays).toBe(3);
    expect(mocks.penaltyCreate).toHaveBeenCalledWith(expect.objectContaining({
      sequenceNumber: 2,
      banDurationDays: 3,
    }));
  });

  it('gives a 5-day ban on the third worker cancellation within 30 days', async () => {
    mocks.penaltyFirst.mockResolvedValueOnce({
      sequenceNumber: 2,
      banDurationDays: 3,
      rollingPeriodAnchorAt: '2026-10-01T00:00:00.000Z',
      warningIssuedAt: '2026-10-01T00:00:00.000Z',
    });
    const result = await service.cancelTask(worker, 'task-id');
    expect(result.workerPenalty?.sequenceNumber).toBe(3);
    expect(result.workerPenalty?.banDurationDays).toBe(5);
  });

  it('gives a 7-day ban on the fourth and every later worker cancellation within 30 days', async () => {
    mocks.penaltyFirst.mockResolvedValueOnce({
      sequenceNumber: 3,
      banDurationDays: 5,
      rollingPeriodAnchorAt: '2026-10-01T00:00:00.000Z',
      warningIssuedAt: '2026-10-01T00:00:00.000Z',
    });
    const fourth = await service.cancelTask(worker, 'task-id');
    expect(fourth.workerPenalty?.sequenceNumber).toBe(4);
    expect(fourth.workerPenalty?.banDurationDays).toBe(7);

    setup();
    mocks.penaltyFirst.mockResolvedValueOnce({
      sequenceNumber: 4,
      banDurationDays: 7,
      rollingPeriodAnchorAt: '2026-10-01T00:00:00.000Z',
      warningIssuedAt: '2026-10-01T00:00:00.000Z',
    });
    const later = await service.cancelTask(worker, 'task-id');
    expect(later.workerPenalty?.sequenceNumber).toBe(4);
    expect(later.workerPenalty?.banDurationDays).toBe(7);
  });

  it('resets the worker cancellation sequence after one month without a cancellation', async () => {
    vi.setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
    mocks.penaltyFirst.mockResolvedValueOnce({
      sequenceNumber: 4,
      banDurationDays: 7,
      rollingPeriodAnchorAt: '2026-10-01T12:00:00.000Z',
      warningIssuedAt: '2026-10-01T12:00:00.000Z',
    });
    const result = await service.cancelTask(worker, 'task-id');
    expect(result.workerPenalty?.sequenceNumber).toBe(1);
    expect(result.workerPenalty?.banDurationDays).toBe(0);
  });

  it('does not create a worker penalty for client cancellation', async () => {
    await service.cancelTask(client, 'task-id');
    expect(mocks.penaltyCreate).not.toHaveBeenCalled();
  });

  it('creates the expected audit event', async () => {
    await service.cancelTask(client, 'task-id');
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'client-id',
      action: 'UPDATE',
      entityType: 'Cancellation',
      entityId: 'cancellation-id',
      details: expect.stringContaining('workerPercentage=22.5'),
    }));
  });

  it('uses row locks before the authoritative cancellation write', async () => {
    await service.cancelTask(client, 'task-id');
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it('does not create a cancellation when the task changes concurrently', async () => {
    mocks.taskUpdate.mockResolvedValueOnce(null);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['DRAFT', 'PUBLISHED', 'RECEIVING_APPLICATIONS'] as const)('allows pre-contract client cancellation in %s', async (status) => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([{ ...task, status }]).mockResolvedValueOnce([]);
    const result = await service.cancelTask(client, 'task-id');
    expect(result.cancellation.taskId).toBe('task-id');
    expect(result.cancellation.contractId).toBeNull();
    expect(result.cancellation.financialClassification).toBe('NO_FINANCIAL_ACTION');
    expect(result.refund).toBeNull();
    expect(mocks.cancellationCreate).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-id', contractId: null, paymentId: null, financialClassification: 'NO_FINANCIAL_ACTION' }));
    expect(mocks.contractUpdate).not.toHaveBeenCalled();
    expect(mocks.penaltyCreate).not.toHaveBeenCalled();
  });

  it('allows WORKER_SELECTED only when a matching contract exists', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'WORKER_SELECTED' }]).mockResolvedValueOnce([]);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.cancellationCreate).not.toHaveBeenCalled();
  });

  it.each(['AWAITING_PAYMENT', 'FUNDED', 'IN_PROGRESS'] as const)('persists both task and contract for %s', async (status) => {
    setup({ ...task, status });
    const result = await service.cancelTask(client, 'task-id');
    expect(result.cancellation.taskId).toBe('task-id');
    expect(result.cancellation.contractId).toBe('contract-id');
    expect(mocks.cancellationCreate).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-id', contractId: 'contract-id' }));
  });

  it('rejects a mismatched payment relationship', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'FUNDED' }]).mockResolvedValueOnce([contract]).mockResolvedValueOnce([{ ...fundedPayment, taskId: 'other-task' }]);
    await expect(service.cancelTask(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.cancellationCreate).not.toHaveBeenCalled();
  });

  it('supports expiry before worker selection without a contract', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([{ ...task, status: 'EXPIRED' }]).mockResolvedValueOnce([]);
    const result = await service.cancelTask(client, 'task-id', { refundRequested: true });
    expect(result.cancellation.contractId).toBeNull();
    expect(result.cancellation.financialClassification).toBe('NO_FINANCIAL_ACTION');
    expect(result.refund).toBeNull();
    expect(mocks.contractUpdate).not.toHaveBeenCalled();
  });

  it('supports expiry after worker selection with the existing contract', async () => {
    setup({ ...task, status: 'EXPIRED' });
    const result = await service.cancelTask(client, 'task-id', { refundRequested: true });
    expect(result.cancellation.contractId).toBe('contract-id');
    expect(result.cancellation.category).toBe('EXPIRY_REFUND');
    expect(result.cancellation.clientRefund).toBe('100');
    expect(mocks.contractUpdate).toHaveBeenCalled();
  });
});
