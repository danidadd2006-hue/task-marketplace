import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import { db } from '../prisma/db.js';
import type {
  TrustCaseActor,
  TrustCaseCreateInput,
  TrustCaseDecisionInput,
  TrustCaseEvidenceInput,
} from './trust-safety.types.js';

@Injectable()
export class TrustSafetyService {
  constructor(private readonly audit: AuditService) {}

  private async requireActiveUser(actor: TrustCaseActor) {
    const user = await db.orm.public.User.where({ id: actor.userId }).first();
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active');
    }
    return user;
  }

  private async requireAdmin(actor: TrustCaseActor) {
    await this.requireActiveUser(actor);
    const assignments = await db.orm.public.UserRoleAssignment.where({ userId: actor.userId }).all();
    if (!assignments.some((assignment) => assignment.role === 'ADMIN')) {
      throw new ForbiddenException('Administrative authorization required');
    }
  }

  private async getCaseOrThrow(caseId: string) {
    const trustCase = await db.orm.public.TrustCase.where({ id: caseId }).first();
    if (!trustCase) throw new NotFoundException('Trust & Safety case not found');
    return trustCase;
  }

  private canParticipate(actorId: string, trustCase: {
    createdById: string;
    subjectType: string;
    subjectId: string;
    assignedToId: string | null;
  }) {
    return trustCase.createdById === actorId
      || (trustCase.subjectType === 'USER' && trustCase.subjectId === actorId)
      || trustCase.assignedToId === actorId;
  }

  async createCase(actor: TrustCaseActor, input: TrustCaseCreateInput) {
    await this.requireActiveUser(actor);
    if (!['REPORT', 'DISPUTE', 'MODERATION', 'RISK'].includes(input.type)) {
      throw new BadRequestException('Invalid case type');
    }
    if (!input.subjectType.trim() || !input.subjectId.trim()) {
      throw new ConflictException('Case subject reference is required');
    }

    return db.transaction(async (tx) => {
      const trustCase = await tx.orm.public.TrustCase.create({
        type: input.type,
        category: input.category ?? null,
        status: 'OPEN',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        createdById: actor.userId,
        assignedToId: null,
        assignedAt: null,
        resolvedAt: null,
        closedAt: null,
        closedById: null,
        resolutionCode: null,
        resolutionReason: null,
        revision: 0,
      });

      await tx.orm.public.TrustCaseHistory.create({
        caseId: trustCase.id,
        actorId: actor.userId,
        action: 'CREATE',
        fromStatus: null,
        toStatus: 'OPEN',
        reason: null,
        metadataJson: null,
      });

      return trustCase;
    });
  }

  async assignCase(actor: TrustCaseActor, caseId: string, assigneeId: string) {
    await this.requireAdmin(actor);
    await this.requireActiveUser({ userId: assigneeId, email: '', roles: [] });

    return db.transaction(async (tx) => {
      const trustCase = await tx.orm.public.TrustCase.where({ id: caseId }).first();
      if (!trustCase) throw new NotFoundException('Trust & Safety case not found');
      if (trustCase.status === 'CLOSED') throw new ConflictException('Closed cases cannot be assigned');

      const action = trustCase.assignedToId ? 'REASSIGN' : 'ASSIGN';
      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          assignedToId: assigneeId,
          assignedAt: trustCase.assignedToId ? trustCase.assignedAt : new Date().toISOString(),
          status: 'ASSIGNED',
          revision: trustCase.revision + 1,
        });

      if (!updated) throw new ConflictException('Case was modified concurrently');

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action,
        fromStatus: trustCase.status,
        toStatus: 'ASSIGNED',
        reason: null,
        metadataJson: JSON.stringify({ assigneeId }),
      });

      await this.audit.log(actor.userId, 'ADMIN_ACTION', 'TrustCase', caseId, JSON.stringify({
        action,
        assigneeId,
      }));

      return updated;
    });
  }

  async addEvidence(actor: TrustCaseActor, caseId: string, input: TrustCaseEvidenceInput) {
    await this.requireActiveUser(actor);
    if (!['ATTACHMENT', 'MESSAGE', 'TASK', 'CONTRACT', 'PAYMENT', 'REVIEW', 'VERIFICATION', 'MEDIA', 'OTHER'].includes(input.evidenceType)) {
      throw new BadRequestException('Invalid evidence type');
    }
    if (!input.referenceType.trim() || !input.referenceId.trim()) {
      throw new BadRequestException('Evidence reference is required');
    }
    const trustCase = await this.getCaseOrThrow(caseId);
    const assignments = await db.orm.public.UserRoleAssignment.where({ userId: actor.userId }).all();
    const isAdmin = assignments.some((assignment) => assignment.role === 'ADMIN');

    if (!isAdmin && !this.canParticipate(actor.userId, trustCase)) {
      throw new ForbiddenException('You are not authorized to add evidence to this case');
    }
    if (trustCase.status === 'CLOSED') throw new ConflictException('Closed cases cannot accept evidence');

    return db.transaction(async (tx) => {
      const evidence = await tx.orm.public.TrustCaseEvidence.create({
        caseId,
        evidenceType: input.evidenceType,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        storageRef: isAdmin ? (input.storageRef ?? null) : null,
        attachedById: actor.userId,
        description: input.description ?? null,
        metadataJson: isAdmin && input.metadata ? JSON.stringify(input.metadata) : null,
      });

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'EVIDENCE_ADDED',
        fromStatus: trustCase.status,
        toStatus: trustCase.status,
        reason: input.description ?? null,
        metadataJson: JSON.stringify({
          evidenceId: evidence.id,
          evidenceType: input.evidenceType,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
        }),
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
    });
  }

  async recordDecision(actor: TrustCaseActor, caseId: string, input: TrustCaseDecisionInput) {
    await this.requireAdmin(actor);
    const trustCase = await this.getCaseOrThrow(caseId);
    if (trustCase.status === 'CLOSED') throw new ConflictException('Closed cases cannot receive decisions');

    return db.transaction(async (tx) => {
      const decision = await tx.orm.public.TrustCaseDecision.create({
        caseId,
        actorId: actor.userId,
        outcome: input.outcome,
        reason: input.reason ?? null,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      });

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'DECISION',
        fromStatus: trustCase.status,
        toStatus: trustCase.status,
        reason: input.reason ?? null,
        metadataJson: JSON.stringify({ decisionId: decision.id, outcome: input.outcome }),
      });

      await this.audit.log(actor.userId, 'ADMIN_ACTION', 'TrustCaseDecision', decision.id, JSON.stringify({
        caseId,
        outcome: input.outcome,
      }));

      return decision;
    });
  }

  async recordActionApplied(actor: TrustCaseActor, caseId: string, actionName: string, reason?: string, metadata?: Record<string, unknown>) {
    await this.requireAdmin(actor);
    const trustCase = await this.getCaseOrThrow(caseId);
    if (trustCase.status === 'CLOSED') throw new ConflictException('Closed cases cannot receive actions');
    if (!actionName.trim()) throw new BadRequestException('Action name is required');

    return db.transaction(async (tx) => {
      const history = await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'ACTION_APPLIED',
        fromStatus: trustCase.status,
        toStatus: trustCase.status,
        reason: reason ?? null,
        metadataJson: JSON.stringify({
          actionName,
          ...(metadata ?? {}),
        }),
      });

      await this.audit.log(actor.userId, 'ADMIN_ACTION', 'TrustCase', caseId, JSON.stringify({
        action: 'ACTION_APPLIED',
        actionName,
      }));

      return history;
    });
  }

  async resolveCase(actor: TrustCaseActor, caseId: string, resolutionCode: string, reason?: string) {
    await this.requireAdmin(actor);
    return db.transaction(async (tx) => {
      const trustCase = await tx.orm.public.TrustCase.where({ id: caseId }).first();
      if (!trustCase) throw new NotFoundException('Trust & Safety case not found');
      if (trustCase.status === 'CLOSED') throw new ConflictException('Case is already closed');

      const now = new Date().toISOString();
      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          status: 'RESOLVED',
          resolvedAt: now,
          resolutionCode,
          resolutionReason: reason ?? null,
          revision: trustCase.revision + 1,
        });
      if (!updated) throw new ConflictException('Case was modified concurrently');

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'RESOLVED',
        fromStatus: trustCase.status,
        toStatus: 'RESOLVED',
        reason: reason ?? null,
        metadataJson: JSON.stringify({ resolutionCode }),
      });

      await this.audit.log(actor.userId, 'ADMIN_ACTION', 'TrustCase', caseId, JSON.stringify({
        action: 'RESOLVED',
        resolutionCode,
      }));

      return updated;
    });
  }

  async closeCase(actor: TrustCaseActor, caseId: string, reason?: string) {
    await this.requireAdmin(actor);
    return db.transaction(async (tx) => {
      const trustCase = await tx.orm.public.TrustCase.where({ id: caseId }).first();
      if (!trustCase) throw new NotFoundException('Trust & Safety case not found');
      if (trustCase.status === 'CLOSED') throw new ConflictException('Case is already closed');

      const now = new Date().toISOString();
      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          status: 'CLOSED',
          closedAt: now,
          closedById: actor.userId,
          resolutionReason: reason ?? trustCase.resolutionReason,
          revision: trustCase.revision + 1,
        });
      if (!updated) throw new ConflictException('Case was modified concurrently');

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'CLOSED',
        fromStatus: trustCase.status,
        toStatus: 'CLOSED',
        reason: reason ?? null,
        metadataJson: null,
      });

      await this.audit.log(actor.userId, 'ADMIN_ACTION', 'TrustCase', caseId, JSON.stringify({
        action: 'CLOSED',
      }));

      return updated;
    });
  }

  async getCaseForActor(actor: TrustCaseActor, caseId: string) {
    await this.requireActiveUser(actor);
    const trustCase = await this.getCaseOrThrow(caseId);
    const assignments = await db.orm.public.UserRoleAssignment.where({ userId: actor.userId }).all();
    const isAdmin = assignments.some((assignment) => assignment.role === 'ADMIN');

    if (!isAdmin && !this.canParticipate(actor.userId, trustCase)) {
      throw new ForbiddenException('You are not authorized to view this case');
    }

    if (isAdmin) return trustCase;

    return {
      id: trustCase.id,
      type: trustCase.type,
      category: trustCase.category,
      status: trustCase.status,
      subjectType: trustCase.subjectType,
      subjectId: trustCase.subjectType === 'USER' && trustCase.subjectId === actor.userId ? trustCase.subjectId : null,
      createdAt: trustCase.createdAt,
      updatedAt: trustCase.updatedAt,
    };
  }

  async getHistoryForAdmin(actor: AuthenticatedUser, caseId: string) {
    await this.requireAdmin(actor);
    await this.getCaseOrThrow(caseId);
    return db.orm.public.TrustCaseHistory.where({ caseId }).all();
  }

  async getEvidenceForAdmin(actor: AuthenticatedUser, caseId: string) {
    await this.requireAdmin(actor);
    await this.getCaseOrThrow(caseId);
    return db.orm.public.TrustCaseEvidence.where({ caseId }).all();
  }
}
