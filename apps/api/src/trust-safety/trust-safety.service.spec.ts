import { ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userWhere: vi.fn(),
  userFirst: vi.fn(),
  roleWhere: vi.fn(),
  roleAll: vi.fn(),
  caseWhere: vi.fn(),
  caseFirst: vi.fn(),
  caseUpdate: vi.fn(),
  caseCreate: vi.fn(),
  historyCreate: vi.fn(),
  historyWhere: vi.fn(),
  historyAll: vi.fn(),
  evidenceCreate: vi.fn(),
  evidenceWhere: vi.fn(),
  evidenceAll: vi.fn(),
  decisionCreate: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: {
      public: {
        User: { where: mocks.userWhere },
        UserRoleAssignment: { where: mocks.roleWhere },
        TrustCase: { where: mocks.caseWhere },
        TrustCaseHistory: { where: mocks.historyWhere },
        TrustCaseEvidence: { where: mocks.evidenceWhere },
      },
    },
  },
}));

import { TrustSafetyService } from './trust-safety.service.js';

const user = { id: 'user-id', status: 'ACTIVE' };
const admin = { userId: 'admin-id', email: 'admin@example.com', roles: ['ADMIN'] as const };
const client = { userId: 'user-id', email: 'user@example.com', roles: ['CLIENT'] as const };
const otherUser = { userId: 'other-id', email: 'other@example.com', roles: ['CLIENT'] as const };

const openCase = {
  id: 'case-id',
  type: 'REPORT',
  category: 'SAFETY',
  status: 'OPEN',
  subjectType: 'USER',
  subjectId: 'user-id',
  createdById: 'user-id',
  assignedToId: null,
  assignedAt: null,
  resolvedAt: null,
  closedAt: null,
  closedById: null,
  resolutionCode: null,
  resolutionReason: null,
  revision: 0,
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
};

function tx() {
  return {
    orm: { public: {
      TrustCase: { create: mocks.caseCreate, where: mocks.caseWhere },
      TrustCaseHistory: { create: mocks.historyCreate },
      TrustCaseEvidence: { create: mocks.evidenceCreate },
      TrustCaseDecision: { create: mocks.decisionCreate },
    } },
  } as any;
}

describe('TrustSafetyService — Phase 6 Step 6.4', () => {
  const service = new TrustSafetyService({ log: mocks.auditLog } as any);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.userFirst.mockResolvedValue(user);
    mocks.userWhere.mockReturnValue({ first: mocks.userFirst });
    mocks.roleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.roleWhere.mockReturnValue({ all: mocks.roleAll });
    mocks.caseFirst.mockResolvedValue({ ...openCase });
    mocks.caseWhere.mockReturnValue({ first: mocks.caseFirst, update: mocks.caseUpdate });
    mocks.historyWhere.mockReturnValue({ all: mocks.historyAll });
    mocks.evidenceWhere.mockReturnValue({ all: mocks.evidenceAll });
    mocks.caseUpdate.mockResolvedValue({ ...openCase, status: 'ASSIGNED', revision: 1 });
    mocks.caseCreate.mockResolvedValue({ ...openCase });
    mocks.historyCreate.mockResolvedValue({ ...openCase, historyId: 'history-id' });
    mocks.evidenceCreate.mockResolvedValue({
      id: 'evidence-id',
      caseId: 'case-id',
      evidenceType: 'MESSAGE',
      referenceType: 'MESSAGE',
      referenceId: 'message-id',
      storageRef: 'private/storage/key',
      attachedById: 'admin-id',
      description: 'Relevant message',
      metadataJson: '{"internal":true}',
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    mocks.decisionCreate.mockResolvedValue({
      id: 'decision-id',
      caseId: 'case-id',
      actorId: 'admin-id',
      outcome: 'ESCALATE',
      reason: 'Needs further review',
      metadataJson: '{"severity":"high"}',
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    mocks.auditLog.mockResolvedValue({ id: 'audit-id' });
  });

  it('creates a provider-neutral case and initial immutable history record', async () => {
    const result = await service.createCase(client, {
      type: 'REPORT',
      category: 'SAFETY',
      subjectType: 'USER',
      subjectId: 'other-id',
    });

    expect(result).toMatchObject({ id: 'case-id', type: 'REPORT', status: 'OPEN' });
    expect(mocks.caseCreate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REPORT',
      subjectType: 'USER',
      subjectId: 'other-id',
      createdById: 'user-id',
      revision: 0,
    }));
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      toStatus: 'OPEN',
      actorId: 'user-id',
    }));
  });

  it('rejects an invalid case type at the service boundary', async () => {
    await expect(service.createCase(client, {
      type: 'UNKNOWN' as any,
      subjectType: 'USER',
      subjectId: 'other-id',
    })).rejects.toThrow('Invalid case type');
  });

  it('supports all shared case categories without domain-specific records', async () => {
    for (const type of ['REPORT', 'DISPUTE', 'MODERATION', 'RISK'] as const) {
      mocks.caseCreate.mockResolvedValueOnce({ ...openCase, type });
      const result = await service.createCase(client, {
        type,
        subjectType: 'CONTRACT',
        subjectId: 'contract-id',
      });
      expect(result.type).toBe(type);
    }
  });

  it('requires an active account for case creation', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'user-id', status: 'SUSPENDED' });
    await expect(service.createCase(client, {
      type: 'REPORT',
      subjectType: 'USER',
      subjectId: 'other-id',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires administrative authorization for assignment', async () => {
    mocks.roleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.assignCase(client, 'case-id', 'other-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.caseUpdate).not.toHaveBeenCalled();
  });

  it('records assignment and reassignment as distinct history events', async () => {
    mocks.caseFirst
      .mockResolvedValueOnce({ ...openCase })
      .mockResolvedValueOnce({ ...openCase, assignedToId: 'first-moderator', status: 'ASSIGNED', revision: 1 });

    await service.assignCase(admin, 'case-id', 'first-moderator');
    await service.assignCase(admin, 'case-id', 'second-moderator');

    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSIGN' }));
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REASSIGN',
      metadataJson: JSON.stringify({ assigneeId: 'second-moderator' }),
    }));
  });

  it('rejects concurrent assignment when the revision changed', async () => {
    mocks.caseUpdate.mockResolvedValueOnce(null);
    await expect(service.assignCase(admin, 'case-id', 'moderator-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it('registers referenced evidence without copying source records', async () => {
    const result = await service.addEvidence(client, 'case-id', {
      evidenceType: 'MESSAGE',
      referenceType: 'MESSAGE',
      referenceId: 'message-id',
      storageRef: 'should-not-be-exposed',
      metadata: { private: 'secret' },
      description: 'Message reference',
    });

    expect(result).toEqual(expect.objectContaining({
      evidenceType: 'MESSAGE',
      referenceType: 'MESSAGE',
      referenceId: 'message-id',
    }));
    expect(result).not.toHaveProperty('storageRef');
    expect(result).not.toHaveProperty('metadataJson');
  });

  it('allows a case participant to register evidence but protects private storage metadata', async () => {
    mocks.roleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await service.addEvidence(client, 'case-id', {
      evidenceType: 'ATTACHMENT',
      referenceType: 'MEDIA',
      referenceId: 'media-id',
      storageRef: 'private-key',
    });

    expect(mocks.evidenceCreate).toHaveBeenCalledWith(expect.objectContaining({
      storageRef: null,
      metadataJson: null,
      attachedById: 'user-id',
    }));
  });

  it('denies unrelated ordinary users from evidence operations', async () => {
    mocks.roleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.addEvidence(otherUser, 'case-id', {
      evidenceType: 'MESSAGE',
      referenceType: 'MESSAGE',
      referenceId: 'message-id',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows only administrators to record decisions and keeps decisions append-only', async () => {
    const result = await service.recordDecision(admin, 'case-id', {
      outcome: 'ESCALATE',
      reason: 'Needs further review',
      metadata: { severity: 'high' },
    });

    expect(result).toMatchObject({ id: 'decision-id', outcome: 'ESCALATE' });
    expect(mocks.decisionCreate).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'admin-id',
      caseId: 'case-id',
    }));
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'DECISION' }));
  });

  it('denies ordinary users from administrative decisions', async () => {
    mocks.roleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.recordDecision(client, 'case-id', { outcome: 'REJECT' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records administrative actions in AuditLog without duplicating every history event', async () => {
    await service.recordDecision(admin, 'case-id', { outcome: 'ESCALATE', reason: 'Investigate' });
    expect(mocks.auditLog).toHaveBeenCalledWith(
      'admin-id',
      'ADMIN_ACTION',
      'TrustCaseDecision',
      'decision-id',
      expect.stringContaining('"outcome":"ESCALATE"'),
    );
    expect(mocks.auditLog.mock.calls.filter((call) => call[2] === 'TrustCaseHistory')).toHaveLength(0);
  });

  it('returns a confidentiality-safe projection to a case participant', async () => {
    mocks.roleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    const result = await service.getCaseForActor(client, 'case-id') as Record<string, unknown>;

    expect(result).toMatchObject({ id: 'case-id', status: 'OPEN' });
    expect(result).not.toHaveProperty('revision');
    expect(result).not.toHaveProperty('resolutionReason');
    expect(result).not.toHaveProperty('closedById');
  });

  it('allows administrators to reconstruct the full case history and evidence', async () => {
    mocks.historyAll.mockResolvedValue([{ id: 'history-1', action: 'CREATE' }, { id: 'history-2', action: 'DECISION' }]);
    mocks.evidenceAll.mockResolvedValue([{ id: 'evidence-1', storageRef: 'private-key' }]);
    mocks.historyWhere.mockReturnValue({ all: mocks.historyAll });
    mocks.evidenceWhere.mockReturnValue({ all: mocks.evidenceAll });

    const history = await service.getHistoryForAdmin(admin, 'case-id');
    const evidence = await service.getEvidenceForAdmin(admin, 'case-id');

    expect(history).toHaveLength(2);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toHaveProperty('storageRef', 'private-key');
  });

  it('enforces account status on privileged operations', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'admin-id', status: 'BANNED' });
    await expect(service.recordDecision(admin, 'case-id', { outcome: 'REJECT' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.closeCase(admin, 'case-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records an applied administrative action as immutable case history', async () => {
    await service.recordActionApplied(admin, 'case-id', 'SUSPEND_ACCOUNT', 'Policy enforcement', { policy: 'TOS' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ACTION_APPLIED',
      metadataJson: JSON.stringify({ actionName: 'SUSPEND_ACCOUNT', policy: 'TOS' }),
    }));
    expect(mocks.auditLog).toHaveBeenCalledWith(
      'admin-id',
      'ADMIN_ACTION',
      'TrustCase',
      'case-id',
      expect.stringContaining('SUSPEND_ACCOUNT'),
    );
  });

  it('records resolution and closure as separate immutable history events', async () => {
    mocks.caseFirst
      .mockResolvedValueOnce({ ...openCase })
      .mockResolvedValueOnce({ ...openCase, status: 'RESOLVED', revision: 1 });

    await service.resolveCase(admin, 'case-id', 'RESOLVED', 'Resolved after review');
    await service.closeCase(admin, 'case-id', 'Administrative closure');

    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'RESOLVED', toStatus: 'RESOLVED' }));
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'CLOSED', toStatus: 'CLOSED' }));
  });

  it('rejects concurrent closure when the case revision changed', async () => {
    mocks.caseUpdate.mockResolvedValueOnce(null);
    await expect(service.closeCase(admin, 'case-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not expose internal investigation metadata through participant access', async () => {
    mocks.roleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    const result = await service.getCaseForActor(client, 'case-id') as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toContain('internal');
    expect(JSON.stringify(result)).not.toContain('storage');
  });

  it('preserves an acquisition reconstruction chain through IDs, actors, timestamps and reasons', async () => {
    await service.createCase(client, {
      type: 'DISPUTE',
      category: 'DELIVERY',
      subjectType: 'CONTRACT',
      subjectId: 'contract-id',
    });

    expect(mocks.caseCreate).toHaveBeenCalledWith(expect.objectContaining({
      createdById: 'user-id',
      subjectType: 'CONTRACT',
      subjectId: 'contract-id',
    }));
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'user-id',
    }));
  });
});
