import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFirst: vi.fn(), roleAll: vi.fn(),
  taskFirst: vi.fn(), contractFirst: vi.fn(), paymentFirst: vi.fn(),
  disputeFirst: vi.fn(), disputeCreate: vi.fn(), disputeUpdate: vi.fn(),
  trustCaseWhere: vi.fn(), trustCaseFirst: vi.fn(), trustCaseUpdate: vi.fn(),
  historyCreate: vi.fn(), auditCreate: vi.fn(),
  messageFirst: vi.fn(), memberFirst: vi.fn(),
  createCaseInTransaction: vi.fn(), addEvidence: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: { public: {
      User: { where: vi.fn(() => ({ first: mocks.userFirst })) },
      UserRoleAssignment: { where: vi.fn(() => ({ all: mocks.roleAll })) },
      Task: { where: vi.fn(() => ({ first: mocks.taskFirst })) },
      Contract: { where: vi.fn(() => ({ first: mocks.contractFirst })) },
      Payment: { where: vi.fn(() => ({ first: mocks.paymentFirst })) },
      Dispute: { where: vi.fn(() => ({ first: mocks.disputeFirst, update: mocks.disputeUpdate })), create: mocks.disputeCreate },
      TrustCaseHistory: { create: mocks.historyCreate },
      AuditLog: { create: mocks.auditCreate },
      Message: { where: vi.fn(() => ({ first: mocks.messageFirst })) },
      ConversationMember: { where: vi.fn(() => ({ first: mocks.memberFirst })) },
    } },
  },
}));

import { DisputeService } from './dispute.service.js';

const actor = { userId: 'client-1', email: 'client@example.com', roles: ['CLIENT'] as const };
const worker = { userId: 'worker-1', email: 'worker@example.com', roles: ['WORKER'] as const };
const admin = { userId: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] as const };

const task = { id: 'task-1', clientId: 'client-1', status: 'COMPLETED' };
const contract = { id: 'contract-1', taskId: 'task-1', workerId: 'worker-1', status: 'COMPLETED' };
const payment = { id: 'payment-1', taskId: 'task-1', contractId: 'contract-1', clientId: 'client-1', workerId: 'worker-1', status: 'FUNDED' };
const dispute = {
  id: 'dispute-1', taskId: 'task-1', contractId: 'contract-1', paymentId: 'payment-1',
  raisedById: 'client-1', category: 'SERVICE', reason: 'WORK_NOT_COMPLETED',
  description: 'The agreed work was not completed as expected.',
  status: 'OPEN', resolution: null, resolutionCode: null, resolutionReason: null,
  resolutionActorId: null, resolutionAt: null, relatedFinancialActionRef: null,
  trustCaseId: 'case-1', activeKey: 'task-1:contract-1:client-1',
  createdAt: '2026-10-07T01:00:00.000Z', updatedAt: '2026-10-07T01:00:00.000Z',
};

function tx() {
  return { orm: { public: {
    User: { where: vi.fn(() => ({ first: mocks.userFirst })) },
    UserRoleAssignment: { where: vi.fn(() => ({ all: mocks.roleAll })) },
    Task: { where: vi.fn(() => ({ first: mocks.taskFirst })) },
    Contract: { where: vi.fn(() => ({ first: mocks.contractFirst })) },
    Payment: { where: vi.fn(() => ({ first: mocks.paymentFirst })) },
    Dispute: { where: vi.fn(() => ({ first: mocks.disputeFirst, update: mocks.disputeUpdate })), create: mocks.disputeCreate },
    TrustCaseHistory: { create: mocks.historyCreate },
    AuditLog: { create: mocks.auditCreate },
    TrustCase: { where: mocks.trustCaseWhere },
  } } } as any;
}

describe('DisputeService — Phase 6 Step 6.6', () => {
  const trustSafety = {
    createCaseInTransaction: mocks.createCaseInTransaction,
    addEvidence: mocks.addEvidence,
  };
  const service = new DisputeService(trustSafety as any);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.userFirst.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
    mocks.roleAll.mockResolvedValue([]);
    mocks.taskFirst.mockResolvedValue(task);
    mocks.contractFirst.mockResolvedValue(contract);
    mocks.paymentFirst.mockResolvedValue(payment);
    mocks.disputeFirst.mockResolvedValue(null);
    mocks.disputeCreate.mockResolvedValue(dispute);
    mocks.disputeUpdate.mockResolvedValue(1);
    mocks.trustCaseFirst.mockResolvedValue({ id: 'case-1', status: 'IN_REVIEW', revision: 1 });
    mocks.trustCaseWhere.mockReturnValue({ first: mocks.trustCaseFirst, update: mocks.trustCaseUpdate });
    mocks.trustCaseUpdate.mockResolvedValue(1);
    mocks.historyCreate.mockResolvedValue({ id: 'history-1' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
    mocks.createCaseInTransaction.mockResolvedValue({ id: 'case-1', type: 'DISPUTE', status: 'OPEN' });
    mocks.addEvidence.mockResolvedValue({ id: 'evidence-1', evidenceType: 'MESSAGE', description: 'Relevant' });
    mocks.messageFirst.mockResolvedValue({ id: 'message-1', conversationId: 'conversation-1' });
    mocks.memberFirst.mockResolvedValue({ id: 'member-1' });
  });

  it('creates a dispute for an ACTIVE client with server-derived actor and TrustCase linkage', async () => {
    const result = await service.createDispute(actor, {
      taskId: 'task-1', contractId: 'contract-1', paymentId: 'payment-1',
      category: 'SERVICE', reason: 'WORK_NOT_COMPLETED',
      description: 'The agreed work was not completed as expected.',
    });
    expect(result.id).toBe('dispute-1');
    expect(mocks.createCaseInTransaction).toHaveBeenCalledWith(expect.anything(), actor, expect.objectContaining({
      type: 'DISPUTE', subjectType: 'CONTRACT', subjectId: 'contract-1',
    }));
    expect(mocks.disputeCreate).toHaveBeenCalledWith(expect.objectContaining({
      raisedById: 'client-1', trustCaseId: 'case-1', status: 'OPEN',
    }));
  });

  it('allows the ACTIVE selected worker to raise a dispute', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'worker-1', status: 'ACTIVE' });
    mocks.disputeCreate.mockResolvedValue({ ...dispute, raisedById: 'worker-1' });
    await expect(service.createDispute(worker, {
      taskId: 'task-1', contractId: 'contract-1', category: 'QUALITY',
      reason: 'QUALITY_ISSUE', description: 'The delivered work does not meet the agreed quality.',
    })).resolves.toBeTruthy();
  });

  it('rejects inactive users and unrelated users', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'client-1', status: 'SUSPENDED' });
    await expect(service.createDispute(actor, {
      taskId: 'task-1', contractId: 'contract-1', category: 'SERVICE',
      reason: 'WORK_NOT_COMPLETED', description: 'The agreed work was not completed as expected.',
    })).rejects.toBeInstanceOf(ForbiddenException);

    mocks.userFirst.mockResolvedValue({ id: 'other', status: 'ACTIVE' });
    await expect(service.createDispute({ ...actor, userId: 'other' }, {
      taskId: 'task-1', contractId: 'contract-1', category: 'SERVICE',
      reason: 'WORK_NOT_COMPLETED', description: 'The agreed work was not completed as expected.',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects inconsistent contract, payment and task relationships', async () => {
    mocks.contractFirst.mockResolvedValue({ ...contract, taskId: 'other-task' });
    await expect(service.createDispute(actor, {
      taskId: 'task-1', contractId: 'contract-1', category: 'SERVICE',
      reason: 'WORK_NOT_COMPLETED', description: 'The agreed work was not completed as expected.',
    })).rejects.toBeInstanceOf(ConflictException);

    mocks.contractFirst.mockResolvedValue(contract);
    mocks.paymentFirst.mockResolvedValue({ ...payment, taskId: 'other-task' });
    await expect(service.createDispute(actor, {
      taskId: 'task-1', contractId: 'contract-1', category: 'PAYMENT',
      reason: 'PAYMENT_ISSUE', description: 'The payment relationship does not match this contract.',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates structured taxonomy and human description', async () => {
    await expect(service.createDispute(actor, {
      taskId: 'task-1', contractId: 'contract-1', category: 'PAYMENT',
      reason: 'QUALITY_ISSUE', description: 'Invalid category reason.',
    })).rejects.toBeInstanceOf((await import('@nestjs/common')).BadRequestException);

    await expect(service.createDispute(actor, {
      taskId: 'task-1', contractId: 'contract-1', category: 'SERVICE',
      reason: 'WORK_NOT_COMPLETED', description: 'too short',
    })).rejects.toBeInstanceOf((await import('@nestjs/common')).BadRequestException);
  });

  it('rejects duplicate active disputes deterministically', async () => {
    mocks.disputeFirst.mockResolvedValue(dispute);
    await expect(service.createDispute(actor, {
      taskId: 'task-1', contractId: 'contract-1', category: 'SERVICE',
      reason: 'WORK_NOT_COMPLETED', description: 'A second active dispute should be rejected.',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.createCaseInTransaction).not.toHaveBeenCalled();
  });

  it('does not mutate payment, ledger, refund or payout state during creation', async () => {
    await service.createDispute(actor, {
      taskId: 'task-1', contractId: 'contract-1', paymentId: 'payment-1',
      category: 'PAYMENT', reason: 'PAYMENT_ISSUE',
      description: 'The payment relationship requires review before financial action.',
    });
    expect(mocks.disputeCreate).toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('allows only participants to retrieve a dispute and returns no TrustCase internals', async () => {
    mocks.disputeFirst.mockResolvedValue(dispute);
    await expect(service.getDispute(actor, 'dispute-1')).resolves.toMatchObject({
      id: 'dispute-1', status: 'OPEN', contractId: 'contract-1',
    });
    mocks.disputeFirst.mockResolvedValue(dispute);
    mocks.taskFirst.mockResolvedValue({ ...task, clientId: 'someone-else' });
    await expect(service.getDispute({ ...actor, userId: 'unrelated' }, 'dispute-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adds permitted message evidence through TrustCaseEvidence without private metadata', async () => {
    mocks.disputeFirst.mockResolvedValue(dispute);
    await expect(service.addEvidence(actor, 'dispute-1', {
      evidenceType: 'MESSAGE', referenceType: 'MESSAGE', referenceId: 'message-1',
      description: 'Relevant conversation evidence',
    })).resolves.toMatchObject({ id: 'evidence-1' });
    expect(mocks.addEvidence).toHaveBeenCalledWith(actor, 'case-1', expect.objectContaining({
      evidenceType: 'MESSAGE', referenceType: 'MESSAGE', referenceId: 'message-1',
    }));
  });

  it('rejects private or unrelated evidence references', async () => {
    mocks.memberFirst.mockResolvedValue(null);
    await expect(service.addEvidence(actor, 'dispute-1', {
      evidenceType: 'MESSAGE', referenceType: 'MESSAGE', referenceId: 'message-1',
    })).rejects.toBeInstanceOf(NotFoundException);

    mocks.disputeFirst.mockResolvedValue(dispute);
    await expect(service.addEvidence(actor, 'dispute-1', {
      evidenceType: 'OTHER', referenceType: 'VERIFICATION', referenceId: 'verification-1',
    })).rejects.toThrow('Unsupported dispute evidence reference');
  });

  it('allows the participant transition OPEN -> UNDER_REVIEW and reconstructs it in history', async () => {
    mocks.disputeFirst.mockResolvedValue(dispute);
    mocks.disputeUpdate.mockResolvedValue(1);
    await expect(service.advanceForParticipant(actor, 'dispute-1', 'UNDER_REVIEW')).resolves.toMatchObject({ status: 'UNDER_REVIEW' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DECISION', fromStatus: 'OPEN', toStatus: 'IN_REVIEW', actorId: 'client-1',
    }));
  });

  it('rejects participant resolution/dismissal and invalid transitions', async () => {
    mocks.disputeFirst.mockResolvedValue(dispute);
    await expect(service.advanceForParticipant(actor, 'dispute-1', 'RESOLVED')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.advanceForParticipant(actor, 'dispute-1', 'REJECTED')).rejects.toBeInstanceOf(ConflictException);
    mocks.disputeFirst.mockResolvedValue({ ...dispute, status: 'UNDER_REVIEW' });
    await expect(service.advanceForParticipant(actor, 'dispute-1', 'OPEN')).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses the existing REJECTED state as the administrative dismissal/rejection terminal state', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'admin-1', status: 'ACTIVE' });
    mocks.roleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.disputeFirst.mockResolvedValue(dispute);
    mocks.disputeUpdate.mockResolvedValue(1);
    const result = await service.recordAdminResolution(admin, 'dispute-1', {
      status: 'REJECTED', resolutionCode: 'NOT_SUPPORTED',
      reason: 'The dispute was reviewed and rejected on the available evidence.',
    });
    expect(result.status).toBe('REJECTED');
    expect(mocks.disputeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'REJECTED', activeKey: null,
    }));
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DECISION', toStatus: 'CLOSED', actorId: 'admin-1',
    }));
  });

  it('rejects non-admin resolution and preserves financial boundary', async () => {
    mocks.disputeFirst.mockResolvedValue(dispute);
    await expect(service.recordAdminResolution(actor, 'dispute-1', {
      status: 'RESOLVED', resolutionCode: 'NO_FINANCIAL_ACTION',
      reason: 'Resolved without an automatic financial mutation.',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('handles concurrent lifecycle changes deterministically', async () => {
    mocks.disputeFirst.mockResolvedValue(dispute);
    mocks.disputeUpdate.mockResolvedValue(0);
    await expect(service.advanceForParticipant(actor, 'dispute-1', 'UNDER_REVIEW')).rejects.toBeInstanceOf(ConflictException);
    mocks.userFirst.mockResolvedValue({ id: 'admin-1', status: 'ACTIVE' });
    mocks.roleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.disputeUpdate.mockResolvedValue(0);
    await expect(service.recordAdminResolution(admin, 'dispute-1', {
      status: 'RESOLVED', resolutionCode: 'REVIEWED',
      reason: 'Concurrent resolution attempt.',
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
