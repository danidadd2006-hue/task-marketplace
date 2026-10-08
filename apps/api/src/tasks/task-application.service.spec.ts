import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  applicationFirst: vi.fn(),
  applicationCreate: vi.fn(),
  attachmentCreate: vi.fn(),
  applicationProjection: vi.fn(),
  workerPenaltyFirst: vi.fn(),
  transaction: vi.fn(),
  taskColumns: {
    id: 'task-id-column',
    clientId: 'task-client-id-column',
    status: 'task-status-column',
  },
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
  },
}));

import { TaskApplicationService } from './task-application.service.js';

const worker = {
  userId: 'worker-id',
  email: 'worker@example.com',
  roles: ['WORKER'] as const,
};

const clientWorker = {
  userId: 'dual-role-id',
  email: 'dual@example.com',
  roles: ['CLIENT', 'WORKER'] as const,
};

const dto = {
  proposedPrice: 75,
  estimatedCompletionAt: '2099-01-01T00:00:00.000Z',
  message: 'I can complete this carefully.',
  qualifications: 'Five years of relevant experience.',
  questions: 'Is parking available?',
  attachments: [
    {
      fileUrl: 'https://example.test/cv.pdf',
      fileName: 'cv.pdf',
      fileType: 'application/pdf',
      fileSize: 1234,
    },
  ],
};

const notificationEvents = { applicationCreated: vi.fn() };
const tokensService = {
  spendForApplicationInTransaction: vi.fn(),
};

const submittedApplication = {
  id: 'application-id',
  taskId: 'task-id',
  workerId: 'worker-id',
  proposedPrice: '75',
  estimatedCompletionAt: dto.estimatedCompletionAt,
  message: dto.message,
  qualifications: dto.qualifications,
  questions: dto.questions,
  status: 'SUBMITTED',
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
};

function setupTransaction() {
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      sql: {
        public: {
          task: {
            columns: mocks.taskColumns,
          },
        },
      },
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
          Application: {
            where: vi.fn(() => ({
              first: mocks.applicationFirst,
              select: vi.fn(() => ({
                include: vi.fn(() => ({
                  first: mocks.applicationProjection,
                })),
              })),
            })),
            create: mocks.applicationCreate,
          },
          ApplicationAttachment: {
            create: mocks.attachmentCreate,
          },
          WorkerCancellationPenalty: {
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                first: mocks.workerPenaltyFirst,
              })),
            })),
          },
        },
      },
    }),
  );
}

describe('TaskApplicationService.submitApplication', () => {
  const service = new TaskApplicationService(
    tokensService as never,
    notificationEvents as never,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    setupTransaction();
    mocks.query.mockResolvedValue([
      { id: 'task-id', clientId: 'client-id', status: 'PUBLISHED' },
    ]);
    mocks.applicationFirst.mockResolvedValue(undefined);
    mocks.applicationCreate.mockResolvedValue(submittedApplication);
    mocks.attachmentCreate.mockResolvedValue({ id: 'application-attachment-id' });
    mocks.applicationProjection.mockResolvedValue({
      ...submittedApplication,
      attachments: [{ id: 'application-attachment-id' }],
    });
    mocks.workerPenaltyFirst.mockResolvedValue(null);
    notificationEvents.applicationCreated.mockResolvedValue(undefined);
    tokensService.spendForApplicationInTransaction.mockResolvedValue({
      id: 'token-transaction-id',
    });
  });

  it('allows an authenticated WORKER to apply to a PUBLISHED task', async () => {
    const result = await service.submitApplication(worker, 'task-id', dto);

    expect(notificationEvents.applicationCreated).toHaveBeenCalledWith('application-id');

    expect(result.status).toBe('SUBMITTED');
    expect(tokensService.spendForApplicationInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'worker-id',
      'application-id',
    );
    expect(mocks.applicationCreate).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-id',
      workerId: 'worker-id',
      status: 'SUBMITTED',
    }));
    expect(mocks.attachmentCreate).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'application-id',
    }));
  });

  it('allows a WORKER on a RECEIVING_APPLICATIONS task', async () => {
    mocks.query.mockResolvedValue([
      { id: 'task-id', clientId: 'client-id', status: 'RECEIVING_APPLICATIONS' },
    ]);

    await expect(service.submitApplication(worker, 'task-id', dto)).resolves.toBeDefined();
  });

  it('rejects a CLIENT-only user', async () => {
    const client = { userId: 'client-id', email: 'client@example.com', roles: ['CLIENT'] as const };

    await expect(service.submitApplication(client, 'task-id', dto))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated/missing authenticated user at the service boundary', async () => {
    await expect(service.submitApplication(undefined as never, 'task-id', dto))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects the task owner even when the user also has WORKER role', async () => {
    mocks.query.mockResolvedValue([
      { id: 'task-id', clientId: 'dual-role-id', status: 'PUBLISHED' },
    ]);

    await expect(service.submitApplication(clientWorker, 'task-id', dto))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.applicationCreate).not.toHaveBeenCalled();
  });

  it('accepts PUBLISHED and RECEIVING_APPLICATIONS but rejects every other task state', async () => {
    const statuses = [
      'DRAFT',
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
      mocks.query.mockResolvedValue([{ id: 'task-id', clientId: 'client-id', status }]);
      await expect(service.submitApplication(worker, 'task-id', dto))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rejects a worker whose cancellation ban is still active', async () => {
    mocks.workerPenaltyFirst.mockResolvedValue({
      banEndsAt: '2099-01-01T00:00:00.000Z',
      sequenceNumber: 2,
      banDurationDays: 3,
    });

    await expect(service.submitApplication(worker, 'task-id', dto))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.applicationCreate).not.toHaveBeenCalled();
    expect(tokensService.spendForApplicationInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate before insert', async () => {
    mocks.applicationFirst.mockResolvedValue({ id: 'existing-application' });

    await expect(service.submitApplication(worker, 'task-id', dto))
      .rejects.toBeInstanceOf(ConflictException);
    expect(mocks.applicationCreate).not.toHaveBeenCalled();
  });

  it('maps the database unique constraint to a conflict for concurrent duplicate submissions', async () => {
    mocks.applicationCreate.mockRejectedValue({ sqlState: '23505' });

    await expect(service.submitApplication(worker, 'task-id', dto))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('uses only authenticated identity and ignores request ownership/status fields', async () => {
    const hostileDto = {
      ...dto,
      workerId: 'attacker-worker',
      userId: 'attacker-user',
      clientId: 'attacker-client',
      status: 'ACCEPTED',
      id: 'attacker-application',
      createdAt: '2099-01-01T00:00:00.000Z',
    };

    await service.submitApplication(worker, 'task-id', hostileDto as never);

    expect(mocks.applicationCreate).toHaveBeenCalledWith(expect.objectContaining({
      workerId: 'worker-id',
      status: 'SUBMITTED',
    }));
    expect(mocks.applicationCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: 'attacker-worker',
        status: 'ACCEPTED',
        id: 'attacker-application',
      }),
    );
  });

  it('represents concurrent task-state safety by locking the task row before checking eligibility', async () => {
    await service.submitApplication(worker, 'task-id', dto);

    expect(mocks.query).toHaveBeenCalledWith('task-lock-plan');
  });

  it('does not emit a notification when the authoritative application transaction fails', async () => {
    mocks.applicationCreate.mockRejectedValue(new Error('transaction failed'));

    await expect(service.submitApplication(worker, 'task-id', dto)).rejects.toThrow('transaction failed');
    expect(notificationEvents.applicationCreated).not.toHaveBeenCalled();
  });

  it('rejects a missing task', async () => {
    mocks.query.mockResolvedValue([]);

    await expect(service.submitApplication(worker, 'missing-task', dto))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not create attachments when application creation fails', async () => {
    mocks.applicationCreate.mockRejectedValue(new Error('write failed'));

    await expect(service.submitApplication(worker, 'task-id', dto)).rejects.toThrow('write failed');
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
  });

  it('validates the application deadline before opening a transaction', async () => {
    await expect(service.submitApplication(worker, 'task-id', {
      ...dto,
      estimatedCompletionAt: '2000-01-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
