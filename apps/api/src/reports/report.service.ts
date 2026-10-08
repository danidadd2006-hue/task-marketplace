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
import type { CreateReportDto } from './dto/create-report.dto.js';
import {
  ReportCategoryDto,
  ReportReasonDto,
  ReportTargetTypeDto,
} from './dto/create-report.dto.js';
import type { AddReportEvidenceDto } from './dto/add-report-evidence.dto.js';
import { ReportEvidenceReferenceTypeDto } from './dto/add-report-evidence.dto.js';

const REASONS_BY_CATEGORY: Record<ReportCategoryDto, readonly ReportReasonDto[]> = {
  CONTENT: [ReportReasonDto.INAPPROPRIATE_CONTENT, ReportReasonDto.SPAM, ReportReasonDto.MISREPRESENTATION, ReportReasonDto.OTHER],
  CONDUCT: [ReportReasonDto.HARASSMENT, ReportReasonDto.SPAM, ReportReasonDto.OTHER],
  SAFETY: [ReportReasonDto.SAFETY_CONCERN, ReportReasonDto.HARASSMENT, ReportReasonDto.OTHER],
  TRANSACTION: [ReportReasonDto.FRAUD_OR_DECEPTION, ReportReasonDto.MISREPRESENTATION, ReportReasonDto.OTHER],
  PRIVACY: [ReportReasonDto.PRIVACY_VIOLATION, ReportReasonDto.OTHER],
  AUTHENTICITY: [ReportReasonDto.MISREPRESENTATION, ReportReasonDto.FRAUD_OR_DECEPTION, ReportReasonDto.OTHER],
  OTHER: [ReportReasonDto.OTHER],
};

export interface ReportProjection {
  id: string;
  targetType: ReportTargetTypeDto;
  targetId: string;
  category: ReportCategoryDto;
  reason: ReportReasonDto;
  description: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED';
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ReportService {
  constructor(private readonly trustSafetyService: TrustSafetyService) {}

  async createReport(user: AuthenticatedUser, dto: CreateReportDto): Promise<ReportProjection> {
    const targetType = dto.targetType;
    const targetId = dto.targetId.trim();
    const category = dto.category;
    const reason = dto.reason;
    const description = dto.description.trim();

    this.validateTaxonomy(targetType, category, reason);
    if (!targetId) throw new BadRequestException('Report target is required');
    if (!description) throw new BadRequestException('Report description is required');

    try {
      return await db.transaction(async (tx) => {
        const reporter = await tx.orm.public.User.where({ id: user.userId }).first();
        this.assertActive(reporter);

        const target = await this.validateTarget(tx, user.userId, targetType, targetId);
        const activeKey = this.activeKey(user.userId, targetType, targetId);
        const existing = await tx.orm.public.Report.where({ activeKey }).first();
        if (existing) throw new ConflictException('An active report already exists for this target');

        const trustCase = await this.trustSafetyService.createCaseInTransaction(tx, user, {
          type: 'REPORT',
          category,
          subjectType: targetType,
          subjectId: targetId,
        });

        const report = await tx.orm.public.Report.create({
          reporterId: user.userId,
          targetType,
          targetId,
          category,
          reportedUserId: target.reportedUserId,
          taskId: target.taskId,
          messageId: target.messageId,
          reason,
          description,
          status: 'OPEN',
          resolution: null,
          trustCaseId: trustCase.id,
          activeKey,
        });

        return this.projectReport(report as ReportProjection);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('An active report already exists for this target');
      }
      throw error;
    }
  }

  async getMyReport(user: AuthenticatedUser, reportId: string): Promise<ReportProjection> {
    const subject = await db.orm.public.User.where({ id: user.userId }).first();
    this.assertActive(subject);

    const report = await db.orm.public.Report.where({ id: reportId, reporterId: user.userId }).first();
    if (!report) throw new NotFoundException('Report not found');
    return this.projectReport(report as ReportProjection);
  }

  async addEvidence(user: AuthenticatedUser, reportId: string, dto: AddReportEvidenceDto) {
    const subject = await db.orm.public.User.where({ id: user.userId }).first();
    this.assertActive(subject);

    const report = await db.orm.public.Report.where({ id: reportId, reporterId: user.userId }).first();
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'OPEN' && report.status !== 'UNDER_REVIEW') {
      throw new ConflictException('Evidence cannot be added to a closed report');
    }

    const referenceId = dto.referenceId.trim();
    if (!referenceId) throw new BadRequestException('Evidence reference is required');
    await this.validateEvidenceReference(user.userId, report as ReportProjection, dto, referenceId);

    const evidence = await this.trustSafetyService.addEvidence(user, report.trustCaseId, {
      evidenceType: 'ATTACHMENT',
      referenceType: dto.referenceType,
      referenceId,
      description: dto.description?.trim() || undefined,
    });

    return {
      id: evidence.id,
      evidenceType: evidence.evidenceType,
      description: evidence.description,
      createdAt: evidence.createdAt,
    };
  }

  private async validateTarget(tx: Tx, reporterId: string, targetType: ReportTargetTypeDto, targetId: string) {
    switch (targetType) {
      case ReportTargetTypeDto.USER: {
        const target = await tx.orm.public.User.where({ id: targetId }).first();
        if (!target) throw new NotFoundException('Reportable target not found');
        if (target.id === reporterId) throw new BadRequestException('You cannot report your own account');
        return { reportedUserId: target.id, taskId: null, messageId: null };
      }
      case ReportTargetTypeDto.TASK: {
        const target = await tx.orm.public.Task.where({ id: targetId }).first();
        if (!target) throw new NotFoundException('Reportable target not found');
        return { reportedUserId: null, taskId: target.id, messageId: null };
      }
      case ReportTargetTypeDto.MESSAGE: {
        const message = await tx.orm.public.Message.where({ id: targetId }).first();
        if (!message) throw new NotFoundException('Reportable target not found');
        const member = await tx.orm.public.ConversationMember
          .where({ conversationId: message.conversationId, userId: reporterId })
          .first();
        if (!member) throw new NotFoundException('Reportable target not found');
        return { reportedUserId: null, taskId: null, messageId: message.id };
      }
      case ReportTargetTypeDto.REVIEW: {
        const review = await tx.orm.public.Review.where({ id: targetId }).first();
        if (!review) throw new NotFoundException('Reportable target not found');
        return { reportedUserId: null, taskId: null, messageId: null };
      }
      default:
        throw new BadRequestException('Unsupported report target');
    }
  }

  private async validateEvidenceReference(
    reporterId: string,
    report: { targetType: ReportTargetTypeDto; targetId: string },
    dto: AddReportEvidenceDto,
    referenceId: string,
  ) {
    if (dto.referenceType === ReportEvidenceReferenceTypeDto.TASK_ATTACHMENT) {
      if (report.targetType !== ReportTargetTypeDto.TASK) {
        throw new BadRequestException('Task attachment evidence is only valid for task reports');
      }
      const attachment = await db.orm.public.TaskAttachment.where({ id: referenceId }).first();
      if (!attachment || attachment.taskId !== report.targetId) {
        throw new NotFoundException('Evidence source not found');
      }
      return;
    }

    if (dto.referenceType === ReportEvidenceReferenceTypeDto.MESSAGE_ATTACHMENT) {
      if (report.targetType !== ReportTargetTypeDto.MESSAGE) {
        throw new BadRequestException('Message attachment evidence is only valid for message reports');
      }
      const attachment = await db.orm.public.MessageAttachment.where({ id: referenceId }).first();
      if (!attachment || attachment.messageId !== report.targetId) {
        throw new NotFoundException('Evidence source not found');
      }
      const message = await db.orm.public.Message.where({ id: report.targetId }).first();
      if (!message) throw new NotFoundException('Evidence source not found');
      const member = await db.orm.public.ConversationMember
        .where({ conversationId: message.conversationId, userId: reporterId })
        .first();
      if (!member) throw new NotFoundException('Evidence source not found');
      return;
    }

    throw new BadRequestException('Unsupported report evidence reference');
  }

  private validateTaxonomy(targetType: ReportTargetTypeDto, category: ReportCategoryDto, reason: ReportReasonDto) {
    if (!Object.values(ReportTargetTypeDto).includes(targetType)) {
      throw new BadRequestException('Unsupported report target');
    }
    if (!Object.values(ReportCategoryDto).includes(category)) {
      throw new BadRequestException('Invalid report category');
    }
    if (!REASONS_BY_CATEGORY[category].includes(reason)) {
      throw new BadRequestException('Invalid report reason for category');
    }
  }

  private assertActive(user: { id: string; status: string } | null) {
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
  }

  private activeKey(reporterId: string, targetType: ReportTargetTypeDto, targetId: string) {
    return reporterId + ':' + targetType + ':' + targetId;
  }

  private projectReport(report: ReportProjection): ReportProjection {
    return {
      id: report.id,
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
  }

  private isUniqueViolation(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: unknown; message?: unknown };
    return candidate.code === 'P2002'
      || candidate.code === '23505'
      || (typeof candidate.message === 'string' && /unique constraint|duplicate key/i.test(candidate.message));
  }
}
