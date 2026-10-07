import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  contractWhere: vi.fn(),
  contractFirst: vi.fn(),
  taskWhere: vi.fn(),
  taskFirst: vi.fn(),
  reviewCreate: vi.fn(),
  reviewWhere: vi.fn(),
  reviewAll: vi.fn(),
  profileWhere: vi.fn(),
  profileFirst: vi.fn(),
  profileUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: { transaction: mocks.transaction },
}));

import { ReviewService } from './review.service.js';

const client = { userId: 'client-id', email: 'client@example.com', roles: ['CLIENT'] as const };
const worker = { userId: 'worker-id', email: 'worker@example.com', roles: ['WORKER'] as const };

const completedContract = {
  id: 'contract-id',
  taskId: 'task-id',
  workerId: 'worker-id',
  status: 'COMPLETED',
};

const completedTask = {
  id: 'task-id',
  clientId: 'client-id',
  status: 'COMPLETED',
};

const clientReview = {
  id: 'review-id',
  contractId: 'contract-id',
  reviewerId: 'client-id',
  revieweeId: 'worker-id',
  type: 'CLIENT_TO_WORKER',
  rating: 5,
  communicationRating: 4,
  reliabilityRating: 5,
  qualityRating: 5,
  professionalismRating: 5,
  comment: 'Great work',
  createdAt: '2026-10-07T00:00:00.000Z',
};

function tx() {
  return {
    orm: { public: {
      Contract: { where: mocks.contractWhere },
      Task: { where: mocks.taskWhere },
      Review: { create: mocks.reviewCreate, where: mocks.reviewWhere },
      Profile: { where: mocks.profileWhere },
      AuditLog: { create: mocks.auditCreate },
    } },
  } as any;
}

const validClientDto = {
  type: 'CLIENT_TO_WORKER',
  rating: 5,
  communicationRating: 4,
  reliabilityRating: 5,
  qualityRating: 5,
  professionalismRating: 5,
  comment: 'Great work',
} as any;

const validWorkerDto = {
  type: 'WORKER_TO_CLIENT',
  rating: 4,
  communicationRating: 4,
  reliabilityRating: 5,
  qualityRating: 4,
  professionalismRating: 4,
  comment: 'Clear client',
} as any;

describe('ReviewService — Phase 6 Step 6.2', () => {
  const service = new ReviewService();

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.contractFirst.mockResolvedValue({ ...completedContract });
    mocks.contractWhere.mockReturnValue({ first: mocks.contractFirst });
    mocks.taskFirst.mockResolvedValue({ ...completedTask });
    mocks.taskWhere.mockReturnValue({ first: mocks.taskFirst });
    mocks.reviewCreate.mockResolvedValue({ ...clientReview });
    mocks.reviewAll.mockResolvedValue([{ ...clientReview }]);
    mocks.reviewWhere.mockReturnValue({ all: mocks.reviewAll });
    mocks.profileFirst.mockResolvedValue({ userId: 'worker-id' });
    mocks.profileWhere.mockReturnValue({ first: mocks.profileFirst, update: mocks.profileUpdate });
    mocks.profileUpdate.mockResolvedValue({ userId: 'worker-id', averageRating: '5.0000', totalReviews: 1 });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
  });

  it('allows a client to review the completed worker side', async () => {
    const result = await service.createReview(client, 'contract-id', validClientDto);
    expect(result).toMatchObject({ reviewerId: 'client-id', revieweeId: 'worker-id', type: 'CLIENT_TO_WORKER' });
    expect(mocks.reviewCreate).toHaveBeenCalledWith(expect.objectContaining({ reviewerId: 'client-id', revieweeId: 'worker-id' }));
  });

  it('allows a worker to review the completed client side', async () => {
    mocks.reviewCreate.mockResolvedValue({ ...clientReview, ...validWorkerDto, reviewerId: 'worker-id', revieweeId: 'client-id', id: 'worker-review-id' });
    mocks.profileFirst.mockResolvedValue({ userId: 'client-id' });
    mocks.reviewAll.mockResolvedValue([{ ...clientReview, ...validWorkerDto, reviewerId: 'worker-id', revieweeId: 'client-id', id: 'worker-review-id' }]);

    const result = await service.createReview(worker, 'contract-id', validWorkerDto);
    expect(result).toMatchObject({ reviewerId: 'worker-id', revieweeId: 'client-id', type: 'WORKER_TO_CLIENT' });
  });

  it('rejects incomplete work', async () => {
    mocks.taskFirst.mockResolvedValue({ ...completedTask, status: 'AWAITING_APPROVAL' });
    await expect(service.createReview(client, 'contract-id', validClientDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-party', async () => {
    await expect(service.createReview({ userId: 'outsider', email: 'x@example.com', roles: [] }, 'contract-id', validClientDto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects self-review', async () => {
    mocks.contractFirst.mockResolvedValue({ ...completedContract, workerId: 'client-id' });
    await expect(service.createReview(client, 'contract-id', validClientDto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects the wrong review type for the authenticated party', async () => {
    await expect(service.createReview(client, 'contract-id', validWorkerDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates the overall and dimension ratings on the server', async () => {
    for (const field of ['rating', 'communicationRating', 'reliabilityRating', 'qualityRating', 'professionalismRating']) {
      await expect(service.createReview(client, 'contract-id', { ...validClientDto, [field]: 6 })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('maps a database uniqueness race to a conflict', async () => {
    mocks.reviewCreate.mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint' });
    await expect(service.createReview(client, 'contract-id', validClientDto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('protects concurrent duplicate creation when the database rejects the losing insert', async () => {
    let createCalls = 0;
    mocks.reviewCreate.mockImplementation(async () => {
      createCalls += 1;
      if (createCalls === 2) {
        throw { code: '23505', message: 'duplicate key value violates unique constraint' };
      }
      return { ...clientReview };
    });

    const results = await Promise.allSettled([
      service.createReview(client, 'contract-id', validClientDto),
      service.createReview(client, 'contract-id', validClientDto),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof ConflictException)).toHaveLength(1);
  });

  it('derives reviewer and reviewee from authenticated party and stored contract/task data', async () => {
    await service.createReview(client, 'attacker-supplied-contract-id', validClientDto);
    expect(mocks.reviewCreate).toHaveBeenCalledWith(expect.objectContaining({ reviewerId: 'client-id', revieweeId: 'worker-id', contractId: 'contract-id' }));
    expect(mocks.reviewCreate.mock.calls[0][0]).not.toHaveProperty('taskId');
  });

  it('recomputes profile rating from authoritative review records', async () => {
    mocks.reviewAll.mockResolvedValue([
      { ...clientReview, rating: 5 },
      { ...clientReview, id: 'review-2', rating: 3 },
    ]);
    await service.createReview(client, 'contract-id', validClientDto);
    expect(mocks.reviewAll).toHaveBeenCalledWith();
    expect(mocks.profileUpdate).toHaveBeenCalledWith({ averageRating: '4.0000', totalReviews: 2 });
  });

  it('does not double-count duplicates because aggregation counts durable review rows', async () => {
    mocks.reviewCreate.mockResolvedValueOnce({ ...clientReview });
    mocks.reviewAll.mockResolvedValue([{ ...clientReview }]);
    await service.createReview(client, 'contract-id', validClientDto);
    expect(mocks.profileUpdate).toHaveBeenCalledWith({ averageRating: '5.0000', totalReviews: 1 });
  });

  it('does not expose private contract/payment/location/storage data in the response', async () => {
    mocks.reviewCreate.mockResolvedValue({
      ...clientReview,
      internalPaymentId: 'payment-secret',
      payoutDestinationId: 'destination-secret',
      storageKey: 'private-key',
      taskLocation: 'private-location',
    });
    const result = await service.createReview(client, 'contract-id', validClientDto) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty('internalPaymentId');
    expect(result).not.toHaveProperty('payoutDestinationId');
    expect(result).not.toHaveProperty('storageKey');
    expect(result).not.toHaveProperty('taskLocation');
  });

  it('rejects a missing contract before creating a review', async () => {
    mocks.contractFirst.mockResolvedValue(undefined);
    await expect(service.createReview(client, 'missing', validClientDto)).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.reviewCreate).not.toHaveBeenCalled();
  });

  it('audits the authored review without embedding private financial data', async () => {
    await service.createReview(client, 'contract-id', validClientDto);
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entityType: 'Review', entityId: 'review-id' }));
    expect(JSON.stringify(mocks.auditCreate.mock.calls[0][0])).not.toContain('payment');
  });
});
