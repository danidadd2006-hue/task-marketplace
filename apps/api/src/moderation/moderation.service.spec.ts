import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFirst: vi.fn(),
  userWhere: vi.fn(),
  roleAll: vi.fn(),
  actorRoleAll: vi.fn(),
  assigneeRoleAll: vi.fn(),
  caseWhere: vi.fn(),
  caseFirst: vi.fn(),
  caseAll: vi.fn(),
  caseUpdate: vi.fn(),
  caseCreate: vi.fn(),
  historyWhere: vi.fn(),
  historyAll: vi.fn(),
  historyCreate: vi.fn(),
  evidenceWhere: vi.fn(),
  evidenceAll: vi.fn(),
  reportWhere: vi.fn(),
  reportFirst: vi.fn(),
  reportUpdate: vi.fn(),
  disputeWhere: vi.fn(),
  disputeFirst: vi.fn(),
  taskWhere: vi.fn(),
  taskFirst: vi.fn(),
  messageWhere: vi.fn(),
  messageFirst: vi.fn(),
  messageAttachmentWhere: vi.fn(),
  messageAttachmentAll: vi.fn(),
  reviewWhere: vi.fn(),
  reviewFirst: vi.fn(),
  auditCreate: vi.fn(),
  contractWhere: vi.fn(),
  contractFirst: vi.fn(),
  recordAdminResolution: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: { public: {
      User: { where: mocks.userWhere },
      UserRoleAssignment: { where: vi.fn((query) => (query?.userId === 'admin-id' || query?.userId === 'client-id') ? { all: mocks.actorRoleAll } : { all: mocks.assigneeRoleAll }) },
      TrustCase: { where: mocks.caseWhere },
      TrustCaseHistory: { where: mocks.historyWhere },
      TrustCaseEvidence: { where: mocks.evidenceWhere },
      TrustCaseDecision: { create: vi.fn((value) => mocks.historyCreate(value)) },
      Report: { where: mocks.reportWhere },
      Dispute: { where: mocks.disputeWhere },
      Task: { where: mocks.taskWhere },
      Message: { where: mocks.messageWhere },
      MessageAttachment: { where: mocks.messageAttachmentWhere },
      Review: { where: mocks.reviewWhere },
      AuditLog: { create: mocks.auditCreate },
      Contract: { where: mocks.contractWhere },
    } },
  },
}));

import { ModerationService } from './moderation.service.js';

const admin = { userId: 'admin-id', email: 'admin@example.com', roles: ['ADMIN'] as const };

const client = { userId: 'client-id', email: 'client@example.com', roles: ['CLIENT'] as const };

const openCase = {
  id: 'case-id',
  type: 'MODERATION',
  status: 'OPEN',
  subjectType: 'MESSAGE',
  subjectId: 'message-id',
  createdById: 'admin-id',
  assignedToId: null,
  assignedAt: null,
  resolvedAt: null,
  closedAt: null,
  closedById: null,
  resolutionCode: null,
  resolutionReason: null,
  revision: 0,
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
};

function tx() {
  return {
    orm: { public: {
      User: { where: mocks.userWhere },
      UserRoleAssignment: { where: vi.fn((query) => (query?.userId === 'admin-id' || query?.userId === 'client-id') ? { all: mocks.actorRoleAll } : { all: mocks.assigneeRoleAll }) },
      TrustCase: { where: mocks.caseWhere, create: mocks.caseCreate },
      TrustCaseHistory: { where: mocks.historyWhere, create: mocks.historyCreate },
      TrustCaseEvidence: { where: mocks.evidenceWhere },
      TrustCaseDecision: { create: vi.fn((value) => mocks.historyCreate(value)) },
      Report: { where: mocks.reportWhere },
      Dispute: { where: mocks.disputeWhere },
      Message: { where: mocks.messageWhere },
      MessageAttachment: { where: mocks.messageAttachmentWhere },
      AuditLog: { create: mocks.auditCreate },
      Task: { where: mocks.taskWhere },
      Review: { where: mocks.reviewWhere },
      Contract: { where: mocks.contractWhere },
    } },
  } as any;
}

describe('ModerationService — Phase 6 Step 6.7', () => {
  const disputeService = { recordAdminResolution: mocks.recordAdminResolution };
  const service = new ModerationService(disputeService as any);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.userWhere.mockImplementation((query?: any) => ({ first: vi.fn(async () => query?.id === 'admin-id' ? { id: 'admin-id', status: 'ACTIVE' } : mocks.userFirst(query)) }));
    mocks.userFirst.mockResolvedValue({ id: 'admin-id', status: 'ACTIVE' });
    mocks.actorRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.assigneeRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.caseFirst.mockResolvedValue({ ...openCase });
    mocks.caseWhere.mockReturnValue({
      first: mocks.caseFirst,
      all: mocks.caseAll,
      update: mocks.caseUpdate,
    });
    mocks.caseAll.mockResolvedValue([]);
    mocks.caseUpdate.mockResolvedValue(1);
    mocks.caseCreate.mockResolvedValue({ ...openCase });
    mocks.historyWhere.mockReturnValue({ all: mocks.historyAll });
    mocks.historyAll.mockResolvedValue([]);
    mocks.historyCreate.mockResolvedValue({ id: 'history-id', createdAt: '2026-10-08T00:00:00.000Z' });
    mocks.evidenceWhere.mockReturnValue({ orderBy: vi.fn(() => ({ all: mocks.evidenceAll })) });
    mocks.evidenceAll.mockResolvedValue([]);
    mocks.reportWhere.mockReturnValue({ first: mocks.reportFirst, update: mocks.reportUpdate });
    mocks.reportFirst.mockResolvedValue(null);
    mocks.reportUpdate.mockResolvedValue(1);
    mocks.disputeWhere.mockReturnValue({ first: mocks.disputeFirst, update: mocks.reportUpdate });
    mocks.disputeFirst.mockResolvedValue(null);
    mocks.taskWhere.mockReturnValue({ first: mocks.taskFirst });
    mocks.taskFirst.mockResolvedValue({ id: 'task-id', title: 'Task', description: 'Description', type: 'VIRTUAL', duration: 'SHORT_TERM', status: 'PUBLISHED', clientId: 'client-id', createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' });
    mocks.messageWhere.mockReturnValue({ first: mocks.messageFirst });
    mocks.messageFirst.mockResolvedValue({ id: 'message-id', conversationId: 'conversation-id', senderId: 'sender-id', type: 'TEXT', content: 'Private text', createdAt: '2026-10-08T00:00:00.000Z' });
    mocks.messageAttachmentWhere.mockReturnValue({ all: mocks.messageAttachmentAll });
    mocks.messageAttachmentAll.mockResolvedValue([{ id: 'attachment-id', storageKey: 'private-key', originalFilename: 'evidence.txt', mimeType: 'text/plain', size: 12n, checksum: 'hash', status: 'READY', createdAt: '2026-10-08T00:00:00.000Z' }]);
    mocks.reviewWhere.mockReturnValue({ first: mocks.reviewFirst });
    mocks.reviewFirst.mockResolvedValue({ id: 'review-id', contractId: 'contract-id', reviewerId: 'reviewer-id', revieweeId: 'reviewee-id', type: 'CLIENT_TO_WORKER', rating: 5, communicationRating: 5, reliabilityRating: 5, qualityRating: 5, professionalismRating: 5, comment: 'Good', createdAt: '2026-10-08T00:00:00.000Z' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    mocks.contractWhere.mockReturnValue({ first: mocks.contractFirst });
    mocks.contractFirst.mockResolvedValue({ id: 'contract-id', taskId: 'task-id', workerId: 'worker-id', status: 'COMPLETED', createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' });
    mocks.recordAdminResolution.mockResolvedValue({ id: 'dispute-id', status: 'RESOLVED' });
  });

  it('rejects ordinary users at the moderation service boundary', async () => {
    mocks.userFirst.mockImplementation(async (query?: any) => query?.id === 'client-id'
      ? { id: 'client-id', status: 'ACTIVE' }
      : { id: 'admin-id', status: 'ACTIVE' });
    mocks.actorRoleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.listQueue(client, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getCase(client, 'case-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns a paginated, confidentiality-safe moderation queue', async () => {
    mocks.caseAll.mockResolvedValueOnce([{ ...openCase }]).mockResolvedValue([]);
    const result = await service.listQueue(admin, { page: 1, pageSize: 1 } as any);
    expect(result).toMatchObject({ page: 1, pageSize: 1, hasMore: false });
    expect(result.items[0]).not.toHaveProperty('content');
    expect(result.items[0]).toMatchObject({ id: 'case-id', subjectType: 'MESSAGE' });
  });

  it('creates a manual moderation case with reasoned immutable history and audit', async () => {
    const result = await service.createCase(admin, { subjectType: 'MESSAGE', subjectId: 'message-id', reason: 'Review reported private message for policy compliance' });
    expect(result).toMatchObject({ id: 'case-id', type: 'MODERATION', status: 'OPEN' });
    expect(mocks.caseCreate).toHaveBeenCalledWith(expect.objectContaining({ subjectType: 'MESSAGE', subjectId: 'message-id' }));
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', reason: 'Review reported private message for policy compliance' }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'TrustCase' }));
  });

  it('requires a real moderation target and a non-empty reason', async () => {
    mocks.messageFirst.mockResolvedValue(null);
    await expect(service.createCase(admin, { subjectType: 'MESSAGE', subjectId: 'missing', reason: 'Investigate' }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createCase(admin, { subjectType: 'MESSAGE', subjectId: 'message-id', reason: ' ' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('assigns only to an active administrator and records assignment actor', async () => {
    mocks.userFirst.mockImplementation(async (query?: any) => ({ id: query?.id ?? 'admin-id', status: 'ACTIVE' }));
    mocks.actorRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.assigneeRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    const result = await service.assign(admin, 'case-id', 'other-admin', 'Routine case allocation');
    expect(result).toMatchObject({ assignedToId: 'other-admin', status: 'ASSIGNED' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSIGN', actorId: 'admin-id', toStatus: 'ASSIGNED' }));
  });

  it('rejects assignment to non-admins and duplicate assignment', async () => {
    mocks.caseFirst.mockResolvedValue({ ...openCase, assignedToId: 'other-admin', status: 'ASSIGNED' });
    await expect(service.assign(admin, 'case-id', 'other-admin', 'Routine case allocation')).rejects.toBeInstanceOf(ConflictException);

    mocks.caseFirst.mockResolvedValue({ ...openCase, assignedToId: null });
    mocks.userFirst.mockImplementation(async (query?: any) => query?.id === 'admin-id'
      ? { id: 'admin-id', status: 'ACTIVE' }
      : { id: 'worker', status: 'ACTIVE' });
    mocks.actorRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.assigneeRoleAll.mockResolvedValue([{ role: 'WORKER' }]);
    await expect(service.assign(admin, 'case-id', 'worker', 'Attempted assignment')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('unassigns an ASSIGNED case reversibly and records the previous assignee', async () => {
    mocks.caseFirst.mockResolvedValue({ ...openCase, assignedToId: 'other-admin', status: 'ASSIGNED', revision: 3 });
    mocks.assigneeRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    await expect(service.unassign(admin, 'case-id', 'Conflict of interest')).resolves.toMatchObject({ assignedToId: null, status: 'OPEN' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REASSIGN',
      fromStatus: 'ASSIGNED',
      toStatus: 'OPEN',
      reason: 'Conflict of interest',
      metadataJson: JSON.stringify({ previousAssigneeId: 'other-admin', assigneeId: null }),
    }));
  });

  it('records investigation notes as immutable history without copying source records', async () => {
    const result = await service.addNote(admin, 'case-id', 'Reviewed the message context and linked evidence');
    expect(result).toMatchObject({ action: 'INVESTIGATION_NOTE_ADDED', caseId: 'case-id' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ACTION_APPLIED',
      reason: 'Reviewed the message context and linked evidence',
    }));
  });

  it('records decisions with actor, reason and structured metadata', async () => {
    await service.recordDecision(admin, 'case-id', 'REMOVE_CONTENT', 'Content breached policy', { policy: 'CONTENT' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DECISION',
      actorId: 'admin-id',
      reason: 'Content breached policy',
      metadataJson: expect.stringContaining('REMOVE_CONTENT'),
    }));
  });

  it('enforces the moderation lifecycle and synchronises REPORT/Dispute review state', async () => {
    mocks.caseFirst.mockResolvedValueOnce({ ...openCase, type: 'REPORT', status: 'OPEN', subjectType: 'TASK' });
    mocks.reportFirst.mockResolvedValue({ id: 'report-id', status: 'OPEN' });
    await expect(service.transition(admin, 'case-id', 'IN_REVIEW', 'Started investigation')).resolves.toMatchObject({ status: 'IN_REVIEW' });
    expect(mocks.reportUpdate).toHaveBeenCalledWith({ status: 'UNDER_REVIEW' });

    mocks.caseFirst.mockResolvedValueOnce({ ...openCase, type: 'MODERATION', status: 'IN_REVIEW' });
    await expect(service.transition(admin, 'case-id', 'RESOLVED', 'Decision complete')).resolves.toMatchObject({ status: 'RESOLVED' });

    mocks.caseFirst.mockResolvedValue({ ...openCase, type: 'MODERATION', status: 'RESOLVED' });
    await expect(service.transition(admin, 'case-id', 'CLOSED', 'Administrative closure')).resolves.toMatchObject({ status: 'CLOSED' });
  });

  it('rejects invalid lifecycle transitions and concurrent revisions', async () => {
    mocks.caseFirst.mockResolvedValue({ ...openCase, status: 'OPEN' });
    await expect(service.transition(admin, 'case-id', 'RESOLVED', 'Too early')).rejects.toBeInstanceOf(ConflictException);
    mocks.caseUpdate.mockResolvedValue(0);
    await expect(service.assign(admin, 'case-id', 'other-admin', 'Routine case allocation')).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves reports through the report state boundary and never mutates financial state', async () => {
    mocks.reportFirst.mockResolvedValue({ id: 'report-id', reporterId: 'reporter-id', trustCaseId: 'case-id', status: 'UNDER_REVIEW' });
    mocks.caseFirst.mockResolvedValue({ ...openCase, id: 'case-id', type: 'REPORT', status: 'IN_REVIEW', revision: 2 });
    const result = await service.resolveReport(admin, 'report-id', { status: 'DISMISSED', reason: 'Evidence did not establish a policy breach' });
    expect(result).toMatchObject({ status: 'DISMISSED', trustCaseId: 'case-id' });
    expect(mocks.reportUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'DISMISSED', activeKey: null }));
  });

  it('routes dispute resolution through the existing dispute financial boundary', async () => {
    mocks.disputeFirst.mockResolvedValue({ id: 'dispute-id', trustCaseId: 'case-id', status: 'UNDER_REVIEW' });
    mocks.caseFirst.mockResolvedValue({ ...openCase, id: 'case-id', type: 'DISPUTE', status: 'IN_REVIEW' });
    await service.resolveDispute(admin, 'dispute-id', {
      status: 'RESOLVED',
      resolutionCode: 'REVIEWED',
      reason: 'Dispute resolved after evidence review',
    });
    expect(mocks.recordAdminResolution).toHaveBeenCalledWith(admin, 'dispute-id', expect.objectContaining({
      status: 'RESOLVED',
      resolutionCode: 'REVIEWED',
    }));
  });

  it('exposes authorised message context without private storage keys', async () => {
    const result = await service.getCase(admin, 'case-id');
    const json = JSON.stringify(result);
    expect(json).toContain('Private text');
    expect(json).not.toContain('private-key');
    expect(json).not.toContain('storageKey');
  });

  it('returns only safe evidence references', async () => {
    mocks.evidenceAll.mockResolvedValue([{
      id: 'evidence-id',
      caseId: 'case-id',
      evidenceType: 'MESSAGE',
      referenceType: 'Message',
      referenceId: 'message-id',
      attachedById: 'admin-id',
      storageRef: 'private-storage-key',
      metadataJson: '{"secret":true}',
      description: 'Relevant',
      createdAt: '2026-10-08T00:00:00.000Z',
    }]);
    const result = await service.getEvidence(admin, 'case-id');
    expect(result[0]).not.toHaveProperty('storageRef');
    expect(result[0]).not.toHaveProperty('metadataJson');
  });

  it('keeps assigned private cases inaccessible to unrelated administrators', async () => {
    mocks.caseFirst.mockResolvedValue({ ...openCase, assignedToId: 'other-admin' });
    await expect(service.getCase(admin, 'case-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects duplicate open manual moderation cases for the same target', async () => {
    mocks.caseAll.mockResolvedValue([{ ...openCase, status: 'OPEN' }]);
    await expect(service.createCase(admin, { subjectType: 'MESSAGE', subjectId: 'message-id', reason: 'Investigate duplicate case' }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
