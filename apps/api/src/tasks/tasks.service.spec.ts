import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  categoryFirst: vi.fn(),
  taskCreate: vi.fn(),
  requirementCreate: vi.fn(),
  attachmentCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: {
      public: {
        Category: { where: vi.fn(() => ({ first: mocks.categoryFirst })) },
        Task: { create: mocks.taskCreate },
        TaskRequirement: { create: mocks.requirementCreate },
        TaskAttachment: { create: mocks.attachmentCreate },
      },
    },
  },
}));

import { TasksService } from './tasks.service.js';

const client = { userId: 'client-id', email: 'client@example.com', roles: ['CLIENT'] as const };
const dto = {
  categoryId: 'd5c0f2d4-5fc6-4e64-979d-106f9d79d1a0',
  title: 'Move a sofa',
  description: 'Move a sofa between apartments.',
  type: 'PHYSICAL' as const,
  duration: 'SHORT_TERM' as const,
  budgetMin: 50,
  budgetMax: 100,
  locationDescription: '123 Market Street',
};

describe('TasksService.createTask', () => {
  const service = new TasksService();

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.categoryFirst.mockResolvedValue({ id: dto.categoryId, active: true });
    mocks.taskCreate.mockResolvedValue({ id: 'task-id', ...dto });
    mocks.requirementCreate.mockResolvedValue({ id: 'requirement-id' });
    mocks.attachmentCreate.mockResolvedValue({ id: 'attachment-id' });
    mocks.transaction.mockImplementation(async (callback) => callback({ orm: { public: { Task: { create: mocks.taskCreate }, TaskRequirement: { create: mocks.requirementCreate }, TaskAttachment: { create: mocks.attachmentCreate } } } }));
  });

  it('creates a task for the authenticated client and persists metadata', async () => {
    await service.createTask(client, {
      ...dto,
      requirementItems: [{ name: 'Vehicle', value: 'Van' }],
      attachments: [{ fileUrl: 'https://example.test/sofa.jpg', fileName: 'sofa.jpg' }],
    });

    expect(mocks.taskCreate).toHaveBeenCalledWith(expect.objectContaining({
      clientId: client.userId,
      budgetMin: '50',
      budgetMax: '100',
    }));
    expect(mocks.requirementCreate).toHaveBeenCalledWith({
      taskId: 'task-id', name: 'Vehicle', value: 'Van',
    });
    expect(mocks.attachmentCreate).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-id' }));
  });

  it('rejects invalid budgets and incompatible task locations before writing', async () => {
    await expect(service.createTask(client, { ...dto, budgetMin: 101, budgetMax: 100 }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createTask(client, { ...dto, type: 'VIRTUAL', locationDescription: 'Office' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.taskCreate).not.toHaveBeenCalled();
  });

  it('rejects invalid types, durations, past deadlines, and missing physical locations', async () => {
    await expect(service.createTask(client, { ...dto, type: 'OTHER' as never })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createTask(client, { ...dto, duration: 'FOREVER' as never })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createTask(client, { ...dto, expectedCompletionAt: '2000-01-01T00:00:00.000Z' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createTask(client, { ...dto, locationDescription: undefined })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing or inactive categories', async () => {
    mocks.categoryFirst.mockResolvedValueOnce({ id: dto.categoryId, active: false });
    await expect(service.createTask(client, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.taskCreate).not.toHaveBeenCalled();
  });
});
