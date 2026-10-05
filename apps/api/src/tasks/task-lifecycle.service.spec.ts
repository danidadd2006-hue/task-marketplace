import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  taskFirst: vi.fn(),
  taskUpdate: vi.fn(),
  categoryFirst: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        Task: { where: vi.fn(() => ({ first: mocks.taskFirst, update: mocks.taskUpdate })) },
        Category: { where: vi.fn(() => ({ first: mocks.categoryFirst })) },
      },
    },
    transaction: mocks.transaction,
  },
}));

import { TaskLifecycleService } from './task-lifecycle.service.js';

const client = {
  userId: 'client-id',
  email: 'client@example.com',
  roles: ['CLIENT'] as const,
};

const baseTask = {
  id: 'task-id',
  clientId: 'client-id',
  categoryId: 'category-id',
  title: 'Move a sofa',
  description: 'Move a sofa between apartments.',
  type: 'PHYSICAL',
  duration: 'SHORT_TERM',
  status: 'DRAFT',
};

describe('TaskLifecycleService', () => {
  const service = new TaskLifecycleService();

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.taskFirst.mockResolvedValue({ ...baseTask });
    mocks.categoryFirst.mockResolvedValue({ id: 'category-id', active: true });
    mocks.taskUpdate.mockResolvedValue({ ...baseTask, status: 'PUBLISHED' });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        orm: {
          public: {
            Task: { where: vi.fn(() => ({ update: mocks.taskUpdate })) },
          },
        },
      }),
    );
  });

  it('transitions DRAFT to PUBLISHED', async () => {
    await service.transition(client, 'task-id', 'PUBLISHED');

    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      status: 'PUBLISHED',
    });
  });

  it('transitions PUBLISHED to RECEIVING_APPLICATIONS', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'PUBLISHED' });
    mocks.taskUpdate.mockResolvedValue({ ...baseTask, status: 'RECEIVING_APPLICATIONS' });

    await service.transition(client, 'task-id', 'RECEIVING_APPLICATIONS');

    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      status: 'RECEIVING_APPLICATIONS',
    });
  });

  it('rejects invalid transitions', async () => {
    await expect(service.transition(client, 'task-id', 'FUNDED'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects repeated transitions', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, status: 'PUBLISHED' });

    await expect(service.transition(client, 'task-id', 'PUBLISHED'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-owner from transitioning another users task', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, clientId: 'other-client' });

    await expect(service.transition(client, 'task-id', 'PUBLISHED'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a missing task', async () => {
    mocks.taskFirst.mockResolvedValue(undefined);

    await expect(service.transition(client, 'missing-task', 'PUBLISHED'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires the effective CLIENT role', async () => {
    const worker = { ...client, roles: ['WORKER'] as const };

    await expect(service.transition(worker, 'task-id', 'PUBLISHED'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('uses the authenticated owner and stored status rather than client-supplied status or clientId', async () => {
    await service.transition(client, 'task-id', 'PUBLISHED');

    expect(mocks.taskFirst).toHaveBeenCalledWith();
    expect(mocks.taskUpdate).toHaveBeenCalledWith({ status: 'PUBLISHED' });
    expect(mocks.taskUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'attacker-id', status: 'COMPLETED' }),
    );
  });

  it('rejects publishing when the task is not eligible', async () => {
    mocks.taskFirst.mockResolvedValue({ ...baseTask, title: '' });

    await expect(service.transition(client, 'task-id', 'PUBLISHED'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('requires an active category for publishing', async () => {
    mocks.categoryFirst.mockResolvedValue({ id: 'category-id', active: false });

    await expect(service.transition(client, 'task-id', 'PUBLISHED'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
