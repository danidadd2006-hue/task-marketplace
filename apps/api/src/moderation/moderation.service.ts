import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';
import { DisputeService } from '../disputes/dispute.service.js';
import {
  MODERATION_TARGET_TYPES,
  type ModerationTargetType,
} from './dto/create-moderation-case.dto.js';
import type { ModerationQueueQueryDto } from './dto/moderation-queue-query.dto.js';

const ACTIVE_CASE_STATUSES = ['OPEN', 'ASSIGNED', 'IN_REVIEW'] as const;
type ActiveCaseStatus = (typeof ACTIVE_CASE_STATUSES)[number];

@Injectable()
export class ModerationService {
  constructor(private readonly disputes: DisputeService) {}

  private async requireAdmin(actor: AuthenticatedUser, client: any = db) {
    const user = await client.orm.public.User.where({ id: actor.userId }).first();
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active');
    }

    const assignments = await client.orm.public.UserRoleAssignment.where({ userId: actor.userId }).all();
    if (!assignments.some((assignment: any) => assignment.role === 'ADMIN')) {
      throw new ForbiddenException('Administrative authorization required');
    }

    return user;
  }

  private async getCaseOrThrow(client: any, caseId: string) {
    const trustCase = await client.orm.public.TrustCase.where({ id: caseId }).first();
    if (!trustCase) throw new NotFoundException('Moderation case not found');
    return trustCase;
  }

  private async requireCaseAccess(actor: AuthenticatedUser, caseId: string, client: any = db) {
    await this.requireAdmin(actor, client);
    const trustCase = await this.getCaseOrThrow(client, caseId);

    if (trustCase.assignedToId && trustCase.assignedToId !== actor.userId) {
      throw new ForbiddenException('This case is assigned to another administrator');
    }

    return trustCase;
  }

  async listQueue(actor: AuthenticatedUser, query: ModerationQueueQueryDto) {
    await this.requireAdmin(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const offset = (page - 1) * pageSize;
    const types = query.type ? [query.type] : ['REPORT', 'DISPUTE', 'MODERATION'];

    const rows: any[] = [];
    for (const type of types) {
      const filter: Record<string, string> = { type };
      if (query.status) filter.status = query.status;
      if (query.subjectType) filter.subjectType = query.subjectType;
      const typedRows = await db.orm.public.TrustCase.where(filter).all();
      rows.push(...typedRows);
    }

    rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
    const pageRows = rows.slice(offset, offset + pageSize + 1);
    const hasMore = pageRows.length > pageSize;
    const items = pageRows.slice(0, pageSize).map((row: any) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      createdById: row.createdById,
      assignedToId: row.assignedToId,
      assignedAt: row.assignedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return { items, page, pageSize, hasMore };
  }

  async createCase(actor: AuthenticatedUser, input: {
    subjectType: ModerationTargetType;
    subjectId: string;
    reason: string;
  }) {
    await this.requireAdmin(actor);
    const subjectId = input.subjectId.trim();
    const reason = input.reason.trim();
    if (!subjectId) throw new BadRequestException('Case subject is required');
    if (!reason) throw new BadRequestException('Case reason is required');
    if (!MODERATION_TARGET_TYPES.includes(input.subjectType)) {
      throw new BadRequestException('Unsupported moderation target');
    }

    await this.validateTarget(input.subjectType, subjectId);

    const created = await db.transaction(async (tx: any) => {
      const existingCases = await tx.orm.public.TrustCase
        .where({ type: 'MODERATION', subjectType: input.subjectType, subjectId })
        .all();
      if (existingCases.some((item: any) => ACTIVE_CASE_STATUSES.includes(item.status as ActiveCaseStatus))) {
        throw new ConflictException('An active moderation case already exists for this target');
      }

      const trustCase = await tx.orm.public.TrustCase.create({
        type: 'MODERATION',
        category: null,
        status: 'OPEN',
        subjectType: input.subjectType,
        subjectId,
        createdById: actor.userId,
        assignedToId: null,
        assignedAt: null,
        resolvedAt: null,
        closedAt: null,
        closedById: null,
        resolutionCode: null,
        resolutionReason: reason,
        revision: 0,
      });

      await tx.orm.public.TrustCaseHistory.create({
        caseId: trustCase.id,
        actorId: actor.userId,
        action: 'CREATE',
        fromStatus: null,
        toStatus: 'OPEN',
        reason,
        metadataJson: JSON.stringify({ source: 'ADMIN_MODERATION' }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCase',
        entityId: trustCase.id,
        details: JSON.stringify({
          action: 'CREATE_MODERATION_CASE',
          subjectType: input.subjectType,
          subjectId,
        }),
      });

      return trustCase;
    });

    return this.projectCase(created);
  }

  async getCase(actor: AuthenticatedUser, caseId: string) {
    const trustCase = await this.requireCaseAccess(actor, caseId);
    const target = await this.getTargetContext(trustCase);

    let domain: Record<string, unknown> | null = null;
    if (trustCase.type === 'REPORT') {
      const report = await db.orm.public.Report.where({ trustCaseId: trustCase.id }).first();
      if (!report) throw new NotFoundException('Linked report not found');
      domain = {
        id: report.id,
        reporterId: report.reporterId,
        targetType: report.targetType,
        targetId: report.targetId,
        category: report.category,
        reason: report.reason,
        description: report.description,
        status: report.status,
        resolution: report.resolution,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
      };
    } else if (trustCase.type === 'DISPUTE') {
      const dispute = await db.orm.public.Dispute.where({ trustCaseId: trustCase.id }).first();
      if (!dispute) throw new NotFoundException('Linked dispute not found');
      domain = {
        id: dispute.id,
        taskId: dispute.taskId,
        contractId: dispute.contractId,
        raisedById: dispute.raisedById,
        category: dispute.category,
        reason: dispute.reason,
        description: dispute.description,
        status: dispute.status,
        resolution: dispute.resolution,
        resolutionCode: dispute.resolutionCode,
        resolutionReason: dispute.resolutionReason,
        resolutionActorId: dispute.resolutionActorId,
        resolutionAt: dispute.resolutionAt,
        relatedFinancialActionRef: dispute.relatedFinancialActionRef,
        createdAt: dispute.createdAt,
        updatedAt: dispute.updatedAt,
      };
    }

    return {
      ...this.projectCase(trustCase),
      domain,
      target,
    };
  }

  async getHistory(actor: AuthenticatedUser, caseId: string) {
    await this.requireCaseAccess(actor, caseId);
    const rows = await db.orm.public.TrustCaseHistory
      .where({ caseId })
      .orderBy([(row: any) => row.createdAt.asc(), (row: any) => row.id.asc()])
      .all();

    return rows.map((row: any) => ({
      id: row.id,
      caseId: row.caseId,
      actorId: row.actorId,
      action: row.action,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason,
      metadataJson: row.metadataJson,
      createdAt: row.createdAt,
    }));
  }

  async getEvidence(actor: AuthenticatedUser, caseId: string) {
    await this.requireCaseAccess(actor, caseId);
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

  async assign(actor: AuthenticatedUser, caseId: string, assigneeId: string, reason: string) {
    const cleanReason = reason.trim();
    if (!cleanReason) throw new BadRequestException('Assignment reason is required');

    return db.transaction(async (tx: any) => {
      await this.requireAdmin(actor, tx);
      const trustCase = await this.getCaseOrThrow(tx, caseId);
      if (trustCase.status === 'CLOSED' || trustCase.status === 'RESOLVED') {
        throw new ConflictException('Terminal cases cannot be assigned');
      }
      if (!assigneeId.trim()) throw new BadRequestException('Assignee is required');
      if (trustCase.assignedToId === assigneeId) {
        throw new ConflictException('Case is already assigned to this administrator');
      }

      const assignee = await tx.orm.public.User.where({ id: assigneeId }).first();
      if (!assignee || assignee.status !== 'ACTIVE') {
        throw new NotFoundException('Assigned administrator not found');
      }
      const assignments = await tx.orm.public.UserRoleAssignment.where({ userId: assigneeId }).all();
      if (!assignments.some((assignment: any) => assignment.role === 'ADMIN')) {
        throw new ForbiddenException('Case assignee must have administrative capability');
      }

      const action = trustCase.assignedToId ? 'REASSIGN' : 'ASSIGN';
      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          assignedToId: assigneeId,
          assignedAt: new Date().toISOString(),
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
        reason,
        metadataJson: JSON.stringify({
          previousAssigneeId: trustCase.assignedToId,
          assigneeId,
        }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCase',
        entityId: caseId,
        details: JSON.stringify({ action, assigneeId }),
      });

      return this.projectCase({ ...trustCase, assignedToId: assigneeId, assignedAt: new Date().toISOString(), status: 'ASSIGNED', revision: trustCase.revision + 1 });
    });
  }

  async unassign(actor: AuthenticatedUser, caseId: string, reason: string) {
    const cleanReason = reason.trim();
    if (!cleanReason) throw new BadRequestException('Unassignment reason is required');

    return db.transaction(async (tx: any) => {
      await this.requireAdmin(actor, tx);
      const trustCase = await this.getCaseOrThrow(tx, caseId);
      if (!trustCase.assignedToId) throw new ConflictException('Case is not assigned');
      if (trustCase.status === 'CLOSED') throw new ConflictException('Closed cases cannot be unassigned');

      const nextStatus = trustCase.status === 'ASSIGNED' ? 'OPEN' : trustCase.status;
      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          assignedToId: null,
          assignedAt: null,
          status: nextStatus,
          revision: trustCase.revision + 1,
        });
      if (!updated) throw new ConflictException('Case was modified concurrently');

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

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCase',
        entityId: caseId,
        details: JSON.stringify({ action: 'UNASSIGN', reason: cleanReason }),
      });

      return this.projectCase({ ...trustCase, assignedToId: null, assignedAt: null, status: nextStatus, revision: trustCase.revision + 1 });
    });
  }

  async addNote(actor: AuthenticatedUser, caseId: string, note: string) {
    const cleanNote = note.trim();
    if (!cleanNote) throw new BadRequestException('Moderation note is required');

    return db.transaction(async (tx: any) => {
      const trustCase = await this.requireCaseAccess(actor, caseId, tx);
      if (trustCase.status === 'CLOSED') throw new ConflictException('Closed cases cannot receive notes');

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

      return {
        id: history.id,
        caseId,
        actorId: actor.userId,
        action: 'INVESTIGATION_NOTE_ADDED',
        reason: cleanNote,
        createdAt: history.createdAt,
      };
    });
  }

  async recordDecision(actor: AuthenticatedUser, caseId: string, outcome: string, reason: string, metadata?: Record<string, unknown>) {
    const cleanOutcome = outcome.trim();
    const cleanReason = reason.trim();
    if (!cleanOutcome) throw new BadRequestException('Decision outcome is required');
    if (!cleanReason) throw new BadRequestException('Decision reason is required');

    return db.transaction(async (tx: any) => {
      const trustCase = await this.requireCaseAccess(actor, caseId, tx);
      if (trustCase.status === 'CLOSED') throw new ConflictException('Closed cases cannot receive decisions');

      const decision = await tx.orm.public.TrustCaseDecision.create({
        caseId,
        actorId: actor.userId,
        outcome: cleanOutcome,
        reason: cleanReason,
        metadataJson: metadata ? JSON.stringify(metadata) : null,
      });

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: 'DECISION',
        fromStatus: trustCase.status,
        toStatus: trustCase.status,
        reason: cleanReason,
        metadataJson: JSON.stringify({ decisionId: decision.id, outcome: cleanOutcome, ...(metadata ?? {}) }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCaseDecision',
        entityId: decision.id,
        details: JSON.stringify({ action: 'RECORD_DECISION', caseId, outcome: cleanOutcome }),
      });

      return decision;
    });
  }

  async transition(actor: AuthenticatedUser, caseId: string, toStatus: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED', reason: string) {
    const cleanReason = reason.trim();
    if (!cleanReason) throw new BadRequestException('Transition reason is required');

    return db.transaction(async (tx: any) => {
      const trustCase = await this.requireCaseAccess(actor, caseId, tx);
      this.assertTransitionAllowed(trustCase, toStatus);

      if (toStatus === 'IN_REVIEW' && trustCase.type === 'REPORT') {
        const report = await tx.orm.public.Report.where({ trustCaseId: caseId }).first();
        if (!report) throw new NotFoundException('Linked report not found');
        if (report.status === 'OPEN') {
          const updatedReport = await tx.orm.public.Report.where({ id: report.id, status: 'OPEN' }).update({ status: 'UNDER_REVIEW' });
          if (!updatedReport) throw new ConflictException('Report changed before review transition');
        }
      }

      if (toStatus === 'IN_REVIEW' && trustCase.type === 'DISPUTE') {
        const dispute = await tx.orm.public.Dispute.where({ trustCaseId: caseId }).first();
        if (!dispute) throw new NotFoundException('Linked dispute not found');
        if (dispute.status === 'OPEN') {
          const updatedDispute = await tx.orm.public.Dispute.where({ id: dispute.id, status: 'OPEN' }).update({ status: 'UNDER_REVIEW' });
          if (!updatedDispute) throw new ConflictException('Dispute changed before review transition');
        }
      }

      const now = new Date().toISOString();
      const updated = await tx.orm.public.TrustCase
        .where({ id: caseId, revision: trustCase.revision })
        .update({
          status: toStatus,
          resolvedAt: toStatus === 'RESOLVED' ? now : trustCase.resolvedAt,
          closedAt: toStatus === 'CLOSED' ? now : trustCase.closedAt,
          closedById: toStatus === 'CLOSED' ? actor.userId : trustCase.closedById,
          resolutionReason: toStatus === 'RESOLVED' || toStatus === 'CLOSED' ? cleanReason : trustCase.resolutionReason,
          resolutionCode: toStatus === 'RESOLVED' || toStatus === 'CLOSED' ? 'ADMINISTRATIVE_DECISION' : trustCase.resolutionCode,
          revision: trustCase.revision + 1,
        });
      if (!updated) throw new ConflictException('Case was modified concurrently');

      await tx.orm.public.TrustCaseHistory.create({
        caseId,
        actorId: actor.userId,
        action: toStatus === 'RESOLVED' ? 'RESOLVED' : toStatus === 'CLOSED' ? 'CLOSED' : 'DECISION',
        fromStatus: trustCase.status,
        toStatus,
        reason: cleanReason,
        metadataJson: JSON.stringify({ action: 'STATUS_TRANSITION' }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'TrustCase',
        entityId: caseId,
        details: JSON.stringify({
          action: 'STATUS_TRANSITION',
          fromStatus: trustCase.status,
          toStatus,
        }),
      });

      return this.projectCase({
        ...trustCase,
        status: toStatus,
        resolvedAt: toStatus === 'RESOLVED' ? now : trustCase.resolvedAt,
        closedAt: toStatus === 'CLOSED' ? now : trustCase.closedAt,
        closedById: toStatus === 'CLOSED' ? actor.userId : trustCase.closedById,
        resolutionReason: toStatus === 'RESOLVED' || toStatus === 'CLOSED' ? cleanReason : trustCase.resolutionReason,
        resolutionCode: toStatus === 'RESOLVED' || toStatus === 'CLOSED' ? 'ADMINISTRATIVE_DECISION' : trustCase.resolutionCode,
        revision: trustCase.revision + 1,
      });
    });
  }

  async resolveReport(actor: AuthenticatedUser, reportId: string, input: { status: 'RESOLVED' | 'DISMISSED'; reason: string; resolutionCode?: string }) {
    const cleanReason = input.reason.trim();
    if (!cleanReason) throw new BadRequestException('Report resolution reason is required');

    return db.transaction(async (tx: any) => {
      await this.requireAdmin(actor, tx);
      const report = await tx.orm.public.Report.where({ id: reportId }).first();
      if (!report) throw new NotFoundException('Report not found');
      const trustCase = await tx.orm.public.TrustCase.where({ id: report.trustCaseId }).first();
      if (!trustCase) throw new NotFoundException('Linked moderation case not found');
      if (trustCase.assignedToId && trustCase.assignedToId !== actor.userId) {
        throw new ForbiddenException('This case is assigned to another administrator');
      }
      if (!ACTIVE_CASE_STATUSES.includes(trustCase.status as ActiveCaseStatus)) {
        throw new ConflictException('Report is already resolved');
      }
      if (!['OPEN', 'UNDER_REVIEW'].includes(report.status)) {
        throw new ConflictException('Report is already resolved');
      }

      const resolutionCode = input.resolutionCode?.trim()
        || (input.status === 'DISMISSED' ? 'DISMISSED' : 'RESOLVED');
      const now = new Date().toISOString();
      const updatedReport = await tx.orm.public.Report.where({ id: report.id, status: report.status }).update({
        status: input.status,
        resolution: cleanReason,
        activeKey: null,
      });
      if (!updatedReport) throw new ConflictException('Report changed before resolution');

      const caseStatus = input.status === 'RESOLVED' ? 'RESOLVED' : 'CLOSED';
      const updatedCase = await tx.orm.public.TrustCase.where({ id: trustCase.id, revision: trustCase.revision }).update({
        status: caseStatus,
        resolvedAt: now,
        closedAt: caseStatus === 'CLOSED' ? now : trustCase.closedAt,
        closedById: caseStatus === 'CLOSED' ? actor.userId : trustCase.closedById,
        resolutionCode,
        resolutionReason: cleanReason,
        revision: trustCase.revision + 1,
      });
      if (!updatedCase) throw new ConflictException('Case changed before report resolution');

      await tx.orm.public.TrustCaseHistory.create({
        caseId: trustCase.id,
        actorId: actor.userId,
        action: caseStatus === 'RESOLVED' ? 'RESOLVED' : 'CLOSED',
        fromStatus: trustCase.status,
        toStatus: caseStatus,
        reason: cleanReason,
        metadataJson: JSON.stringify({ reportId, reportStatus: input.status, resolutionCode }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'Report',
        entityId: report.id,
        details: JSON.stringify({ action: 'REPORT_RESOLUTION', status: input.status, resolutionCode }),
      });

      return {
        id: report.id,
        status: input.status,
        resolution: cleanReason,
        resolutionCode,
        trustCaseId: trustCase.id,
        resolvedAt: now,
      };
    });
  }

  async resolveDispute(actor: AuthenticatedUser, disputeId: string, input: {
    status: 'RESOLVED' | 'REJECTED';
    resolutionCode: string;
    reason: string;
    relatedFinancialActionRef?: string;
    metadata?: Record<string, unknown>;
  }) {
    const dispute = await db.orm.public.Dispute.where({ id: disputeId }).first();
    if (!dispute) throw new NotFoundException('Dispute not found');
    await this.requireCaseAccess(actor, dispute.trustCaseId);
    return this.disputes.recordAdminResolution(actor, disputeId, input);
  }

  private assertTransitionAllowed(trustCase: any, toStatus: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED') {
    const current = trustCase.status as string;
    if (current === 'CLOSED') {
      throw new ConflictException('Case is already closed');
    }
    if (current === 'RESOLVED') {
      if (toStatus !== 'CLOSED' || trustCase.type !== 'MODERATION') {
        throw new ConflictException('Case is already terminal');
      }
      return;
    }

    if (toStatus === 'IN_REVIEW') {
      if (!['OPEN', 'ASSIGNED'].includes(current)) {
        throw new ConflictException('Case cannot transition to review from its current state');
      }
      return;
    }

    if (trustCase.type !== 'MODERATION') {
      throw new ConflictException('Report and dispute cases require their domain resolution workflow');
    }

    if (toStatus === 'RESOLVED' && current !== 'IN_REVIEW') {
      throw new ConflictException('Moderation cases must be under review before resolution');
    }

    if (toStatus === 'CLOSED' && current !== 'RESOLVED') {
      throw new ConflictException('Moderation cases must be resolved before closure');
    }
  }

  private async validateTarget(subjectType: ModerationTargetType, subjectId: string) {
    switch (subjectType) {
      case 'USER':
        if (!(await db.orm.public.User.where({ id: subjectId }).first())) throw new NotFoundException('Moderation target not found');
        return;
      case 'TASK':
        if (!(await db.orm.public.Task.where({ id: subjectId }).first())) throw new NotFoundException('Moderation target not found');
        return;
      case 'MESSAGE':
        if (!(await db.orm.public.Message.where({ id: subjectId }).first())) throw new NotFoundException('Moderation target not found');
        return;
      case 'REVIEW':
        if (!(await db.orm.public.Review.where({ id: subjectId }).first())) throw new NotFoundException('Moderation target not found');
        return;
    }
  }

  private async getTargetContext(trustCase: any) {
    const subjectType = trustCase.subjectType as string;
    const subjectId = trustCase.subjectId as string;

    if (trustCase.type === 'REPORT') {
      const report = await db.orm.public.Report.where({ trustCaseId: trustCase.id }).first();
      if (!report) throw new NotFoundException('Linked report not found');
      return this.getTargetContextByType(report.targetType, report.targetId);
    }

    if (trustCase.type === 'DISPUTE') {
      return {
        type: 'CONTRACT',
        id: subjectId,
        context: await this.getContractContext(subjectId),
      };
    }

    return this.getTargetContextByType(subjectType, subjectId);
  }

  private async getTargetContextByType(subjectType: string, subjectId: string) {
    switch (subjectType) {
      case 'USER': {
        const user = await db.orm.public.User.where({ id: subjectId }).first();
        if (!user) throw new NotFoundException('Moderation target not found');
        return {
          type: 'USER',
          id: user.id,
          status: user.status,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          createdAt: user.createdAt,
        };
      }
      case 'TASK': {
        const task = await db.orm.public.Task.where({ id: subjectId }).first();
        if (!task) throw new NotFoundException('Moderation target not found');
        return {
          type: 'TASK',
          id: task.id,
          title: task.title,
          description: task.description,
          typeValue: task.type,
          duration: task.duration,
          status: task.status,
          clientId: task.clientId,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        };
      }
      case 'MESSAGE': {
        const message = await db.orm.public.Message.where({ id: subjectId }).first();
        if (!message) throw new NotFoundException('Moderation target not found');
        const attachments = await db.orm.public.MessageAttachment.where({ messageId: subjectId }).all();
        return {
          type: 'MESSAGE',
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          messageType: message.type,
          content: message.content,
          createdAt: message.createdAt,
          attachments: attachments.map((item: any) => ({
            id: item.id,
            originalFilename: item.originalFilename,
            mimeType: item.mimeType,
            size: String(item.size),
            checksum: item.checksum,
            status: item.status,
            createdAt: item.createdAt,
          })),
        };
      }
      case 'REVIEW': {
        const review = await db.orm.public.Review.where({ id: subjectId }).first();
        if (!review) throw new NotFoundException('Moderation target not found');
        return {
          type: 'REVIEW',
          id: review.id,
          contractId: review.contractId,
          reviewerId: review.reviewerId,
          revieweeId: review.revieweeId,
          typeValue: review.type,
          rating: review.rating,
          communicationRating: review.communicationRating,
          reliabilityRating: review.reliabilityRating,
          qualityRating: review.qualityRating,
          professionalismRating: review.professionalismRating,
          comment: review.comment,
          createdAt: review.createdAt,
        };
      }
      default:
        throw new BadRequestException('Unsupported moderation target');
    }
  }

  private async getContractContext(contractId: string) {
    const contract = await db.orm.public.Contract.where({ id: contractId }).first();
    if (!contract) throw new NotFoundException('Moderation target not found');
    return {
      id: contract.id,
      taskId: contract.taskId,
      workerId: contract.workerId,
      status: contract.status,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    };
  }

  private projectCase(trustCase: any) {
    return {
      id: trustCase.id,
      type: trustCase.type,
      status: trustCase.status,
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
}
