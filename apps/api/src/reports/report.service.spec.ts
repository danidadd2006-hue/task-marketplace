import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userWhere: vi.fn(), userFirst: vi.fn(),
  reportWhere: vi.fn(), reportFirst: vi.fn(), reportCreate: vi.fn(),
  taskWhere: vi.fn(), taskFirst: vi.fn(),
  messageWhere: vi.fn(), messageFirst: vi.fn(),
  memberWhere: vi.fn(), memberFirst: vi.fn(),
  reviewWhere: vi.fn(), reviewFirst: vi.fn(),
  taskAttachmentWhere: vi.fn(), taskAttachmentFirst: vi.fn(),
  messageAttachmentWhere: vi.fn(), messageAttachmentFirst: vi.fn(),
  createCaseInTransaction: vi.fn(), addEvidence: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: { public: {
      User: { where: mocks.userWhere }, Report: { where: mocks.reportWhere },
      Task: { where: mocks.taskWhere }, Message: { where: mocks.messageWhere },
      ConversationMember: { where: mocks.memberWhere }, Review: { where: mocks.reviewWhere },
      TaskAttachment: { where: mocks.taskAttachmentWhere }, MessageAttachment: { where: mocks.messageAttachmentWhere },
    } },
  },
}));

import { ReportService } from './report.service.js';
import { ReportCategoryDto, ReportReasonDto, ReportTargetTypeDto } from './dto/create-report.dto.js';
import { ReportEvidenceReferenceTypeDto } from './dto/add-report-evidence.dto.js';

const reporter = { userId: 'reporter-id', email: 'reporter@example.com', roles: ['CLIENT'] as const };
const activeUser = { id: 'reporter-id', status: 'ACTIVE' };
const otherUser = { id: 'other-user', status: 'ACTIVE' };
const baseReport = {
  id: 'report-id', reporterId: 'reporter-id', targetType: 'TASK', targetId: 'task-id',
  category: 'CONTENT', reason: 'INAPPROPRIATE_CONTENT', description: 'A report description',
  status: 'OPEN', resolution: null, trustCaseId: 'case-id', activeKey: 'reporter-id:TASK:task-id',
  createdAt: '2026-10-07T01:00:00.000Z', updatedAt: '2026-10-07T01:00:00.000Z',
};

function tx() {
  return { orm: { public: {
    User: { where: mocks.userWhere }, Report: { where: mocks.reportWhere, create: mocks.reportCreate },
    Task: { where: mocks.taskWhere }, Message: { where: mocks.messageWhere },
    ConversationMember: { where: mocks.memberWhere }, Review: { where: mocks.reviewWhere },
  } } } as any;
}

describe('ReportService — Phase 6 Step 6.5', () => {
  const trustSafety = { createCaseInTransaction: mocks.createCaseInTransaction, addEvidence: mocks.addEvidence };
  const service = new ReportService(trustSafety as any);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.userFirst.mockResolvedValue(activeUser); mocks.userWhere.mockReturnValue({ first: mocks.userFirst });
    mocks.reportFirst.mockResolvedValue(null); mocks.reportWhere.mockReturnValue({ first: mocks.reportFirst });
    mocks.taskFirst.mockResolvedValue({ id: 'task-id', clientId: 'client-id' }); mocks.taskWhere.mockReturnValue({ first: mocks.taskFirst });
    mocks.messageFirst.mockResolvedValue({ id: 'message-id', conversationId: 'conversation-id' }); mocks.messageWhere.mockReturnValue({ first: mocks.messageFirst });
    mocks.memberFirst.mockResolvedValue({ id: 'membership-id' }); mocks.memberWhere.mockReturnValue({ first: mocks.memberFirst });
    mocks.reviewFirst.mockResolvedValue({ id: 'review-id' }); mocks.reviewWhere.mockReturnValue({ first: mocks.reviewFirst });
    mocks.taskAttachmentFirst.mockResolvedValue({ id: 'task-attachment', taskId: 'task-id' }); mocks.taskAttachmentWhere.mockReturnValue({ first: mocks.taskAttachmentFirst });
    mocks.messageAttachmentFirst.mockResolvedValue({ id: 'message-attachment', messageId: 'message-id' }); mocks.messageAttachmentWhere.mockReturnValue({ first: mocks.messageAttachmentFirst });
    mocks.createCaseInTransaction.mockResolvedValue({ id: 'case-id', type: 'REPORT', status: 'OPEN' });
    mocks.reportCreate.mockResolvedValue({ ...baseReport });
    mocks.addEvidence.mockResolvedValue({ id: 'evidence-id', evidenceType: 'ATTACHMENT', description: 'Relevant', createdAt: '2026-10-07T01:01:00.000Z', storageRef: 'secret', metadataJson: 'secret' });
  });

  it('creates a valid report with server-derived reporter identity', async () => {
    const result = await service.createReport(reporter, {
      targetType: ReportTargetTypeDto.TASK, targetId: 'task-id', category: ReportCategoryDto.CONTENT,
      reason: ReportReasonDto.INAPPROPRIATE_CONTENT, description: '  A report description  ',
    });
    expect(result.description).toBe('A report description');
    expect(mocks.reportCreate).toHaveBeenCalledWith(expect.objectContaining({ reporterId: 'reporter-id', activeKey: 'reporter-id:TASK:task-id', trustCaseId: 'case-id' }));
  });

  it('rejects inactive reporters', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'reporter-id', status: 'SUSPENDED' });
    await expect(service.createReport(reporter, { targetType: ReportTargetTypeDto.TASK, targetId: 'task-id', category: ReportCategoryDto.CONTENT, reason: ReportReasonDto.INAPPROPRIATE_CONTENT, description: 'Valid' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unsupported targets and missing targets', async () => {
    await expect(service.createReport(reporter, { targetType: 'VIDEO' as any, targetId: 'video-id', category: ReportCategoryDto.CONTENT, reason: ReportReasonDto.SPAM, description: 'Valid' })).rejects.toThrow('Unsupported report target');
    mocks.taskFirst.mockResolvedValue(null);
    await expect(service.createReport(reporter, { targetType: ReportTargetTypeDto.TASK, targetId: 'missing-task', category: ReportCategoryDto.CONTENT, reason: ReportReasonDto.SPAM, description: 'Valid' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates the reason taxonomy and required description', async () => {
    await expect(service.createReport(reporter, { targetType: ReportTargetTypeDto.TASK, targetId: 'task-id', category: ReportCategoryDto.PRIVACY, reason: ReportReasonDto.HARASSMENT, description: 'Invalid' })).rejects.toThrow('Invalid report reason for category');
    await expect(service.createReport(reporter, { targetType: ReportTargetTypeDto.TASK, targetId: 'task-id', category: ReportCategoryDto.CONTENT, reason: ReportReasonDto.OTHER, description: '   ' })).rejects.toThrow('Report description is required');
  });

  it('prevents account self-reporting', async () => {
    await expect(service.createReport(reporter, { targetType: ReportTargetTypeDto.USER, targetId: 'reporter-id', category: ReportCategoryDto.CONDUCT, reason: ReportReasonDto.HARASSMENT, description: 'Self report' })).rejects.toThrow('You cannot report your own account');
  });

  it('supports user, task, message and review target validation', async () => {
    mocks.userFirst.mockResolvedValueOnce(activeUser).mockResolvedValueOnce(otherUser);
    const cases = [
      [ReportTargetTypeDto.USER, 'other-user', ReportCategoryDto.CONDUCT, ReportReasonDto.HARASSMENT],
      [ReportTargetTypeDto.TASK, 'task-id', ReportCategoryDto.CONTENT, ReportReasonDto.SPAM],
      [ReportTargetTypeDto.MESSAGE, 'message-id', ReportCategoryDto.CONDUCT, ReportReasonDto.HARASSMENT],
      [ReportTargetTypeDto.REVIEW, 'review-id', ReportCategoryDto.AUTHENTICITY, ReportReasonDto.MISREPRESENTATION],
    ] as const;
    for (const [targetType, targetId, category, reason] of cases) {
      mocks.reportFirst.mockResolvedValue(null); mocks.reportCreate.mockResolvedValue({ ...baseReport, targetType, targetId, category, reason });
      await expect(service.createReport(reporter, { targetType, targetId, category, reason, description: 'Valid report' })).resolves.toBeTruthy();
    }
    expect(mocks.createCaseInTransaction).toHaveBeenCalledTimes(4);
  });

  it('does not allow reporting a private message without conversation membership', async () => {
    mocks.memberFirst.mockResolvedValue(null);
    await expect(service.createReport(reporter, { targetType: ReportTargetTypeDto.MESSAGE, targetId: 'message-id', category: ReportCategoryDto.CONDUCT, reason: ReportReasonDto.HARASSMENT, description: 'Private message' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate active reports before creating another case', async () => {
    mocks.reportFirst.mockResolvedValue({ ...baseReport });
    await expect(service.createReport(reporter, { targetType: ReportTargetTypeDto.TASK, targetId: 'task-id', category: ReportCategoryDto.CONTENT, reason: ReportReasonDto.SPAM, description: 'Duplicate' })).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.createCaseInTransaction).not.toHaveBeenCalled();
  });

  it('maps a concurrent database uniqueness failure to a deterministic conflict', async () => {
    mocks.reportCreate.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    await expect(service.createReport(reporter, { targetType: ReportTargetTypeDto.TASK, targetId: 'task-id', category: ReportCategoryDto.CONTENT, reason: ReportReasonDto.SPAM, description: 'Concurrent duplicate' })).rejects.toThrow('An active report already exists for this target');
  });

  it('creates the REPORT TrustCase with the exact target and stores the case linkage', async () => {
    await service.createReport(reporter, { targetType: ReportTargetTypeDto.REVIEW, targetId: 'review-id', category: ReportCategoryDto.AUTHENTICITY, reason: ReportReasonDto.MISREPRESENTATION, description: 'Misleading review' });
    expect(mocks.createCaseInTransaction).toHaveBeenCalledWith(expect.anything(), reporter, { type: 'REPORT', category: 'AUTHENTICITY', subjectType: 'REVIEW', subjectId: 'review-id' });
    expect(mocks.reportCreate).toHaveBeenCalledWith(expect.objectContaining({ trustCaseId: 'case-id' }));
  });

  it('keeps TrustCase internals out of the reporter projection and does not duplicate AuditLog history', async () => {
    const result = await service.createReport(reporter, { targetType: ReportTargetTypeDto.TASK, targetId: 'task-id', category: ReportCategoryDto.CONTENT, reason: ReportReasonDto.SPAM, description: 'Spam' });
    expect(Object.keys(result).sort()).toEqual(['category', 'createdAt', 'description', 'id', 'reason', 'resolution', 'status', 'targetId', 'targetType', 'updatedAt'].sort());
    expect(result).not.toHaveProperty('trustCaseId');
    expect(result).not.toHaveProperty('history');
  });

  it('returns only the reporter-owned report projection', async () => {
    mocks.reportFirst.mockResolvedValue({ ...baseReport });
    const result = await service.getMyReport(reporter, 'report-id');
    expect(result.id).toBe('report-id'); expect(result).not.toHaveProperty('reporterId'); expect(result).not.toHaveProperty('trustCaseId');
  });

  it('does not reveal another reporter report', async () => {
    await expect(service.getMyReport(reporter, 'other-report')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires active status for reads and evidence', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'reporter-id', status: 'BANNED' });
    await expect(service.getMyReport(reporter, 'report-id')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.addEvidence(reporter, 'report-id', { referenceType: ReportEvidenceReferenceTypeDto.TASK_ATTACHMENT, referenceId: 'task-attachment' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows only same-target task attachments as evidence and strips private metadata', async () => {
    mocks.reportFirst.mockResolvedValue({ ...baseReport, targetType: 'TASK', targetId: 'task-id' });
    const result = await service.addEvidence(reporter, 'report-id', { referenceType: ReportEvidenceReferenceTypeDto.TASK_ATTACHMENT, referenceId: 'task-attachment', description: 'Supporting file' });
    expect(mocks.addEvidence).toHaveBeenCalledWith(reporter, 'case-id', expect.objectContaining({ evidenceType: 'ATTACHMENT', referenceType: 'TaskAttachment', referenceId: 'task-attachment' }));
    expect(result).toEqual({ id: 'evidence-id', evidenceType: 'ATTACHMENT', description: 'Relevant', createdAt: '2026-10-07T01:01:00.000Z' });
  });

  it('allows same-target message attachments only through the private conversation boundary', async () => {
    mocks.reportFirst.mockResolvedValue({ ...baseReport, targetType: 'MESSAGE', targetId: 'message-id' });
    await expect(service.addEvidence(reporter, 'report-id', { referenceType: ReportEvidenceReferenceTypeDto.MESSAGE_ATTACHMENT, referenceId: 'message-attachment' })).resolves.toMatchObject({ id: 'evidence-id' });
  });

  it('rejects unrelated evidence and evidence on closed reports', async () => {
    mocks.reportFirst.mockResolvedValue({ ...baseReport, targetType: 'TASK', targetId: 'task-id' });
    mocks.taskAttachmentFirst.mockResolvedValue({ id: 'other', taskId: 'other-task' });
    await expect(service.addEvidence(reporter, 'report-id', { referenceType: ReportEvidenceReferenceTypeDto.TASK_ATTACHMENT, referenceId: 'other' })).rejects.toBeInstanceOf(NotFoundException);
    mocks.reportFirst.mockResolvedValue({ ...baseReport, status: 'RESOLVED' });
    await expect(service.addEvidence(reporter, 'report-id', { referenceType: ReportEvidenceReferenceTypeDto.TASK_ATTACHMENT, referenceId: 'task-attachment' })).rejects.toThrow('Evidence cannot be added to a closed report');
  });

  it('does not offer an ordinary-user status mutation path', () => {
    expect(service).not.toHaveProperty('updateReportStatus');
    expect(service).not.toHaveProperty('resolveReport');
    expect(service).not.toHaveProperty('dismissReport');
  });

  it('reconstructs report provenance through report and case creation linkage', async () => {
    const created = await service.createReport(reporter, { targetType: ReportTargetTypeDto.TASK, targetId: 'task-id', category: ReportCategoryDto.CONTENT, reason: ReportReasonDto.SPAM, description: 'Spam task' });
    expect(created.targetType).toBe('TASK');
    expect(mocks.createCaseInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'reporter-id' }), expect.objectContaining({ subjectType: 'TASK', subjectId: 'task-id' }));
    expect(mocks.reportCreate).toHaveBeenCalledWith(expect.objectContaining({ reporterId: 'reporter-id', trustCaseId: 'case-id', reason: 'SPAM' }));
  });
});
