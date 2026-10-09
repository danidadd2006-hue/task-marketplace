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
import { PublicTaskDetailsResponseDto } from './dto/public-task-details-response.dto.js';
import { PublicTaskDetailsService } from './public-task-details.service.js';

const queryChain = () => ({
  where: mocks.where,
  select: mocks.select,
  include: mocks.include,
  first: mocks.first,
});

const publicTask = {
  id: 'task-id',
  title: 'Move a sofa',
  description: 'Move a sofa',
  type: 'PHYSICAL' as const,
  duration: 'SHORT_TERM' as const,
  status: 'PUBLISHED' as const,
  currency: 'KES',
  budgetMin: '50',
  budgetMax: '100',
  expectedCompletionAt: new Date('2026-10-20T10:00:00.000Z'),
  requirements: 'Bring a suitable vehicle',
  createdAt: new Date('2026-10-05T10:00:00.000Z'),
  updatedAt: new Date('2026-10-05T10:00:00.000Z'),
  location: { country: { id: 'country-id', name: 'Kenya', code: 'KE' }, region: { id: 'region-id', name: 'Sample Region' }, city: { id: 'city-id', name: 'Sample City' }, area: 'Sample Area' },
  category: { id: 'category-id', name: 'Moving' },
  requirementsList: [
    {
      id: 'requirement-id',
      taskId: 'task-id',
      name: 'Vehicle',
      value: 'Suitable vehicle',
      createdAt: new Date('2026-10-05T10:00:00.000Z'),
      updatedAt: new Date('2026-10-05T10:00:00.000Z'),
    },
  ],
  attachments: [
    {
      id: 'attachment-id',
      taskId: 'task-id',
      fileName: 'instructions.pdf',
      fileType: 'application/pdf',
      fileSize: 1234,
      createdAt: new Date('2026-10-05T10:00:00.000Z'),
      updatedAt: new Date('2026-10-05T10:00:00.000Z'),
    },
  ],
};

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

  it.each(['PUBLISHED', 'RECEIVING_APPLICATIONS'] as const)(
    'retrieves a %s task through the public contract',
    async (status) => {
      mocks.first.mockResolvedValue({ ...publicTask, status });

      const result = await service.getTaskDetails('task-id');

      expect(result).toBeInstanceOf(PublicTaskDetailsResponseDto);
      expect(result.status).toBe(status);
      expect(result.id).toBe('task-id');
    },
  );

  it('loads only publicly visible tasks', async () => {
    mocks.first.mockResolvedValue(publicTask);

    await service.getTaskDetails('task-id');

    const statusPredicate = mocks.where.mock.calls[0]?.[0];
    expect(statusPredicate).toEqual(expect.any(Function));

    const statusField = { status: { in: vi.fn() } };
    statusPredicate(statusField);
    expect(statusField.status.in).toHaveBeenCalledWith([
      'PUBLISHED',
      'RECEIVING_APPLICATIONS',
    ]);
    expect(mocks.where).toHaveBeenCalledWith({ id: 'task-id' });
  });

  it('maps the ORM projection into the dedicated public response contract', async () => {
    mocks.first.mockResolvedValue(publicTask);

    const result = await service.getTaskDetails('task-id');

    expect(result).toEqual({
      id: 'task-id',
      title: 'Move a sofa',
      description: 'Move a sofa',
      type: 'PHYSICAL',
      duration: 'SHORT_TERM',
      status: 'PUBLISHED',
      currency: 'KES',
      budgetMin: '50',
      budgetMax: '100',
      expectedCompletionAt: '2026-10-20T10:00:00.000Z',
      requirements: 'Bring a suitable vehicle',
      createdAt: '2026-10-05T10:00:00.000Z',
      updatedAt: '2026-10-05T10:00:00.000Z',
      location: { country: { id: 'country-id', name: 'Kenya', code: 'KE' }, region: { id: 'region-id', name: 'Sample Region' }, city: { id: 'city-id', name: 'Sample City' }, area: 'Sample Area' },
      category: { id: 'category-id', name: 'Moving' },
      requirementsList: [
        {
          id: 'requirement-id',
          taskId: 'task-id',
          name: 'Vehicle',
          value: 'Suitable vehicle',
          createdAt: '2026-10-05T10:00:00.000Z',
          updatedAt: '2026-10-05T10:00:00.000Z',
        },
      ],
      attachments: [
        {
          id: 'attachment-id',
          taskId: 'task-id',
          fileName: 'instructions.pdf',
          fileType: 'application/pdf',
          fileSize: 1234,
          createdAt: '2026-10-05T10:00:00.000Z',
          updatedAt: '2026-10-05T10:00:00.000Z',
        },
      ],
    });

    expect(result).toBeInstanceOf(PublicTaskDetailsResponseDto);
  });

  it('keeps private ownership, exact location, coordinates, and attachment URLs out of the response', async () => {
    mocks.first.mockResolvedValue({
      ...publicTask,
      clientId: 'private-client-id',
      locationDescription: '123 Exact Street',
      latitude: '0.123',
      longitude: '36.456',
      attachments: [
        {
          ...publicTask.attachments[0],
          fileUrl: 'https://private.example/file',
        },
      ],
    });

    const result = await service.getTaskDetails('task-id');

    expect(result).not.toHaveProperty('clientId');
    expect(result).not.toHaveProperty('locationDescription');
    expect(result).not.toHaveProperty('latitude');
    expect(result).not.toHaveProperty('longitude');
    expect(result.attachments[0]).not.toHaveProperty('fileUrl');
  });

  it('does not reveal non-public or nonexistent tasks', async () => {
    await expect(service.getTaskDetails('missing-task')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const statusPredicate = mocks.where.mock.calls[0]?.[0];
    const statusField = { status: { in: vi.fn() } };
    statusPredicate(statusField);

    expect(statusField.status.in).toHaveBeenCalledWith([
      'PUBLISHED',
      'RECEIVING_APPLICATIONS',
    ]);
  });
});
