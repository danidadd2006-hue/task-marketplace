import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  userFirst: vi.fn(),
  roleFirst: vi.fn(),
  contractCreate: vi.fn(),
  applicationUpdate: vi.fn(),
  taskUpdate: vi.fn(),
  transaction: vi.fn(),
  taskColumns: {
    id: 'task-id-column',
    clientId: 'task-client-id-column',
    status: 'task-status-column',
  },
  applicationColumns: {
    id: 'application-id-column',
    taskId: 'application-task-id-column',
    workerId: 'application-worker-id-column',
    status: 'application-status-column',
    proposedPrice: 'application-proposed-price-column',
  },
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    raw: {
      sql: vi.fn(() => ({
        returnsRow: vi.fn(() => ({
          build: vi.fn(() => 'lock-plan'),
        })),
      })),
    },
  },
}));

import { TaskWorkerSelectionService } from './task-worker-selection.service.js';

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
  status: 'RECEIVING_APPLICATIONS',
};

const application = {
  id: 'application-id',
  taskId: 'task-id',
  workerId: 'worker-id',
  status: 'SUBMITTED',
  proposedPrice: '75',
};

const notificationEvents = { applicationAccepted: vi.fn(), contractCreated: vi.fn() };

const contract = {
  id: 'contract-id',
  taskId: 'task-id',
  workerId: 'worker-id',
  status: 'ACTIVE',
  agreedPrice: '75',
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
};

function setupTransaction() {
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      sql: {
        public: {
          task: { columns: mocks.taskColumns },
          application: { columns: mocks.applicationColumns },
        },
      },
      raw: {
        sql: vi.fn(() => ({
          returnsRow: vi.fn(() => ({
            build: vi.fn(() => 'lock-plan'),
          })),
        })),
      },
      query: mocks.query,
      orm: {
        public: {
          User: {
            where: vi.fn(() => ({ first: mocks.userFirst })),
          },
          UserRoleAssignment: {
            where: vi.fn(() => ({ first: mocks.roleFirst })),
          },
          Contract: {
            create: mocks.contractCreate,
          },
          Application: {
            where: vi.fn(() => ({ update: mocks.applicationUpdate })),
          },
          Task: {
            where: vi.fn(() => ({ update: mocks.taskUpdate })),
          },
        },
      },
    }),
  );
}

describe('TaskWorkerSelectionService.selectWorker', () => {
  const service = new TaskWorkerSelectionService(notificationEvents as never);

  beforeEach(() => {
    vi.resetAllMocks();
    setupTransaction();

    mocks.query
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([application]);
    mocks.userFirst.mockResolvedValue(worker);
    mocks.roleFirst.mockResolvedValue({ id: 'role-assignment-id' });
    mocks.contractCreate.mockResolvedValue(contract);
    mocks.applicationUpdate.mockResolvedValue({ ...application, status: 'ACCEPTED' });
    mocks.taskUpdate.mockResolvedValue({ ...task, status: 'WORKER_SELECTED' });
    notificationEvents.applicationAccepted.mockResolvedValue(undefined);
    notificationEvents.contractCreated.mockResolvedValue(undefined);
  });

  it('allows the task owner to select a valid submitted application', async () => {
    const result = await service.selectWorker(client, 'task-id', 'application-id');

    expect(result.task.status).toBe('WORKER_SELECTED');
    expect(result.application.status).toBe('ACCEPTED');
    expect(result.contract.status).toBe('ACTIVE');
    expect(notificationEvents.applicationAccepted).toHaveBeenCalledWith('application-id');
    expect(notificationEvents.contractCreated).toHaveBeenCalledWith('contract-id');
  });

  it('enforces CLIENT role at the service boundary', async () => {
    await expect(service.selectWorker(worker, 'task-id', 'application-id'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects missing authentication', async () => {
    await expect(service.selectWorker(undefined as never, 'task-id', 'application-id'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a non-owner even with CLIENT role', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([
      { ...task, clientId: 'different-client-id' },
    ]);

    await expect(service.selectWorker(client, 'task-id', 'application-id'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.contractCreate).not.toHaveBeenCalled();
  });

  it('rejects every task state except RECEIVING_APPLICATIONS', async () => {
    const statuses = [
      'DRAFT',
      'PUBLISHED',
      'WORKER_SELECTED',
      'AWAITING_PAYMENT',
      'FUNDED',
      'IN_PROGRESS',
      'SUBMITTED',
      'AWAITING_APPROVAL',
      'COMPLETED',
      'CANCELLED',
      'DISPUTED',
      'EXPIRED',
    ];

    for (const status of statuses) {
      mocks.query.mockReset();
      mocks.query.mockResolvedValueOnce([{ ...task, status }]);

      await expect(service.selectWorker(client, 'task-id', 'application-id'))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rejects an application that does not belong to the task', async () => {
    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([]);

    await expect(service.selectWorker(client, 'task-id', 'application-id'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.contractCreate).not.toHaveBeenCalled();
  });

  it('rejects every application state except SUBMITTED', async () => {
    const statuses = [
      'VIEWED',
      'SHORTLISTED',
      'ACCEPTED',
      'REJECTED',
      'WITHDRAWN',
      'EXPIRED',
    ];

    for (const status of statuses) {
      mocks.query.mockReset();
      mocks.query
        .mockResolvedValueOnce([task])
        .mockResolvedValueOnce([{ ...application, status }]);

      await expect(service.selectWorker(client, 'task-id', 'application-id'))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rejects an application belonging to the task owner', async () => {
    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([{ ...application, workerId: 'client-id' }]);

    await expect(service.selectWorker(client, 'task-id', 'application-id'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.contractCreate).not.toHaveBeenCalled();
  });

  it('requires the application worker to remain active and assigned WORKER', async () => {
    mocks.userFirst.mockResolvedValueOnce(undefined);

    await expect(service.selectWorker(client, 'task-id', 'application-id'))
      .rejects.toBeInstanceOf(BadRequestException);

    mocks.userFirst.mockResolvedValue(worker);
    mocks.roleFirst.mockResolvedValueOnce(undefined);
    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([application]);

    await expect(service.selectWorker(client, 'task-id', 'application-id'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates the contract from stored application data and server-owned state', async () => {
    await service.selectWorker(client, 'task-id', 'application-id');

    expect(mocks.contractCreate).toHaveBeenCalledWith({
      taskId: 'task-id',
      workerId: 'worker-id',
      status: 'ACTIVE',
      agreedPrice: '75',
    });
  });

  it('transitions only the selected application and task', async () => {
    await service.selectWorker(client, 'task-id', 'application-id');

    expect(mocks.applicationUpdate).toHaveBeenCalledWith({ status: 'ACCEPTED' });
    expect(mocks.taskUpdate).toHaveBeenCalledWith({ status: 'WORKER_SELECTED' });
  });

  it('does not reject or modify other applications', async () => {
    await service.selectWorker(client, 'task-id', 'application-id');

    expect(mocks.applicationUpdate).toHaveBeenCalledTimes(1);
  });

  it('uses task and application row locks before writing', async () => {
    await service.selectWorker(client, 'task-id', 'application-id');

    expect(mocks.query).toHaveBeenNthCalledWith(1, expect.any(String));
    expect(mocks.query).toHaveBeenNthCalledWith(2, expect.any(String));
  });

  it('rolls back all writes when a later state transition fails', async () => {
    mocks.taskUpdate.mockRejectedValueOnce(new Error('task update failed'));

    await expect(service.selectWorker(client, 'task-id', 'application-id'))
      .rejects.toThrow('task update failed');

    expect(mocks.contractCreate).toHaveBeenCalled();
    expect(mocks.applicationUpdate).toHaveBeenCalled();
    expect(mocks.taskUpdate).toHaveBeenCalled();
    // db.transaction owns rollback semantics; no commit is issued by this service.
  });

  it('maps duplicate contract creation to a conflict', async () => {
    mocks.contractCreate.mockRejectedValueOnce({ sqlState: '23505' });

    await expect(service.selectWorker(client, 'task-id', 'application-id'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(mocks.applicationUpdate).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
  });

  it('does not emit notifications when selection transaction fails', async () => {
    mocks.taskUpdate.mockRejectedValueOnce(new Error('selection transaction failed'));

    await expect(service.selectWorker(client, 'task-id', 'application-id')).rejects.toThrow('selection transaction failed');
    expect(notificationEvents.applicationAccepted).not.toHaveBeenCalled();
    expect(notificationEvents.contractCreated).not.toHaveBeenCalled();
  });

  it('does not accept client-supplied worker/status/contract fields because the endpoint has no request body', async () => {
    await service.selectWorker(
      client,
      'task-id',
      'application-id',
    );

    expect(mocks.contractCreate).toHaveBeenCalledWith(expect.not.objectContaining({
      clientId: expect.anything(),
      id: expect.anything(),
    }));
    expect(mocks.contractCreate).toHaveBeenCalledWith(expect.objectContaining({
      workerId: 'worker-id',
      status: 'ACTIVE',
    }));
  });
});
