import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicTaskFeedQueryDto } from './dto/public-task-feed-query.dto.js';

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

import { TaskDiscoveryService } from './task-discovery.service.js';

const queryChain = () => ({
  where: mocks.where,
  select: mocks.select,
  include: mocks.include,
  orderBy: mocks.orderBy,
  offset: mocks.offset,
  limit: mocks.limit,
  all: mocks.all,
});

describe('TaskDiscoveryService', () => {
  const service = new TaskDiscoveryService();

  beforeEach(() => {
    vi.resetAllMocks();

    const chain = queryChain();
    mocks.where.mockReturnValue(chain);
    mocks.select.mockReturnValue(chain);
    mocks.include.mockReturnValue(chain);
    mocks.orderBy.mockReturnValue(chain);
    mocks.offset.mockReturnValue(chain);
    mocks.limit.mockReturnValue(chain);
    mocks.all.mockResolvedValue([]);
  });

  it('returns published tasks', async () => {
    mocks.all.mockResolvedValue([{ id: 'published', status: 'PUBLISHED' }]);

    const result = await service.discoverTasks({});

    expect(result.items).toEqual([{ id: 'published', status: 'PUBLISHED' }]);
  });

  it('returns receiving-applications tasks', async () => {
    mocks.all.mockResolvedValue([{ id: 'open', status: 'RECEIVING_APPLICATIONS' }]);

    const result = await service.discoverTasks({});

    expect(result.items).toEqual([{ id: 'open', status: 'RECEIVING_APPLICATIONS' }]);
  });

  it('excludes DRAFT and every later/private/terminal status at the database predicate', async () => {
    await service.discoverTasks({});

    const predicate = mocks.where.mock.calls[0]?.[0];
    expect(predicate).toEqual(expect.any(Function));

    const statusField = { in: vi.fn() };
    predicate(statusField);

    expect(statusField.in).toHaveBeenCalledWith([
      'PUBLISHED',
      'RECEIVING_APPLICATIONS',
    ]);
    for (const excluded of [
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
    ]) {
      expect(statusField.in.mock.calls[0][0]).not.toContain(excluded);
    }
  });

  it('uses bounded deterministic pagination', async () => {
    await service.discoverTasks({ page: 2, pageSize: 20 });

    expect(mocks.orderBy).toHaveBeenCalledWith([
      expect.any(Function),
      expect.any(Function),
    ]);
    expect(mocks.offset).toHaveBeenCalledWith(20);
    expect(mocks.limit).toHaveBeenCalledWith(21);
  });

  it('applies supported filters without accepting a status filter', async () => {
    await service.discoverTasks({
      type: 'PHYSICAL',
      duration: 'SHORT_TERM',
      categoryId: 'd5c0f2d4-5fc6-4e64-979d-106f9d79d1a0',
    });

    expect(mocks.where).toHaveBeenCalledTimes(4);
    expect(mocks.where.mock.calls[1][0]).toEqual(expect.any(Function));
    expect(mocks.where.mock.calls[2][0]).toEqual(expect.any(Function));
    expect(mocks.where.mock.calls[3][0]).toEqual(expect.any(Function));
  });

  it('returns only the public projection and does not expose exact location or ownership', async () => {
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
      createdAt: '2026-10-05T10:00:00.000Z',
      category: { id: 'category-id', name: 'Moving' },
    };
    mocks.all.mockResolvedValue([publicTask]);

    const result = await service.discoverTasks({});

    expect(result.items[0]).toEqual(publicTask);
    expect(result.items[0]).not.toHaveProperty('clientId');
    expect(result.items[0]).not.toHaveProperty('locationDescription');
  });

  it('does not expose physical-location data for virtual tasks', async () => {
    mocks.all.mockResolvedValue([{
      id: 'virtual-task',
      type: 'VIRTUAL',
      status: 'PUBLISHED',
      category: { id: 'category-id', name: 'Design' },
    }]);

    const result = await service.discoverTasks({ type: 'VIRTUAL' });

    expect(result.items[0]).not.toHaveProperty('locationDescription');
  });

  it('never accepts a client-supplied status as a visibility control', async () => {
    await service.discoverTasks({
      type: 'PHYSICAL',
      status: 'COMPLETED',
    } as PublicTaskFeedQueryDto & { status: string });

    const predicate = mocks.where.mock.calls[0]?.[0];
    const statusField = { in: vi.fn() };
    predicate(statusField);

    expect(statusField.in).toHaveBeenCalledWith([
      'PUBLISHED',
      'RECEIVING_APPLICATIONS',
    ]);
    expect(mocks.where).toHaveBeenCalledTimes(2);
  });
});
