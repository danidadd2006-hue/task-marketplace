import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  select: vi.fn(),
  include: vi.fn(),
  orderBy: vi.fn(),
  offset: vi.fn(),
  limit: vi.fn(),
  all: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { Application: { where: mocks.where } } } },
}));

import { WorkerApplicationHistoryService } from './worker-application-history.service.js';

const worker = {
  userId: 'authenticated-worker',
  email: 'worker@example.com',
  roles: ['WORKER'] as const,
};

describe('WorkerApplicationHistoryService', () => {
  const service = new WorkerApplicationHistoryService();

  beforeEach(() => {
    vi.resetAllMocks();
    const chain = {
      select: mocks.select,
      include: mocks.include,
      orderBy: mocks.orderBy,
      offset: mocks.offset,
      limit: mocks.limit,
      all: mocks.all,
    };
    mocks.where.mockReturnValue(chain);
    mocks.select.mockReturnValue(chain);
    mocks.include.mockReturnValue(chain);
    mocks.orderBy.mockReturnValue(chain);
    mocks.offset.mockReturnValue(chain);
    mocks.limit.mockReturnValue(chain);
    mocks.all.mockResolvedValue([]);
  });

  it('filters by the authenticated worker, selects only application/task-safe fields, and paginates deterministically', async () => {
    // The database applies offset(1) before returning this page and its look-ahead row.
    mocks.all.mockResolvedValue([
      { id: 'older' },
      { id: 'lookahead' },
    ]);

    const result = await service.listOwnApplications(worker, { page: 2, pageSize: 1 });

    expect(mocks.where).toHaveBeenCalledWith({ workerId: 'authenticated-worker' });
    expect(mocks.select).toHaveBeenCalledWith(
      'id', 'taskId', 'proposedPrice', 'estimatedCompletionAt',
      'message', 'qualifications', 'questions', 'status', 'createdAt', 'updatedAt',
    );
    expect(mocks.include).toHaveBeenCalledWith('task', expect.any(Function));
    expect(mocks.include).toHaveBeenCalledWith('attachments', expect.any(Function));
    expect(mocks.orderBy).toHaveBeenCalledWith([expect.any(Function), expect.any(Function)]);
    expect(mocks.offset).toHaveBeenCalledWith(1);
    expect(mocks.limit).toHaveBeenCalledWith(2);
    expect(result).toEqual({
      items: [{ id: 'older' }],
      page: 2,
      pageSize: 1,
      hasMore: true,
    });
  });

  it('rejects users without the effective WORKER role before querying data', async () => {
    await expect(service.listOwnApplications({
      ...worker,
      roles: ['CLIENT'],
    } as never, { page: 1, pageSize: 20 })).rejects.toBeInstanceOf(ForbiddenException);

    expect(mocks.where).not.toHaveBeenCalled();
  });
});
