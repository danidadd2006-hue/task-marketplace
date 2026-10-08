import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AccountService, type AccountStatus } from '../accounts/account.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { db } from '../prisma/db.js';
import {
  RISK_DECISION_OUTCOMES,
  RISK_SIGNAL_CATALOG,
  RISK_SOURCE_DOMAINS,
  RISK_SUBJECT_TYPES,
  type RiskDecisionOutcome,
  type RiskSeverity,
  type RiskSourceDomain,
  type RiskSubjectType,
} from './risk.constants.js';

@Injectable()
export class RiskService {
  constructor(
    private readonly accounts: AccountService,
    private readonly moderation: ModerationService,
  ) {}

  async requireAdmin(actor: AuthenticatedUser) {
    const user = await db.orm.public.User.where({ id: actor.userId }).first();
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active');
    }
    const assignments = await db.orm.public.UserRoleAssignment.where({ userId: actor.userId }).all();
    if (!assignments.some((assignment: any) => assignment.role === 'ADMIN')) {
      throw new ForbiddenException('Administrative authorisation required');
    }
    return user;
  }

  async recordSignal(actor: AuthenticatedUser, input: {
    signalType: string;
    subjectType: RiskSubjectType;
    subjectId: string;
    sourceDomain: RiskSourceDomain;
    sourceReference: string;
    observedAt?: string;
    deduplicationKey: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.requireAdmin(actor);
    const signal = await this.recordTrustedSignal({
      ...input,
    });
    await db.orm.public.AuditLog.create({
      userId: actor.userId,
      action: 'ADMIN_ACTION',
      entityType: 'RiskSignal',
      entityId: signal.id,
      details: JSON.stringify({
        action: 'CREATE_RISK_SIGNAL',
        signalType: signal.signalType,
        sourceDomain: signal.sourceDomain,
        sourceReference: signal.sourceReference,
      }),
    });
    return this.projectSignal(signal);
  }

  async recordTrustedSignal(input: {
    signalType: string;
    subjectType: RiskSubjectType;
    subjectId: string;
    sourceDomain: RiskSourceDomain;
    sourceReference: string;
    observedAt?: string;
    deduplicationKey: string;
    metadata?: Record<string, unknown>;
  }) {
    const catalog = RISK_SIGNAL_CATALOG[input.signalType];
    if (!catalog) throw new BadRequestException('Unsupported risk signal type');
    if (catalog.sourceDomain !== input.sourceDomain) {
      throw new BadRequestException('Risk signal type and source domain are inconsistent');
    }
    if (!RISK_SOURCE_DOMAINS.includes(input.sourceDomain)) {
      throw new BadRequestException('Unsupported risk source domain');
    }
    if (!RISK_SUBJECT_TYPES.includes(input.subjectType)) {
      throw new BadRequestException('Unsupported risk subject type');
    }

    const subjectId = input.subjectId.trim();
    const sourceReference = input.sourceReference.trim();
    const deduplicationKey = input.deduplicationKey.trim();
    if (!subjectId || !sourceReference || !deduplicationKey) {
      throw new BadRequestException('Risk signal references and deduplication key are required');
    }

    await this.validateTarget(input.subjectType, subjectId);
    await this.validateSource(input.sourceDomain, sourceReference);

    const observedAt = input.observedAt
      ? this.parseObservedAt(input.observedAt)
      : new Date().toISOString();

    const metadataJson = this.sanitiseMetadata(input.metadata);

    try {
      return await db.transaction(async (tx: any) => {
        const existing = await tx.orm.public.RiskSignal.where({ deduplicationKey }).first();
        if (existing) return existing;

        return tx.orm.public.RiskSignal.create({
          id: crypto.randomUUID(),
          signalType: input.signalType,
          subjectType: input.subjectType,
          subjectId,
          sourceDomain: input.sourceDomain,
          sourceReference,
          severity: catalog.severity,
          observedAt,
          metadataJson,
          deduplicationKey,
          trustCaseId: null,
        });
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await db.orm.public.RiskSignal.where({ deduplicationKey }).first();
        if (existing) return existing;
        throw new ConflictException('Risk signal was created concurrently');
      }
      throw error;
    }
  }

  async openInvestigation(actor: AuthenticatedUser, signalId: string, reason: string) {
    await this.requireAdmin(actor);
    const cleanReason = reason.trim();
    if (!cleanReason) throw new BadRequestException('Investigation reason is required');

    const existingSignal = await this.getSignalOrThrow(signalId);
    if (existingSignal.trustCaseId) {
      return this.getCase(actor, existingSignal.trustCaseId);
    }

    try {
      return await db.transaction(async (tx: any) => {
        const signal = await tx.orm.public.RiskSignal.where({ id: signalId }).first();
        if (!signal) throw new NotFoundException('Risk signal not found');
        if (signal.trustCaseId) {
          return this.projectCase(
            await tx.orm.public.TrustCase.where({ id: signal.trustCaseId }).first(),
          );
        }

        const relatedCases = await tx.orm.public.TrustCase.where({
          type: 'RISK',
          subjectType: signal.subjectType,
          subjectId: signal.subjectId,
        }).all();
        const activeRelatedCase = relatedCases
          .filter((item: any) => ['OPEN', 'ASSIGNED', 'IN_REVIEW'].includes(item.status))
          .sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)))[0];
        if (activeRelatedCase) {
          const linked = await tx.orm.public.RiskSignal
            .where({ id: signal.id, trustCaseId: null })
            .update({ trustCaseId: activeRelatedCase.id });
          if (!linked) throw new ConflictException('Risk signal was linked concurrently');
          await tx.orm.public.TrustCaseHistory.create({
            caseId: activeRelatedCase.id,
            actorId: actor.userId,
            action: 'EVIDENCE_ADDED',
            fromStatus: activeRelatedCase.status,
            toStatus: activeRelatedCase.status,
            reason: cleanReason,
            metadataJson: JSON.stringify({
              action: 'RISK_SIGNAL_ASSOCIATED',
              signalId: signal.id,
              severity: signal.severity,
            }),
          });
          return this.projectCase(activeRelatedCase);
        }

        const trustCase = await tx.orm.public.TrustCase.create({
          id: crypto.randomUUID(),
          type: 'RISK',
          category: signal.signalType,
          status: 'OPEN',
          subjectType: signal.subjectType,
          subjectId: signal.subjectId,
          createdById: actor.userId,
          assignedToId: null,
          assignedAt: null,
          resolvedAt: null,
          closedAt: null,
          closedById: null,
          resolutionCode: null,
          resolutionReason: cleanReason,
          revision: 0,
        });

        const linked = await tx.orm.public.RiskSignal
          .where({ id: signal.id, trustCaseId: null })
          .update({ trustCaseId: trustCase.id });

        if (!linked) throw new ConflictException('Risk signal was linked concurrently');

        await tx.orm.public.TrustCaseHistory.create({
          caseId: trustCase.id,
          actorId: actor.userId,
          action: 'CREATE',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: cleanReason,
          metadataJson: JSON.stringify({
            signalId: signal.id,
            signalType: signal.signalType,
            severity: signal.severity,
          }),
        });

        await tx.orm.public.AuditLog.create({
          userId: actor.userId,
          action: 'ADMIN_ACTION',
          entityType: 'TrustCase',
          entityId: trustCase.id,
          details: JSON.stringify({
            action: 'OPEN_RISK_INVESTIGATION',
            signalId: signal.id,
          }),
        });

        return this.projectCase(trustCase);
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        const signal = await db.orm.public.RiskSignal.where({ id: signalId }).first();
        if (signal?.trustCaseId) return this.getCase(actor, signal.trustCaseId);
      }
      throw error;
    }
  }

  async getCase(actor: AuthenticatedUser, caseId: string) {
    await this.requireAdmin(actor);
    const trustCase = await db.orm.public.TrustCase.where({ id: caseId }).first();
    if (!trustCase || trustCase.type !== 'RISK') {
      throw new NotFoundException('Risk investigation not found');
    }
    return {
      ...this.projectCase(trustCase),
      signals: await this.getSignals(actor, caseId),
      evidence: await this.getEvidence(actor, caseId),
      history: await this.getHistory(actor, caseId),
      decisions: await this.getDecisions(actor, caseId),
    };
  }

  async getSignals(actor: AuthenticatedUser, caseId: string) {
    await this.requireAdmin(actor);
    await this.getRiskCaseOrThrow(caseId);
    const rows = await db.orm.public.RiskSignal
      .where({ trustCaseId: caseId })
      .orderBy([(row: any) => row.observedAt.asc(), (row: any) => row.id.asc()])
      .all();
    return rows.map((row: any) => this.projectSignal(row));
  }

  async getHistory(actor: AuthenticatedUser, caseId: string) {
    await this.requireAdmin(actor);
    await this.getRiskCaseOrThrow(caseId);
    return db.orm.public.TrustCaseHistory
      .where({ caseId })
      .orderBy([(row: any) => row.createdAt.asc(), (row: any) => row.id.asc()])
      .all();
  }

  async getEvidence(actor: AuthenticatedUser, caseId: string) {
    await this.requireAdmin(actor);
    await this.getRiskCaseOrThrow(caseId);
    const rows = await db.orm.public.TrustCaseEvidence
      .where({ caseId })
      .orderBy([(row: any) => row.createdAt.asc(), (row: any) => row.id.asc()])
      .all();
    return rows.map((row: any) => ({
      id: row.id,
      caseId: row.caseId,
      evidenceType: row.evidenceType,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      attachedById: row.attachedById,
      description: row.description,
      createdAt: row.createdAt,
    }));
  }

  async getDecisions(actor: AuthenticatedUser, caseId: string) {
    await this.requireAdmin(actor);
    await this.getRiskCaseOrThrow(caseId);
    return db.orm.public.TrustCaseDecision
      .where({ caseId })
      .orderBy([(row: any) => row.createdAt.asc(), (row: any) => row.id.asc()])
      .all();
  }

  async addEvidence(actor: AuthenticatedUser, caseId: string, input: {
    evidenceType: string;
    referenceType: string;
    referenceId: string;
    description?: string;
  }) {
    await this.requireAdmin(actor);
    const trustCase = await this.getRiskCaseOrThrow(caseId);
    if (['RESOLVED', 'CLOSED'].includes(trustCase.status)) {
      throw new ConflictException('Terminal risk investigations cannot accept evidence');
    }
    await this.validateEvidenceReference(input.referenceType, input.referenceId);

    const evidence = await db.transaction(async (tx: any) => {
      const created = await tx.orm.public.TrustCaseEvidence.create({
        id: crypto.randomUUID(),
        caseId,
        evidenceType: input.evidenceType,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        storageRef: null,
        attachedById: actor.userId,
        description: input.description?.trim() || null,
        metadataJson: null,
      });

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'EVIDENCE_ADDED',
        fromStatus: trustCase.status,
        toStatus: trustCase.status,
        reason: input.description?.trim() || null,
        metadataJson: JSON.stringify({
          evidenceId: created.id,
          evidenceType: created.evidenceType,
          referenceType: created.referenceType,
          referenceId: created.referenceId,
        }),
      });

      return created;
    });

    return {
      id: evidence.id,
      caseId: evidence.caseId,
      evidenceType: evidence.evidenceType,
      referenceType: evidence.referenceType,
      referenceId: evidence.referenceId,
      attachedById: evidence.attachedById,
      description: evidence.description,
      createdAt: evidence.createdAt,
    };
  }

  async assign(actor: AuthenticatedUser, caseId: string, assigneeId: string, reason: string) {
    await this.requireAdmin(actor);
    const cleanReason = reason.trim();
    if (!cleanReason || !assigneeId.trim()) {
      throw new BadRequestException('Assignee and reason are required');
    }

    return db.transaction(async (tx: any) => {
      const trustCase = await this.getRiskCaseOrThrowTx(tx, caseId);
      if (['RESOLVED', 'CLOSED'].includes(trustCase.status)) {
        throw new ConflictException('Terminal risk investigations cannot be assigned');
      }

      const assignee = await tx.orm.public.User.where({ id: assigneeId.trim() }).first();
      if (!assignee || assignee.status !== 'ACTIVE') {
        throw new NotFoundException('Investigator not found');
      }

      const assignments = await tx.orm.public.UserRoleAssignment.where({ userId: assignee.id }).all();
      if (!assignments.some((assignment: any) => assignment.role === 'ADMIN')) {
        throw new ForbiddenException('Risk investigator must have administrative capability');
      }

      const action = trustCase.assignedToId ? 'REASSIGN' : 'ASSIGN';
      const assignedAt = new Date().toISOString();
      const nextStatus = trustCase.status === 'OPEN' ? 'ASSIGNED' : trustCase.status;
      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          assignedToId: assignee.id,
          assignedAt,
          status: nextStatus,
          revision: trustCase.revision + 1,
        });
      if (!updated) throw new ConflictException('Risk investigation changed concurrently');

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action,
        fromStatus: trustCase.status,
        toStatus: nextStatus,
        reason: cleanReason,
        metadataJson: JSON.stringify({
          previousAssigneeId: trustCase.assignedToId,
          assigneeId: assignee.id,
        }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCase',
        entityId: caseId,
        details: JSON.stringify({ action, assigneeId: assignee.id }),
      });

      return this.projectCase({
        ...trustCase,
        assignedToId: assignee.id,
        assignedAt,
        status: nextStatus,
        revision: trustCase.revision + 1,
      });
    });
  }

  async unassign(actor: AuthenticatedUser, caseId: string, reason: string) {
    await this.requireAdmin(actor);
    const cleanReason = reason.trim();
    if (!cleanReason) throw new BadRequestException('Unassignment reason is required');

    return db.transaction(async (tx: any) => {
      const trustCase = await this.getRiskCaseOrThrowTx(tx, caseId);
      if (!trustCase.assignedToId) throw new ConflictException('Risk investigation is not assigned');
      if (['RESOLVED', 'CLOSED'].includes(trustCase.status)) {
        throw new ConflictException('Terminal risk investigations cannot be unassigned');
      }

      const nextStatus = trustCase.status === 'ASSIGNED' ? 'OPEN' : trustCase.status;
      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          assignedToId: null,
          assignedAt: null,
          status: nextStatus,
          revision: trustCase.revision + 1,
        });
      if (!updated) throw new ConflictException('Risk investigation changed concurrently');

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'REASSIGN',
        fromStatus: trustCase.status,
        toStatus: nextStatus,
        reason: cleanReason,
        metadataJson: JSON.stringify({
          previousAssigneeId: trustCase.assignedToId,
          assigneeId: null,
        }),
      });

      return this.projectCase({
        ...trustCase,
        assignedToId: null,
        assignedAt: null,
        status: nextStatus,
        revision: trustCase.revision + 1,
      });
    });
  }

  async addNote(actor: AuthenticatedUser, caseId: string, note: string) {
    await this.requireAdmin(actor);
    const cleanNote = note.trim();
    if (!cleanNote) throw new BadRequestException('Investigation note is required');
    const trustCase = await this.getRiskCaseOrThrow(caseId);
    if (['RESOLVED', 'CLOSED'].includes(trustCase.status)) {
      throw new ConflictException('Terminal risk investigations cannot receive notes');
    }

    const created = await db.transaction(async (tx: any) => {
      const history = await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'ACTION_APPLIED',
        fromStatus: trustCase.status,
        toStatus: trustCase.status,
        reason: cleanNote,
        metadataJson: JSON.stringify({ actionName: 'INVESTIGATION_NOTE_ADDED' }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCaseHistory',
        entityId: history.id,
        details: JSON.stringify({ action: 'INVESTIGATION_NOTE_ADDED', caseId }),
      });

      return history;
    });

    return {
      id: created.id,
      caseId,
      actorId: actor.userId,
      note: cleanNote,
      createdAt: created.createdAt,
    };
  }

  async transition(
    actor: AuthenticatedUser,
    caseId: string,
    status: 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED',
    reason: string,
    resolutionCode?: string,
  ) {
    await this.requireAdmin(actor);
    const cleanReason = reason.trim();
    if (!cleanReason) throw new BadRequestException('Risk transition reason is required');

    return db.transaction(async (tx: any) => {
      const trustCase = await this.getRiskCaseOrThrowTx(tx, caseId);
      this.assertTransition(trustCase.status, status);

      const now = new Date().toISOString();
      const nextStatus = status === 'DISMISSED' ? 'CLOSED' : status;
      const nextResolutionCode = status === 'DISMISSED'
        ? resolutionCode?.trim() || 'DISMISSED'
        : resolutionCode?.trim() || 'RESOLVED';

      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          status: nextStatus,
          resolvedAt: status === 'RESOLVED' || status === 'DISMISSED' ? now : trustCase.resolvedAt,
          closedAt: status === 'DISMISSED' ? now : trustCase.closedAt,
          closedById: status === 'DISMISSED' ? actor.userId : trustCase.closedById,
          resolutionCode: nextResolutionCode,
          resolutionReason: status === 'RESOLVED' || status === 'DISMISSED' ? cleanReason : trustCase.resolutionReason,
          revision: trustCase.revision + 1,
        });
      if (!updated) throw new ConflictException('Risk investigation changed concurrently');

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: status === 'DISMISSED' ? 'CLOSED' : status === 'RESOLVED' ? 'RESOLVED' : 'DECISION',
        fromStatus: trustCase.status,
        toStatus: nextStatus,
        reason: cleanReason,
        metadataJson: JSON.stringify({
          action: 'STATUS_TRANSITION',
          requestedStatus: status,
          resolutionCode: nextResolutionCode,
        }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCase',
        entityId: caseId,
        details: JSON.stringify({
          action: 'RISK_STATUS_TRANSITION',
          fromStatus: trustCase.status,
          toStatus: status,
        }),
      });

      return this.projectCase({
        ...trustCase,
        status: nextStatus,
        resolvedAt: status === 'RESOLVED' || status === 'DISMISSED' ? now : trustCase.resolvedAt,
        closedAt: status === 'DISMISSED' ? now : trustCase.closedAt,
        closedById: status === 'DISMISSED' ? actor.userId : trustCase.closedById,
        resolutionCode: nextResolutionCode,
        resolutionReason: status === 'RESOLVED' || status === 'DISMISSED' ? cleanReason : trustCase.resolutionReason,
        revision: trustCase.revision + 1,
      });
    });
  }

  async recordDecision(actor: AuthenticatedUser, caseId: string, input: {
    outcome: RiskDecisionOutcome;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.requireAdmin(actor);
    if (!RISK_DECISION_OUTCOMES.includes(input.outcome)) {
      throw new BadRequestException('Unsupported risk decision outcome');
    }
    const cleanReason = input.reason.trim();
    if (!cleanReason) throw new BadRequestException('Risk decision reason is required');

    return db.transaction(async (tx: any) => {
      const trustCase = await this.getRiskCaseOrThrowTx(tx, caseId);
      if (trustCase.status !== 'IN_REVIEW') {
        throw new ConflictException('Risk decisions require the investigation to be under review');
      }

      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({ revision: trustCase.revision + 1 });
      if (!updated) throw new ConflictException('Risk investigation changed concurrently');

      const decision = await tx.orm.public.TrustCaseDecision.create({
        id: crypto.randomUUID(),
        caseId,
        actorId: actor.userId,
        outcome: input.outcome,
        reason: cleanReason,
        metadataJson: this.sanitiseMetadata(input.metadata),
      });

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'DECISION',
        fromStatus: trustCase.status,
        toStatus: trustCase.status,
        reason: cleanReason,
        metadataJson: JSON.stringify({
          decisionId: decision.id,
          outcome: input.outcome,
        }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCaseDecision',
        entityId: decision.id,
        details: JSON.stringify({
          action: 'RISK_DECISION',
          caseId,
          outcome: input.outcome,
        }),
      });

      return decision;
    });
  }

  async applyEnforcement(
    actor: AuthenticatedUser,
    caseId: string,
    actionType: 'ACCOUNT_STATUS' | 'MODERATION_CASE',
    accountStatus: AccountStatus | undefined,
    reason: string,
  ) {
    await this.requireAdmin(actor);
    const trustCase = await this.getRiskCaseOrThrow(caseId);
    if (trustCase.status !== 'IN_REVIEW') {
      throw new ConflictException('Risk enforcement requires the investigation to be under review');
    }

    const cleanReason = reason.trim();
    if (!cleanReason) throw new BadRequestException('Enforcement reason is required');

    let reference: string;
    if (actionType === 'ACCOUNT_STATUS') {
      if (trustCase.subjectType !== 'USER') {
        throw new ConflictException('Account status enforcement requires a USER risk subject');
      }
      if (!accountStatus) {
        throw new BadRequestException('Account status is required for account enforcement');
      }
      const result = await this.accounts.changeStatus(actor, trustCase.subjectId, accountStatus, cleanReason);
      reference = String(result.caseId);
    } else {
      const moderationCase = await this.moderation.createCase(actor, {
        subjectType: this.toModerationTargetType(trustCase.subjectType),
        subjectId: trustCase.subjectId,
        reason: cleanReason,
      });
      reference = String(moderationCase.id);
    }

    const history = await db.transaction(async (tx: any) => {
      const current = await tx.orm.public.TrustCase.where({ id: caseId }).first();
      if (!current || current.type !== 'RISK') {
        throw new NotFoundException('Risk investigation not found');
      }

      const historyRow = await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'ACTION_APPLIED',
        fromStatus: current.status,
        toStatus: current.status,
        reason: cleanReason,
        metadataJson: JSON.stringify({
          actionName: actionType === 'ACCOUNT_STATUS' ? 'ACCOUNT_STATUS_ENFORCEMENT' : 'MODERATION_ESCALATION',
          relatedAdministrativeActionRef: reference,
        }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCase',
        entityId: caseId,
        details: JSON.stringify({
          action: 'RISK_ENFORCEMENT_DELEGATED',
          actionType,
          relatedAdministrativeActionRef: reference,
        }),
      });

      return historyRow;
    });

    return {
      caseId,
      actionType,
      relatedAdministrativeActionRef: reference,
      historyId: history.id,
    };
  }

  async listQueue(actor: AuthenticatedUser, query: {
    status?: 'OPEN' | 'ASSIGNED' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED';
    severity?: RiskSeverity;
    signalType?: string;
    subjectType?: string;
    subjectId?: string;
    assignedToId?: string;
    observedFrom?: string;
    observedTo?: string;
    page?: number;
    pageSize?: number;
  }) {
    await this.requireAdmin(actor);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    let cases: any[] = await db.orm.public.TrustCase.where({ type: 'RISK' }).all();

    if (query.status) {
      cases = cases.filter((row: any) => this.projectRiskStatus(row) === query.status);
    }
    if (query.subjectType) cases = cases.filter((row: any) => row.subjectType === query.subjectType);
    if (query.subjectId) cases = cases.filter((row: any) => row.subjectId === query.subjectId);
    if (query.assignedToId) cases = cases.filter((row: any) => row.assignedToId === query.assignedToId);

    const enriched: any[] = [];
    for (const trustCase of cases) {
      const signals = await db.orm.public.RiskSignal.where({ trustCaseId: trustCase.id }).all();
      if (!signals.length) continue;

      if (query.signalType && !signals.some((signal: any) => signal.signalType === query.signalType)) continue;
      if (query.severity && !signals.some((signal: any) => signal.severity === query.severity)) continue;

      const filteredSignals = signals.filter((signal: any) => {
        if (query.observedFrom && new Date(signal.observedAt) < new Date(query.observedFrom)) return false;
        if (query.observedTo && new Date(signal.observedAt) > new Date(query.observedTo)) return false;
        return true;
      });
      if ((query.observedFrom || query.observedTo) && !filteredSignals.length) continue;

      const sortedSignals = signals.slice().sort((a, b) =>
        String(b.observedAt).localeCompare(String(a.observedAt)) || String(b.id).localeCompare(String(a.id)),
      );
      const latest = sortedSignals[0];
      const severities = new Set(signals.map((signal: any) => signal.severity));
      const severity = severities.has('CRITICAL') ? 'CRITICAL'
        : severities.has('HIGH') ? 'HIGH'
        : severities.has('MEDIUM') ? 'MEDIUM'
        : 'LOW';

      enriched.push({
        ...this.projectCase(trustCase),
        status: this.projectRiskStatus(trustCase),
        severity,
        latestSignal: this.projectSignal(latest),
        signalCount: signals.length,
      });
    }

    enriched.sort((a, b) =>
      String(b.latestSignal.observedAt).localeCompare(String(a.latestSignal.observedAt))
      || String(b.id).localeCompare(String(a.id)),
    );

    return {
      items: enriched.slice(offset, offset + pageSize),
      page,
      pageSize,
      hasMore: enriched.length > offset + pageSize,
    };
  }

  private async getRiskCaseOrThrow(caseId: string) {
    const trustCase = await db.orm.public.TrustCase.where({ id: caseId }).first();
    if (!trustCase || trustCase.type !== 'RISK') {
      throw new NotFoundException('Risk investigation not found');
    }
    return trustCase;
  }

  private async getRiskCaseOrThrowTx(tx: any, caseId: string) {
    const trustCase = await tx.orm.public.TrustCase.where({ id: caseId }).first();
    if (!trustCase || trustCase.type !== 'RISK') {
      throw new NotFoundException('Risk investigation not found');
    }
    return trustCase;
  }

  private projectSignal(signal: any) {
    return {
      id: signal.id,
      signalType: signal.signalType,
      subjectType: signal.subjectType,
      subjectId: signal.subjectId,
      sourceDomain: signal.sourceDomain,
      sourceReference: signal.sourceReference,
      severity: signal.severity,
      observedAt: signal.observedAt,
      metadataJson: signal.metadataJson,
      deduplicationKey: signal.deduplicationKey,
      trustCaseId: signal.trustCaseId,
      createdAt: signal.createdAt,
    };
  }

  private projectCase(trustCase: any) {
    return {
      id: trustCase.id,
      type: trustCase.type,
      status: this.projectRiskStatus(trustCase),
      storedStatus: trustCase.status,
      subjectType: trustCase.subjectType,
      subjectId: trustCase.subjectId,
      createdById: trustCase.createdById,
      assignedToId: trustCase.assignedToId,
      assignedAt: trustCase.assignedAt,
      resolvedAt: trustCase.resolvedAt,
      closedAt: trustCase.closedAt,
      closedById: trustCase.closedById,
      resolutionCode: trustCase.resolutionCode,
      resolutionReason: trustCase.resolutionReason,
      revision: trustCase.revision,
      createdAt: trustCase.createdAt,
      updatedAt: trustCase.updatedAt,
    };
  }

  private projectRiskStatus(trustCase: any) {
    return trustCase.status === 'CLOSED' && trustCase.resolutionCode === 'DISMISSED'
      ? 'DISMISSED'
      : trustCase.status;
  }

  private assertTransition(current: string, requested: 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED') {
    if (current === 'CLOSED' || current === 'RESOLVED') {
      throw new ConflictException('Risk investigation is already terminal');
    }
    if (requested === 'IN_REVIEW' && !['OPEN', 'ASSIGNED'].includes(current)) {
      throw new ConflictException('Risk investigation cannot transition to review from its current state');
    }
    if (requested === 'RESOLVED' && !['IN_REVIEW', 'ASSIGNED'].includes(current)) {
      throw new ConflictException('Risk investigation cannot be resolved from its current state');
    }
    if (requested === 'DISMISSED' && !['OPEN', 'ASSIGNED', 'IN_REVIEW'].includes(current)) {
      throw new ConflictException('Risk investigation cannot be dismissed from its current state');
    }
  }

  private toModerationTargetType(subjectType: string): 'USER' | 'TASK' | 'MESSAGE' | 'REVIEW' {
    if (subjectType === 'USER' || subjectType === 'TASK' || subjectType === 'MESSAGE' || subjectType === 'REVIEW') {
      return subjectType;
    }
    throw new ConflictException(
      'This risk subject cannot be escalated to the generic moderation target boundary',
    );
  }

  private async validateTarget(subjectType: RiskSubjectType, subjectId: string) {
    const tableMap: Record<RiskSubjectType, string> = {
      USER: 'User',
      TASK: 'Task',
      APPLICATION: 'Application',
      CONTRACT: 'Contract',
      PAYMENT: 'Payment',
      PAYOUT: 'Payout',
      TOKEN_TRANSACTION: 'TokenTransaction',
      CONVERSATION: 'Conversation',
      MESSAGE: 'Message',
      REVIEW: 'Review',
      VERIFICATION: 'Verification',
    };
    const model = (db.orm.public as any)[tableMap[subjectType]];
    if (!model || !(await model.where({ id: subjectId }).first())) {
      throw new NotFoundException('Risk target not found');
    }
  }

  private async validateEvidenceReference(referenceType: string, referenceId: string) {
    const referenceTables: Record<string, string> = {
      User: 'User',
      Task: 'Task',
      Application: 'Application',
      Contract: 'Contract',
      Payment: 'Payment',
      Payout: 'Payout',
      TokenTransaction: 'TokenTransaction',
      Conversation: 'Conversation',
      Message: 'Message',
      Review: 'Review',
      Verification: 'Verification',
      RiskSignal: 'RiskSignal',
    };
    const tableName = referenceTables[referenceType];
    if (!tableName) throw new BadRequestException('Unsupported risk evidence reference type');
    const model = (db.orm.public as any)[tableName];
    if (!model || !(await model.where({ id: referenceId.trim() }).first())) {
      throw new NotFoundException('Risk evidence reference not found');
    }
  }

  private async validateSource(sourceDomain: RiskSourceDomain, sourceReference: string) {
    const sourceTables: Record<RiskSourceDomain, string[]> = {
      ACCOUNT: ['User'],
      PAYMENT: ['Payment', 'PaymentProviderEvent', 'Refund', 'RefundProviderEvent', 'Payout', 'PayoutProviderEvent'],
      MARKETPLACE: ['Task', 'Application', 'Contract', 'Cancellation', 'WorkerCancellationPenalty'],
      TOKENS: ['TokenTransaction', 'TokenPurchase', 'TokenPurchaseProviderEvent'],
      REVIEWS: ['Review'],
      MESSAGING: ['Message', 'Conversation'],
      VERIFICATION: ['Verification'],
    };

    for (const tableName of sourceTables[sourceDomain]) {
      const model = (db.orm.public as any)[tableName];
      if (model && await model.where({ id: sourceReference }).first()) return;
    }

    throw new NotFoundException('Risk signal source reference not found');
  }

  private parseObservedAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid observed timestamp');
    return date.toISOString();
  }

  private sanitiseMetadata(input?: Record<string, unknown>) {
    if (!input) return null;
    const blocked = new Set([
      'password',
      'token',
      'secret',
      'authorization',
      'cookie',
      'signedurl',
      'storagekey',
      'privatekey',
    ]);

    const scrub = (value: unknown, depth: number): unknown => {
      if (depth > 3) return '[TRUNCATED]';
      if (Array.isArray(value)) {
        return value.slice(0, 32).map((item) => scrub(item, depth + 1));
      }
      if (value && typeof value === 'object') {
        const output: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value).slice(0, 32)) {
          if (blocked.has(key.toLowerCase())) continue;
          output[key] = scrub(nested, depth + 1);
        }
        return output;
      }
      return value;
    };

    const json = JSON.stringify(scrub(input, 0));
    return json.length > 12000 ? json.slice(0, 12000) : json;
  }

  private isUniqueViolation(error: unknown) {
    const candidate = error as { code?: unknown; sqlState?: unknown; message?: unknown };
    return candidate.code === 'P2002'
      || candidate.code === '23505'
      || candidate.sqlState === '23505'
      || (typeof candidate.message === 'string' && /unique constraint|duplicate key/i.test(candidate.message));
  }

  private async getSignalOrThrow(signalId: string) {
    const signal = await db.orm.public.RiskSignal.where({ id: signalId }).first();
    if (!signal) throw new NotFoundException('Risk signal not found');
    return signal;
  }
}
