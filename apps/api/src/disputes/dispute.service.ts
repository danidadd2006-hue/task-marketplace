import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db, type Tx } from '../prisma/db.js';
import { TrustSafetyService } from '../trust-safety/trust-safety.service.js';

export const DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'] as const;
export const DISPUTE_CATEGORIES = ['SERVICE', 'PAYMENT', 'QUALITY', 'DELIVERY', 'CONDUCT', 'OTHER'] as const;
export const DISPUTE_REASONS = [
  'WORK_NOT_COMPLETED',
  'WORK_NOT_AS_AGREED',
  'QUALITY_ISSUE',
  'PAYMENT_ISSUE',
  'DELIVERY_ISSUE',
  'MISCONDUCT',
  'OTHER',
] as const;

type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];
type DisputeReason = (typeof DISPUTE_REASONS)[number];

const REASONS_BY_CATEGORY: Record<DisputeCategory, readonly DisputeReason[]> = {
  SERVICE: ['WORK_NOT_COMPLETED', 'WORK_NOT_AS_AGREED'],
  PAYMENT: ['PAYMENT_ISSUE'],
  QUALITY: ['QUALITY_ISSUE'],
  DELIVERY: ['DELIVERY_ISSUE'],
  CONDUCT: ['MISCONDUCT'],
  OTHER: ['OTHER'],
};

const ALLOWED_PARTICIPANT_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  OPEN: ['UNDER_REVIEW'],
  UNDER_REVIEW: [],
  RESOLVED: [],
  REJECTED: [],
};

@Injectable()
export class DisputeService {
  constructor(private readonly trustSafetyService: TrustSafetyService) {}

  async createDispute(
    actor: AuthenticatedUser,
    input: {
      taskId: string;
      contractId: string;
      paymentId?: string;
      category: DisputeCategory;
      reason: DisputeReason;
      description: string;
    },
  ) {
    await this.requireActive(actor);
    this.validateTaxonomy(input.category, input.reason);
    const description = input.description.trim();
    if (description.length < 20 || description.length > 4000) {
      throw new BadRequestException('Description must be between 20 and 4000 characters');
    }

    return db.transaction(async (tx) => {
      const task = await tx.orm.public.Task.where({ id: input.taskId }).first();
      if (!task) throw new NotFoundException('Dispute relationship not found');
      const contract = await tx.orm.public.Contract.where({ id: input.contractId }).first();
      if (!contract || contract.taskId !== task.id) throw new ConflictException('Contract does not belong to task');
      if (!['COMPLETED', 'CANCELLED', 'DISPUTED'].includes(task.status)) {
        throw new ConflictException('Disputes are only available after the task reaches a post-work state');
      }
      if (!['COMPLETED', 'CANCELLED', 'DISPUTED'].includes(contract.status)) {
        throw new ConflictException('Contract is not eligible for a dispute');
      }
      if (actor.userId !== task.clientId && actor.userId !== contract.workerId) {
        throw new ForbiddenException('Only the client or selected worker may raise this dispute');
      }

      const payment = input.paymentId
        ? await tx.orm.public.Payment.where({ id: input.paymentId }).first()
        : await tx.orm.public.Payment.where({ taskId: task.id }).first();
      if (input.paymentId && !payment) throw new NotFoundException('Payment not found');
      if (payment) {
        if (
          payment.taskId !== task.id ||
          payment.contractId !== contract.id ||
          payment.clientId !== task.clientId ||
          payment.workerId !== contract.workerId
        ) {
          throw new ConflictException('Payment, task, and contract relationships do not match');
        }
      }

      const activeDuplicate = await tx.orm.public.Dispute.where({
        taskId: task.id,
        contractId: contract.id,
        raisedById: actor.userId,
      }).first();
      if (activeDuplicate && ['OPEN', 'UNDER_REVIEW'].includes(activeDuplicate.status)) {
        throw new ConflictException('An active dispute already exists for this relationship');
      }

      const caseRow = await this.trustSafetyService.createCaseInTransaction(tx, actor, {
        type: 'DISPUTE',
        category: input.category,
        subjectType: 'CONTRACT',
        subjectId: contract.id,
      });

      const dispute = await tx.orm.public.Dispute.create({
        taskId: task.id,
        contractId: contract.id,
        paymentId: payment?.id ?? null,
        raisedById: actor.userId,
        reason: input.reason,
        category: input.category,
        description,
        status: 'OPEN',
        resolution: null,
        resolutionCode: null,
        resolutionReason: null,
        resolutionActorId: null,
        resolutionAt: null,
        relatedFinancialActionRef: null,
        trustCaseId: caseRow.id,
        activeKey: this.activeKey(task.id, contract.id, actor.userId),
      });

      return this.projectDispute(dispute);
    }).catch((error) => {
      if (this.isUniqueViolation(error)) throw new ConflictException('An active dispute already exists for this relationship');
      throw error;
    });
  }

  async getDispute(actor: AuthenticatedUser, disputeId: string) {
    await this.requireActive(actor);
    const dispute = await db.orm.public.Dispute.where({ id: disputeId }).first();
    if (!dispute) throw new NotFoundException('Dispute not found');
    const participant = await this.isParticipant(actor.userId, dispute);
    if (!participant) throw new ForbiddenException('You are not authorized to view this dispute');
    return this.projectDispute(dispute);
  }

  async addEvidence(actor: AuthenticatedUser, disputeId: string, input: { evidenceType: string; referenceType: string; referenceId: string; description?: string }) {
    await this.requireActive(actor);
    const dispute = await db.orm.public.Dispute.where({ id: disputeId }).first();
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (!(await this.isParticipant(actor.userId, dispute))) throw new ForbiddenException('You are not authorized to add evidence to this dispute');
    if (['RESOLVED', 'REJECTED'].includes(dispute.status)) throw new ConflictException('Closed disputes cannot accept evidence');
    await this.validateEvidenceReference(actor.userId, dispute, input);
    return this.trustSafetyService.addEvidence(actor, dispute.trustCaseId, {
      evidenceType: this.mapEvidenceType(input.evidenceType),
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      description: input.description?.trim() || undefined,
    });
  }

  async advanceForParticipant(actor: AuthenticatedUser, disputeId: string, toStatus: DisputeStatus) {
    await this.requireActive(actor);
    const dispute = await db.orm.public.Dispute.where({ id: disputeId }).first();
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (!(await this.isParticipant(actor.userId, dispute))) throw new ForbiddenException('You are not authorized to change this dispute');
    if (!DISPUTE_STATUSES.includes(toStatus)) throw new BadRequestException('Invalid dispute status');
    if (!ALLOWED_PARTICIPANT_TRANSITIONS[dispute.status as DisputeStatus].includes(toStatus)) {
      throw new ConflictException('Dispute cannot transition to the requested status');
    }

    return db.transaction(async (tx) => {
      const updated = await tx.orm.public.Dispute.where({ id: disputeId, status: dispute.status }).update({ status: toStatus });
      if (!updated) throw new ConflictException('Dispute changed before status transition');
      await tx.orm.public.TrustCaseHistory.create({
        caseId: dispute.trustCaseId,
        actorId: actor.userId,
        action: 'DECISION',
        fromStatus: dispute.status === 'OPEN' ? 'OPEN' : 'IN_REVIEW',
        toStatus: 'IN_REVIEW',
        reason: 'Participant moved dispute into review',
        metadataJson: JSON.stringify({ disputeStatus: toStatus }),
      });
      return this.projectDispute({ ...dispute, status: toStatus });
    });
  }

  async recordAdminResolution(actor: AuthenticatedUser, disputeId: string, input: {
    status: 'RESOLVED' | 'REJECTED';
    resolutionCode: string;
    reason: string;
    relatedFinancialActionRef?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.requireAdmin(actor);
    const reason = input.reason.trim();
    if (!reason || reason.length > 4000) throw new BadRequestException('Resolution reason is required');
    if (!input.resolutionCode.trim()) throw new BadRequestException('Resolution code is required');

    return db.transaction(async (tx) => {
      const dispute = await tx.orm.public.Dispute.where({ id: disputeId }).first();
      if (!dispute) throw new NotFoundException('Dispute not found');
      if (['RESOLVED', 'REJECTED'].includes(dispute.status)) throw new ConflictException('Dispute is already terminal');

      const trustCase = await tx.orm.public.TrustCase.where({ id: dispute.trustCaseId }).first();
      if (!trustCase) throw new NotFoundException('Linked TrustCase not found');
      if (['RESOLVED', 'CLOSED'].includes(trustCase.status)) throw new ConflictException('Trust & Safety case is already terminal');

      const now = new Date().toISOString();
      const updated = await tx.orm.public.Dispute.where({ id: disputeId, status: dispute.status }).update({
        status: input.status,
        resolution: reason,
        resolutionCode: input.resolutionCode.trim(),
        resolutionReason: reason,
        resolutionActorId: actor.userId,
        resolutionAt: now,
        relatedFinancialActionRef: input.relatedFinancialActionRef?.trim() || null,
        activeKey: null,
      });
      if (!updated) throw new ConflictException('Dispute changed before resolution');

      const trustStatus = input.status === 'RESOLVED' ? 'RESOLVED' : 'CLOSED';
      const updatedCase = await tx.orm.public.TrustCase.where({ id: trustCase.id, revision: trustCase.revision }).update({
        status: trustStatus,
        resolvedAt: now,
        closedAt: trustStatus === 'CLOSED' ? now : trustCase.closedAt,
        closedById: trustStatus === 'CLOSED' ? actor.userId : trustCase.closedById,
        resolutionCode: input.resolutionCode.trim(),
        resolutionReason: reason,
        revision: trustCase.revision + 1,
      });
      if (!updatedCase) throw new ConflictException('Trust & Safety case changed before dispute resolution');

      await tx.orm.public.TrustCaseHistory.create({
        caseId: dispute.trustCaseId,
        actorId: actor.userId,
        action: input.status === 'RESOLVED' ? 'RESOLVED' : 'DECISION',
        fromStatus: dispute.status === 'OPEN' ? 'OPEN' : 'IN_REVIEW',
        toStatus: trustStatus,
        reason,
        metadataJson: JSON.stringify({ resolutionCode: input.resolutionCode, relatedFinancialActionRef: input.relatedFinancialActionRef ?? null, ...(input.metadata ?? {}) }),
      });
      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'Dispute',
        entityId: dispute.id,
        details: JSON.stringify({ status: input.status, resolutionCode: input.resolutionCode }),
      });
      return this.projectDispute({ ...dispute, status: input.status, resolution: reason, resolutionCode: input.resolutionCode.trim(), resolutionReason: reason, resolutionActorId: actor.userId, resolutionAt: now, relatedFinancialActionRef: input.relatedFinancialActionRef?.trim() || null });
    });
  }

  private async isParticipant(userId: string, dispute: { taskId: string; raisedById: string }) {
    if (dispute.raisedById === userId) return true;
    const task = await db.orm.public.Task.where({ id: dispute.taskId }).first();
    if (!task) return false;
    if (task.clientId === userId) return true;
    const contract = await db.orm.public.Contract.where({ taskId: task.id }).first();
    return contract?.workerId === userId;
  }

  private async requireActive(actor: AuthenticatedUser) {
    const user = await db.orm.public.User.where({ id: actor.userId }).first();
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
  }

  private async requireAdmin(actor: AuthenticatedUser) {
    await this.requireActive(actor);
    const roles = await db.orm.public.UserRoleAssignment.where({ userId: actor.userId }).all();
    if (!roles.some((r) => r.role === 'ADMIN')) throw new ForbiddenException('Administrative authorization required');
  }

  private validateTaxonomy(category: DisputeCategory, reason: DisputeReason) {
    if (!DISPUTE_CATEGORIES.includes(category)) throw new BadRequestException('Invalid dispute category');
    if (!DISPUTE_REASONS.includes(reason) || !REASONS_BY_CATEGORY[category].includes(reason)) throw new BadRequestException('Invalid dispute reason for category');
  }

  private activeKey(taskId: string, contractId: string, raisedById: string) {
    return [taskId, contractId, raisedById].join(':');
  }

  private mapEvidenceType(type: string) {
    const supported = new Set(['MESSAGE', 'TASK', 'CONTRACT', 'PAYMENT', 'REVIEW', 'VERIFICATION', 'MEDIA', 'ATTACHMENT', 'OTHER']);
    if (!supported.has(type)) throw new BadRequestException('Unsupported dispute evidence type');
    return type as 'ATTACHMENT' | 'MESSAGE' | 'TASK' | 'CONTRACT' | 'PAYMENT' | 'REVIEW' | 'VERIFICATION' | 'MEDIA' | 'OTHER';
  }

  private async validateEvidenceReference(userId: string, dispute: { taskId: string; contractId: string; paymentId: string | null }, input: { evidenceType: string; referenceType: string; referenceId: string }) {
    if (!input.referenceType.trim() || !input.referenceId.trim()) throw new BadRequestException('Evidence reference is required');
    const type = input.referenceType.trim().toUpperCase();
    const id = input.referenceId.trim();
    if (type === 'TASK') {
      const task = await db.orm.public.Task.where({ id }).first();
      if (!task || task.id !== dispute.taskId) throw new NotFoundException('Evidence source not found');
      return;
    }
    if (type === 'CONTRACT') {
      const contract = await db.orm.public.Contract.where({ id }).first();
      if (!contract || contract.id !== dispute.contractId) throw new NotFoundException('Evidence source not found');
      return;
    }
    if (type === 'PAYMENT') {
      if (!dispute.paymentId || id !== dispute.paymentId) throw new NotFoundException('Evidence source not found');
      const payment = await db.orm.public.Payment.where({ id }).first();
      if (!payment) throw new NotFoundException('Evidence source not found');
      if (payment.clientId !== userId && payment.workerId !== userId) throw new ForbiddenException('Evidence source is not accessible');
      return;
    }
    if (type === 'MESSAGE') {
      const message = await db.orm.public.Message.where({ id }).first();
      if (!message) throw new NotFoundException('Evidence source not found');
      const member = await db.orm.public.ConversationMember.where({ conversationId: message.conversationId, userId }).first();
      if (!member) throw new NotFoundException('Evidence source not found');
      return;
    }
    throw new BadRequestException('Unsupported dispute evidence reference');
  }

  private projectDispute(dispute: any) {
    return {
      id: dispute.id,
      taskId: dispute.taskId,
      contractId: dispute.contractId,
      paymentId: dispute.paymentId,
      raisedById: dispute.raisedById,
      category: dispute.category,
      reason: dispute.reason,
      description: dispute.description,
      status: dispute.status,
      resolution: dispute.resolution,
      resolutionCode: dispute.resolutionCode,
      resolutionReason: dispute.resolutionReason,
      resolutionAt: dispute.resolutionAt,
      relatedFinancialActionRef: dispute.relatedFinancialActionRef,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
    };
  }

  private isUniqueViolation(error: unknown) {
    const value = error as { code?: unknown; sqlState?: unknown; message?: unknown } | null;
    return value?.code === 'P2002' || value?.sqlState === '23505' || (typeof value?.message === 'string' && /unique constraint|duplicate key/i.test(value.message));
  }
}
