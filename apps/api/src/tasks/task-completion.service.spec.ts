import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contractFirst: vi.fn(),
  contractUpdate: vi.fn(),
  taskFirst: vi.fn(),
  taskUpdate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
  },
}));

import { TaskCompletionService } from './task-completion.service.js';

const worker = { userId: 'worker-id', email: 'worker@example.com', roles: ['WORKER'] as const };
const client = { userId: 'client-id', email: 'client@example.com', roles: ['CLIENT'] as const };

const activeContract = {
  id: 'contract-id',
  taskId: 'task-id',
  workerId: 'worker-id',
  status: 'ACTIVE',
};

const baseTask = {
  id: 'task-id',
  clientId: 'client-id',
  status: 'FUNDED',
};

describe('TaskCompletionService', () => {
  const service = new TaskCompletionService();

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.contractFirst.mockResolvedValue({ ...activeContract });
    mocks.taskFirst.mockResolvedValue({ ...baseTask });
    mocks.taskUpdate.mockResolvedValue({ ...baseTask, status: 'IN_PROGRESS' });
    mocks.contractUpdate.mockResolvedValue({ ...activeContract, status: 'COMPLETED' });
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        orm: {
          public: {
            Contract: {
              where: vi.fn(() => ({
                first: mocks.contractFirst,
                update: mocks.contractUpdate,
              })),
            },
            Task: {
              where: vi.fn(() => ({
                first: mocks.taskFirst,
                update: mocks.taskUpdate,
              })),
            },
            AuditLog: { create: mocks.auditCreate },
          },
        },
      }),
    );
  });

  it('allows the selected worker to start funded work', async () => {
    const result = await service.startWork(worker, 'task-id');

    expect(result.task.status).toBe('IN_PROGRESS');
    expect(mocks.taskUpdate).toHaveBeenCalledWith({ status: 'IN_PROGRESS' });
  });

  it('rejects a worker submission before work starts', async () => {
    await expect(service.submitCompletion(worker, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
  });

  it('allows the selected worker to submit completion from IN_PROGRESS', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'IN_PROGRESS' });

    const result = await service.submitCompletion(worker, 'task-id');

    expect(result.task.status).toBe('AWAITING_APPROVAL');
    expect(mocks.taskUpdate).toHaveBeenNthCalledWith(1, { status: 'SUBMITTED' });
    expect(mocks.taskUpdate).toHaveBeenNthCalledWith(2, { status: 'AWAITING_APPROVAL' });
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2);
  });

  it('rejects a client from starting or submitting work', async () => {
    await expect(service.startWork(client, 'task-id')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.submitCompletion(client, 'task-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unrelated worker', async () => {
    mocks.contractFirst.mockResolvedValue({ ...activeContract, workerId: 'other-worker' });

    await expect(service.startWork(worker, 'task-id')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.submitCompletion(worker, 'task-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a missing contract', async () => {
    mocks.contractFirst.mockResolvedValue(undefined);

    await expect(service.startWork(worker, 'task-id')).rejects.toThrow('Contract not found for this task');
  });

  it('rejects an inactive contract', async () => {
    mocks.contractFirst.mockResolvedValue({ ...activeContract, status: 'COMPLETED' });

    await expect(service.startWork(worker, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate start after IN_PROGRESS', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'IN_PROGRESS' });

    await expect(service.startWork(worker, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate completion after approval is requested', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'AWAITING_APPROVAL' });

    await expect(service.submitCompletion(worker, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the authenticated worker and stored task/contract state only', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'IN_PROGRESS' });

    await service.submitCompletion(worker, 'attacker-task-id');

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.taskUpdate).toHaveBeenNthCalledWith(1, { status: 'SUBMITTED' });
  });

  it('allows the owning client to approve an awaiting task', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'AWAITING_APPROVAL' });

    const result = await service.approveCompletion(client, 'task-id');

    expect(result.task.status).toBe('COMPLETED');
    expect(result.contract.status).toBe('COMPLETED');
    expect(mocks.taskUpdate).toHaveBeenCalledWith({ status: 'COMPLETED' });
    expect(mocks.contractUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED' }),
    );
  });

  it('rejects a worker from approving', async () => {
    await expect(service.approveCompletion(worker, 'task-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unrelated client from approving', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'AWAITING_APPROVAL', clientId: 'other-client' });

    await expect(service.approveCompletion(client, 'task-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects approval before submission', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'IN_PROGRESS' });

    await expect(service.approveCompletion(client, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.contractUpdate).not.toHaveBeenCalled();
  });

  it('rejects duplicate approval after completion', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'COMPLETED' });
    mocks.contractFirst.mockResolvedValue({ ...activeContract, status: 'COMPLETED' });

    await expect(service.approveCompletion(client, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
  });

  it('rejects approval when the contract is no longer active', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'AWAITING_APPROVAL' });
    mocks.contractFirst.mockResolvedValue({ ...activeContract, status: 'CANCELLED' });

    await expect(service.approveCompletion(client, 'task-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('completes task and contract in the same transaction', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'AWAITING_APPROVAL' });

    await service.approveCompletion(client, 'task-id');

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.taskUpdate).toHaveBeenCalledWith({ status: 'COMPLETED' });
    expect(mocks.contractUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'COMPLETED',
        completedAt: expect.any(String),
      }),
    );
  });

  it('does not contain or invoke a payment release path', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'AWAITING_APPROVAL' });

    await service.approveCompletion(client, 'task-id');

    expect(mocks.auditCreate).toHaveBeenCalledTimes(2);
    expect(mocks.auditCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'Payment' }),
    );
  });

  it('rolls back logically if contract completion fails after task update', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'AWAITING_APPROVAL' });
    mocks.contractUpdate.mockResolvedValue(undefined);

    await expect(service.approveCompletion(client, 'task-id')).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
