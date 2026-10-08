import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  select: vi.fn(),
  include: vi.fn(),
  first: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        Task: {
          where: mocks.where,
        },
      },
    },
  },
}));

import { NotFoundException } from '@nestjs/common';
import { PublicTaskDetailsService } from './public-task-details.service.js';

const queryChain = () => ({
  where: mocks.where,
  select: mocks.select,
  include: mocks.include,
  first: mocks.first,
});

describe('PublicTaskDetailsService', () => {
  const service = new PublicTaskDetailsService();

  beforeEach(() => {
    vi.resetAllMocks();

    const chain = queryChain();
    mocks.where.mockReturnValue(chain);
    mocks.select.mockReturnValue(chain);
    mocks.include.mockReturnValue(chain);
    mocks.first.mockResolvedValue(null);
  });

  it('loads only publicly visible tasks', async () => {
    mocks.first.mockResolvedValue({
      id: 'task-id',
      title: 'Move a sofa',
      status: 'PUBLISHED',
      category: { id: 'category-id', name: 'Moving' },
      requirementsList: [],
      attachments: [],
    });

    const result = await service.getTaskDetails('task-id');

    const statusPredicate = mocks.where.mock.calls[0]?.[0];
    expect(statusPredicate).toEqual(expect.any(Function));

    const statusField = { in: vi.fn() };
    statusPredicate(statusField);
    expect(statusField.in).toHaveBeenCalledWith([
      'PUBLISHED',
      'RECEIVING_APPLICATIONS',
    ]);

    expect(mocks.where).toHaveBeenCalledWith({ id: 'task-id' });
    expect(result.id).toBe('task-id');
  });

  it('returns the detail projection without ownership or exact location', async () => {
    const publicTask = {
      id: 'task-id',
      title: 'Move a sofa',
      description: 'Move a sofa',
      type: 'PHYSICAL',
      duration: 'SHORT_TERM',
      status: 'PUBLISHED',
      budgetMin: '50',
      budgetMax: '100',
      expectedCompletionAt: null,
      requirements: 'Bring a suitable vehicle',
      createdAt: '2026-10-05T10:00:00.000Z',
      updatedAt: '2026-10-05T10:00:00.000Z',
      category: { id: 'category-id', name: 'Moving' },
      requirementsList: [
        {
          id: 'requirement-id',
          taskId: 'task-id',
          name: 'Vehicle',
          value: 'Van',
          createdAt: '2026-10-05T10:00:00.000Z',
          updatedAt: '2026-10-05T10:00:00.000Z',
        },
      ],
      attachments: [
        {
          id: 'attachment-id',
          taskId: 'task-id',
          fileName: 'sofa.jpg',
          fileType: 'image/jpeg',
          fileSize: 1234,
          createdAt: '2026-10-05T10:00:00.000Z',
          updatedAt: '2026-10-05T10:00:00.000Z',
        },
      ],
    };

    mocks.first.mockResolvedValue(publicTask);

    const result = await service.getTaskDetails('task-id');

    expect(mocks.select).toHaveBeenCalledWith(
      'id',
      'title',
      'description',
      'type',
      'duration',
      'status',
      'budgetMin',
      'budgetMax',
      'expectedCompletionAt',
      'requirements',
      'createdAt',
      'updatedAt',
    );
    expect(mocks.include).toHaveBeenCalledTimes(3);
    expect(result).toEqual(publicTask);
    expect(result).not.toHaveProperty('clientId');
    expect(result).not.toHaveProperty('locationDescription');
    expect(result.attachments[0]).not.toHaveProperty('fileUrl');
  });

  it('does not reveal private or nonexistent tasks', async () => {
    await expect(service.getTaskDetails('private-or-missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const statusPredicate = mocks.where.mock.calls[0]?.[0];
    const statusField = { in: vi.fn() };
    statusPredicate(statusField);

    expect(statusField.in).toHaveBeenCalledWith([
      'PUBLISHED',
      'RECEIVING_APPLICATIONS',
    ]);
  });
});
