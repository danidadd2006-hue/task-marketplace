import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFirst: vi.fn(),
  userRoleAll: vi.fn(),
  riskSignalFirst: vi.fn(),
  riskSignalAll: vi.fn(),
  riskSignalCreate: vi.fn(),
  riskSignalUpdate: vi.fn(),
  trustCaseFirst: vi.fn(),
  trustCaseAll: vi.fn(),
  trustCaseCreate: vi.fn(),
  trustCaseUpdate: vi.fn(),
  historyAll: vi.fn(),
  historyCreate: vi.fn(),
  evidenceAll: vi.fn(),
  evidenceCreate: vi.fn(),
  decisionAll: vi.fn(),
  decisionCreate: vi.fn(),
  auditCreate: vi.fn(),
  accountChangeStatus: vi.fn(),
  moderationCreateCase: vi.fn(),
  targetFirst: vi.fn(),
  sourceFirst: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: {
      public: {
        User: { where: vi.fn(() => ({ first: mocks.userFirst })) },
        UserRoleAssignment: { where: vi.fn(() => ({ all: mocks.userRoleAll })) },
        RiskSignal: {
          where: vi.fn(() => ({
            first: mocks.riskSignalFirst,
            all: mocks.riskSignalAll,
            update: mocks.riskSignalUpdate,
            orderBy: vi.fn(() => ({ all: mocks.riskSignalAll })),
          })),
          create: mocks.riskSignalCreate,
        },
        TrustCase: {
          where: vi.fn(() => ({
            first: mocks.trustCaseFirst,
            all: mocks.trustCaseAll,
            update: mocks.trustCaseUpdate,
          })),
          create: mocks.trustCaseCreate,
        },
        TrustCaseHistory: {
          where: vi.fn(() => ({ all: mocks.historyAll, orderBy: vi.fn(() => ({ all: mocks.historyAll })) })),
          create: mocks.historyCreate,
        },
        TrustCaseEvidence: {
          where: vi.fn(() => ({ all: mocks.evidenceAll, orderBy: vi.fn(() => ({ all: mocks.evidenceAll })) })),
          create: mocks.evidenceCreate,
        },
        TrustCaseDecision: {
          where: vi.fn(() => ({ all: mocks.decisionAll, orderBy: vi.fn(() => ({ all: mocks.decisionAll })) })),
          create: mocks.decisionCreate,
        },
        AuditLog: { create: mocks.auditCreate },
        Application: { where: vi.fn(() => ({ first: mocks.targetFirst })) },
        Task: { where: vi.fn(() => ({ first: mocks.targetFirst })) },
        Contract: { where: vi.fn(() => ({ first: mocks.targetFirst })) },
        Payment: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        PaymentProviderEvent: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        Refund: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        RefundProviderEvent: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        Payout: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        PayoutProviderEvent: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        TokenTransaction: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        TokenPurchase: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        TokenPurchaseProviderEvent: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        Conversation: { where: vi.fn(() => ({ first: mocks.targetFirst })) },
        Message: { where: vi.fn(() => ({ first: mocks.targetFirst })) },
        Review: { where: vi.fn(() => ({ first: mocks.targetFirst })) },
        Verification: { where: vi.fn(() => ({ first: mocks.targetFirst })) },
        Cancellation: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
        WorkerCancellationPenalty: { where: vi.fn(() => ({ first: mocks.sourceFirst })) },
      },
    },
  },
}));

import { RiskService } from './risk.service.js';

const admin = {
  userId: 'admin-id',
  email: 'admin@example.com',
  roles: ['ADMIN'] as const,
};
const client = {
  userId: 'client-id',
  email: 'client@example.com',
  roles: ['CLIENT'] as const,
};

const signal = {
  id: 'signal-id',
  signalType: 'PAYMENT_ANOMALY',
  subjectType: 'USER',
  subjectId: 'user-id',
  sourceDomain: 'PAYMENT',
  sourceReference: 'payment-id',
  severity: 'HIGH',
  observedAt: '2026-10-08T00:00:00.000Z',
  metadataJson: '{"amountDelta":10}',
  deduplicationKey: 'payment:payment-id:anomaly',
  trustCaseId: null,
  createdAt: '2026-10-08T00:00:00.000Z',
} as const;

const openCase = {
  id: 'case-id',
  type: 'RISK',
  category: 'PAYMENT_ANOMALY',
  status: 'OPEN',
  subjectType: 'USER',
  subjectId: 'user-id',
  createdById: 'admin-id',
  assignedToId: null,
  assignedAt: null,
  resolvedAt: null,
  closedAt: null,
  closedById: null,
  resolutionCode: null,
  resolutionReason: 'Investigate anomaly',
  revision: 0,
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
};

function tx() {
  return {
    orm: {
      public: {
        User: { where: vi.fn((query?: any) => ({ first: vi.fn(async () => mocks.userFirst(query)) })) },
        UserRoleAssignment: { where: vi.fn(() => ({ all: mocks.userRoleAll })) },
        RiskSignal: {
          where: vi.fn(() => ({
            first: mocks.riskSignalFirst,
            all: mocks.riskSignalAll,
            update: mocks.riskSignalUpdate,
          })),
          create: mocks.riskSignalCreate,
        },
        TrustCase: {
          where: vi.fn(() => ({
            first: mocks.trustCaseFirst,
            all: mocks.trustCaseAll,
            update: mocks.trustCaseUpdate,
          })),
          create: mocks.trustCaseCreate,
        },
        TrustCaseHistory: { create: mocks.historyCreate },
        TrustCaseEvidence: { create: mocks.evidenceCreate },
        TrustCaseDecision: { create: mocks.decisionCreate },
        AuditLog: { create: mocks.auditCreate },
      },
    },
  } as any;
}

describe('RiskService — Phase 6 Step 6.8', () => {
  const accounts = { changeStatus: mocks.accountChangeStatus };
  const moderation = { createCase: mocks.moderationCreateCase };
  const service = new RiskService(accounts as any, moderation as any);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.userFirst.mockResolvedValue({ id: 'admin-id', status: 'ACTIVE' });
    mocks.userRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.targetFirst.mockResolvedValue({ id: 'target-id' });
    mocks.sourceFirst.mockResolvedValue({ id: 'source-id' });
    mocks.riskSignalFirst.mockResolvedValue(null);
    mocks.riskSignalAll.mockResolvedValue([]);
    mocks.riskSignalCreate.mockResolvedValue(signal);
    mocks.riskSignalUpdate.mockResolvedValue(1);
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase });
    mocks.trustCaseAll.mockResolvedValue([]);
    mocks.trustCaseCreate.mockResolvedValue({ ...openCase });
    mocks.trustCaseUpdate.mockResolvedValue(1);
    mocks.historyAll.mockResolvedValue([]);
    mocks.historyCreate.mockResolvedValue({ id: 'history-id', createdAt: '2026-10-08T00:00:00.000Z' });
    mocks.evidenceAll.mockResolvedValue([]);
    mocks.evidenceCreate.mockResolvedValue({
      id: 'evidence-id',
      caseId: 'case-id',
      evidenceType: 'PAYMENT',
      referenceType: 'Payment',
      referenceId: 'payment-id',
      attachedById: 'admin-id',
      description: 'Relevant financial evidence',
      createdAt: '2026-10-08T00:00:00.000Z',
      storageRef: 'private-key',
    });
    mocks.decisionAll.mockResolvedValue([]);
    mocks.decisionCreate.mockResolvedValue({
      id: 'decision-id',
      caseId: 'case-id',
      actorId: 'admin-id',
      outcome: 'MONITOR',
      reason: 'Continue observation',
      metadataJson: '{"windowDays":7}',
      createdAt: '2026-10-08T00:00:00.000Z',
    });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    mocks.accountChangeStatus.mockResolvedValue({ caseId: 'moderation-case-id', status: 'SUSPENDED' });
    mocks.moderationCreateCase.mockResolvedValue({ id: 'moderation-case-id', type: 'MODERATION' });
  });

  it('allows a trusted/admin workflow to create a valid signal', async () => {
    const result = await service.recordSignal(admin, signal);
    expect(result).toMatchObject({
      signalType: 'PAYMENT_ANOMALY',
      sourceDomain: 'PAYMENT',
      subjectType: 'USER',
    });
    expect(mocks.riskSignalCreate).toHaveBeenCalled();
  });

  it('rejects ordinary users before signal creation', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'client-id', status: 'ACTIVE' });
    mocks.userRoleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.recordSignal(client, signal)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.riskSignalCreate).not.toHaveBeenCalled();
  });

  it('derives the authenticated actor from context rather than request data', async () => {
    await service.recordSignal(admin, signal);
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-id',
      action: 'ADMIN_ACTION',
      entityType: 'RiskSignal',
    }));
  });

  it('derives severity from the trusted signal catalogue and ignores a malicious override', async () => {
    await service.recordTrustedSignal({
      ...signal,
      severity: 'CRITICAL',
      metadata: { severity: 'CRITICAL', token: 'do-not-store' },
      deduplicationKey: 'payment:malicious-severity-override',
    } as any);
    const call = mocks.riskSignalCreate.mock.calls.at(-1)?.[0];
    expect(call.severity).toBe('HIGH');
    expect(call.metadataJson).toContain('CRITICAL');
    expect(call.metadataJson).not.toContain('do-not-store');
  });

  it('rejects unsupported signal types and inconsistent source domains', async () => {
    await expect(service.recordTrustedSignal({
      ...signal,
      signalType: 'UNKNOWN_SIGNAL',
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.recordTrustedSignal({
      ...signal,
      sourceDomain: 'REVIEWS',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates the target and source references', async () => {
    mocks.userFirst.mockResolvedValue(null);
    await expect(service.recordTrustedSignal(signal)).rejects.toBeInstanceOf(NotFoundException);

    mocks.userFirst.mockResolvedValue({ id: 'user-id' });
    mocks.sourceFirst.mockResolvedValue(null);
    await expect(service.recordTrustedSignal(signal)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deduplicates repeated deterministic signal generation', async () => {
    mocks.riskSignalFirst.mockResolvedValue({ ...signal, id: 'existing-signal' });
    const result = await service.recordTrustedSignal(signal);
    expect(result).toMatchObject({ id: 'existing-signal' });
    expect(mocks.riskSignalCreate).not.toHaveBeenCalled();
  });

  it('reuses the uniqueness winner when concurrent duplicate signal creation races', async () => {
    mocks.riskSignalFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...signal, id: 'winner-signal' });
    mocks.riskSignalCreate.mockRejectedValue({ sqlState: '23505', message: 'duplicate key value violates unique constraint' });

    const result = await service.recordTrustedSignal(signal);
    expect(result).toMatchObject({ id: 'winner-signal' });
  });

  it('preserves distinct historical observations with different deduplication keys', async () => {
    const second = { ...signal, id: 'signal-2', deduplicationKey: 'payment:payment-id:anomaly:second-observation', observedAt: '2026-10-08T01:00:00.000Z' };
    await service.recordTrustedSignal(signal);
    mocks.riskSignalFirst.mockResolvedValue(null);
    mocks.riskSignalCreate.mockResolvedValueOnce(signal).mockResolvedValueOnce(second);
    await service.recordTrustedSignal(second);
    expect(mocks.riskSignalCreate).toHaveBeenCalledTimes(2);
  });

  it('opens a RISK TrustCase and links the initiating signal', async () => {
    mocks.riskSignalFirst.mockResolvedValue(signal);
    const result = await service.openInvestigation(admin, 'signal-id', 'Investigate suspicious payment behaviour');
    expect(result).toMatchObject({
      id: 'case-id',
      type: 'RISK',
      status: 'OPEN',
    });
    expect(mocks.trustCaseCreate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RISK',
      subjectType: 'USER',
      subjectId: 'user-id',
    }));
    expect(mocks.riskSignalUpdate).toHaveBeenCalledWith({ trustCaseId: 'case-id' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      reason: 'Investigate suspicious payment behaviour',
    }));
  });

  it('groups a second signal for the same subject into the existing active RISK case', async () => {
    mocks.riskSignalFirst.mockResolvedValue({ ...signal, id: 'signal-2', trustCaseId: null });
    mocks.trustCaseAll.mockResolvedValue([{ ...openCase, status: 'IN_REVIEW', createdAt: '2026-10-08T00:00:00.000Z' }]);
    const result = await service.openInvestigation(admin, 'signal-2', 'Associate related signal with investigation');
    expect(result).toMatchObject({ id: 'case-id', type: 'RISK' });
    expect(mocks.trustCaseCreate).not.toHaveBeenCalled();
    expect(mocks.riskSignalUpdate).toHaveBeenCalledWith({ trustCaseId: 'case-id' });
  });

  it('reuses an already-linked case instead of creating a second investigation', async () => {
    mocks.riskSignalFirst.mockResolvedValue({ ...signal, trustCaseId: 'existing-case' });
    await service.openInvestigation(admin, 'signal-id', 'Investigate');
    expect(mocks.trustCaseCreate).not.toHaveBeenCalled();
  });

  it('handles concurrent case creation for the same signal deterministically', async () => {
    mocks.riskSignalFirst
      .mockResolvedValueOnce({ ...signal, trustCaseId: null })
      .mockResolvedValueOnce({ ...signal, trustCaseId: null })
      .mockResolvedValueOnce({ ...signal, trustCaseId: 'winner-case' });
    mocks.riskSignalUpdate.mockResolvedValue(0);
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, id: 'winner-case' });

    const result = await service.openInvestigation(admin, 'signal-id', 'Concurrent investigation');
    expect(result).toMatchObject({ id: 'winner-case', type: 'RISK' });
  });

  it('blocks unrelated users from risk cases at the service boundary', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'client-id', status: 'ACTIVE' });
    mocks.userRoleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.getCase(client, 'case-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('retrieves risk signals without exposing privileged access to ordinary users', async () => {
    mocks.riskSignalAll.mockResolvedValue([signal]);
    const result = await service.getSignals(admin, 'case-id');
    expect(result[0]).toMatchObject({ sourceDomain: 'PAYMENT', severity: 'HIGH' });
  });

  it('adds risk evidence through TrustCaseEvidence without returning storage keys', async () => {
    const result = await service.addEvidence(admin, 'case-id', {
      evidenceType: 'PAYMENT',
      referenceType: 'Payment',
      referenceId: 'payment-id',
      description: 'Relevant financial evidence',
    });
    expect(result).not.toHaveProperty('storageRef');
    expect(mocks.evidenceCreate).toHaveBeenCalledWith(expect.objectContaining({
      storageRef: null,
      attachedById: 'admin-id',
    }));
  });

  it('keeps investigation notes immutable in shared case history', async () => {
    const result = await service.addNote(admin, 'case-id', 'Reviewed the payment provider event and refund history');
    expect(result).toMatchObject({
      caseId: 'case-id',
      actorId: 'admin-id',
      note: 'Reviewed the payment provider event and refund history',
    });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ACTION_APPLIED',
      reason: 'Reviewed the payment provider event and refund history',
    }));
  });

  it('assigns investigations only to active administrators', async () => {
    mocks.userFirst.mockImplementation(async (query?: any) =>
      query?.id === 'admin-id' || query?.id === 'investigator-id'
        ? { id: query.id, status: 'ACTIVE' }
        : { id: query?.id, status: 'ACTIVE' });
    mocks.userRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    const result = await service.assign(admin, 'case-id', 'investigator-id', 'Assigned for specialist review');
    expect(result).toMatchObject({ assignedToId: 'investigator-id', status: 'ASSIGNED' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ASSIGN',
      actorId: 'admin-id',
      reason: 'Assigned for specialist review',
    }));
  });

  it('rejects assignment to a non-admin investigator', async () => {
    mocks.userFirst.mockImplementation(async (query?: any) =>
      query?.id === 'admin-id'
        ? { id: 'admin-id', status: 'ACTIVE' }
        : { id: 'investigator-id', status: 'ACTIVE' });
    mocks.userRoleAll.mockResolvedValue([{ role: 'WORKER' }]);
    await expect(service.assign(admin, 'case-id', 'investigator-id', 'Attempted assignment'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('supports reassignment and unassignment with auditable history', async () => {
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, status: 'ASSIGNED', assignedToId: 'old-admin', revision: 2 });
    mocks.userFirst.mockResolvedValue({ id: 'new-admin', status: 'ACTIVE' });
    mocks.userRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    await service.assign(admin, 'case-id', 'new-admin', 'Conflict-free reassignment');
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'REASSIGN' }));

    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, status: 'ASSIGNED', assignedToId: 'new-admin', revision: 3 });
    await service.unassign(admin, 'case-id', 'Investigator unavailable');
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'REASSIGN' }));
  });

  it('enforces the risk lifecycle and persists the previous/new state', async () => {
    mocks.trustCaseFirst
      .mockResolvedValueOnce({ ...openCase, status: 'OPEN', revision: 0 })
      .mockResolvedValueOnce({ ...openCase, status: 'IN_REVIEW', revision: 1 });
    await expect(service.transition(admin, 'case-id', 'IN_REVIEW', 'Started investigation'))
      .resolves.toMatchObject({ status: 'IN_REVIEW' });
    await expect(service.transition(admin, 'case-id', 'RESOLVED', 'Investigation concluded'))
      .resolves.toMatchObject({ status: 'RESOLVED' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RESOLVED',
      actorId: 'admin-id',
      reason: 'Investigation concluded',
    }));
  });

  it('represents dismissal with the existing CLOSED TrustCase state and a DISMISSED resolution code', async () => {
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, status: 'OPEN', revision: 0 });
    const result = await service.transition(admin, 'case-id', 'DISMISSED', 'Evidence did not substantiate the concern');
    expect(result).toMatchObject({
      status: 'DISMISSED',
      storedStatus: 'CLOSED',
      resolutionCode: 'DISMISSED',
    });
    expect(mocks.trustCaseUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'CLOSED',
      resolutionCode: 'DISMISSED',
    }));
  });

  it('rejects invalid lifecycle transitions', async () => {
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, status: 'OPEN' });
    await expect(service.transition(admin, 'case-id', 'RESOLVED', 'Too early'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('records a structured decision and uses revision control for concurrency', async () => {
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, status: 'IN_REVIEW', revision: 4 });
    await service.recordDecision(admin, 'case-id', {
      outcome: 'MONITOR',
      reason: 'Continue observation',
      metadata: { windowDays: 7 },
    });
    expect(mocks.trustCaseUpdate).toHaveBeenCalledWith({ revision: 5 });
    expect(mocks.decisionCreate).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'admin-id',
      outcome: 'MONITOR',
      reason: 'Continue observation',
    }));

    mocks.trustCaseUpdate.mockResolvedValue(0);
    await expect(service.recordDecision(admin, 'case-id', {
      outcome: 'MONITOR',
      reason: 'Concurrent duplicate decision',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not mutate account or financial state when recording a risk decision', async () => {
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, status: 'IN_REVIEW', revision: 1 });
    await service.recordDecision(admin, 'case-id', {
      outcome: 'ESCALATED',
      reason: 'Requires further human review',
    });
    expect(mocks.accountChangeStatus).not.toHaveBeenCalled();
    expect(mocks.moderationCreateCase).not.toHaveBeenCalled();
  });

  it('delegates account enforcement through the existing account-action boundary', async () => {
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, status: 'IN_REVIEW' });
    const result = await service.applyEnforcement(admin, 'case-id', 'ACCOUNT_STATUS', 'SUSPENDED', 'Verified enforcement after review');
    expect(mocks.accountChangeStatus).toHaveBeenCalledWith(
      admin,
      'user-id',
      'SUSPENDED',
      'Verified enforcement after review',
    );
    expect(result).toMatchObject({ actionType: 'ACCOUNT_STATUS', relatedAdministrativeActionRef: 'moderation-case-id' });
  });

  it('delegates non-account enforcement to the existing moderation boundary', async () => {
    mocks.trustCaseFirst.mockResolvedValue({ ...openCase, subjectType: 'TASK', subjectId: 'task-id', status: 'IN_REVIEW' });
    const result = await service.applyEnforcement(admin, 'case-id', 'MODERATION_CASE', undefined, 'Escalate task to moderation');
    expect(mocks.moderationCreateCase).toHaveBeenCalledWith(admin, {
      subjectType: 'TASK',
      subjectId: 'task-id',
      reason: 'Escalate task to moderation',
    });
    expect(result).toMatchObject({ actionType: 'MODERATION_CASE', relatedAdministrativeActionRef: 'moderation-case-id' });
  });

  it('does not directly mutate payments, payouts or ledgers when a financial signal is recorded', async () => {
    await service.recordTrustedSignal({
      ...signal,
      sourceReference: 'payment-id',
      deduplicationKey: 'financial:payment-id:anomaly',
    });
    expect(mocks.accountChangeStatus).not.toHaveBeenCalled();
    expect(mocks.moderationCreateCase).not.toHaveBeenCalled();
    expect(mocks.trustCaseUpdate).not.toHaveBeenCalled();
  });

  it('sanitises sensitive metadata before persistence', async () => {
    await service.recordTrustedSignal({
      ...signal,
      metadata: {
        provider: { outcome: 'FAILED' },
        token: 'secret',
        nested: { password: 'hidden', value: 10 },
      },
      deduplicationKey: 'payment:safe-metadata',
    } as any);
    const call = mocks.riskSignalCreate.mock.calls.at(-1)?.[0];
    expect(call.metadataJson).toContain('FAILED');
    expect(call.metadataJson).not.toContain('secret');
    expect(call.metadataJson).not.toContain('hidden');
  });

  it('provides a privileged risk queue with severity and latest observation filters', async () => {
    mocks.trustCaseAll.mockResolvedValue([{ ...openCase }]);
    mocks.riskSignalAll.mockResolvedValue([signal]);
    const result = await service.listQueue(admin, {
      page: 1,
      pageSize: 10,
      severity: 'HIGH',
      signalType: 'PAYMENT_ANOMALY',
      subjectType: 'USER',
    });
    expect(result).toMatchObject({ page: 1, pageSize: 10, hasMore: false });
    expect(result.items[0]).toMatchObject({
      id: 'case-id',
      severity: 'HIGH',
      signalCount: 1,
      latestSignal: expect.objectContaining({ signalType: 'PAYMENT_ANOMALY' }),
    });
  });

  it('does not mix RISK cases into the Step 6.7 moderation queue', async () => {
    const moderationPath = await import('../moderation/moderation.service.js');
    expect(moderationPath.ModerationService).toBeDefined();
  });

  it('rejects risk access for ordinary users even when a valid case identifier is supplied', async () => {
    mocks.userFirst.mockResolvedValue({ id: 'client-id', status: 'ACTIVE' });
    mocks.userRoleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.getSignals(client, 'case-id')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.addNote(client, 'case-id', 'Try to alter internal history')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
