import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db, type Tx } from '../prisma/db.js';

type NotificationType =
  | 'MESSAGE'
  | 'APPLICATION'
  | 'CONTRACT'
  | 'PAYMENT'
  | 'REVIEW'
  | 'DISPUTE'
  | 'REPORT'
  | 'VERIFICATION'
  | 'SYSTEM';

type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH';
type NotificationStatus = 'ACTIVE' | 'EXPIRED' | 'SUPPRESSED';

type ReferenceKind = 'taskId' | 'contractId' | 'applicationId' | 'paymentId' | 'messageId';

type TrustedNotificationEvent = {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  notificationType: NotificationType;
  recipientUserId?: string;
  taskId?: string;
  contractId?: string;
  applicationId?: string;
  paymentId?: string;
  messageId?: string;
  titleKey: string;
  messageKey: string;
  referenceMetadata?: Record<string, string | number | boolean | null>;
  deepLink?: string | null;
  expiresAt?: string | null;
};

type NotificationProjection = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  taskId: string | null;
  contractId: string | null;
  applicationId: string | null;
  paymentId: string | null;
  messageId: string | null;
  referenceMetadata: string | null;
  deepLink: string | null;
  status: NotificationStatus;
  readAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type NotificationRow = NotificationProjection;

type SqlError = { sqlState?: string; cause?: SqlError };

function isUniqueViolation(error: unknown): boolean {
  let current: SqlError | undefined = error as SqlError | undefined;
  while (current) {
    if (current.sqlState === '23505') return true;
    current = current.cause;
  }
  return false;
}

const DEFAULT_MESSAGES: Record<string, { title: string; message: string }> = {
  'message.created': { title: 'New message', message: 'You have a new message.' },
  'application.created': { title: 'New application', message: 'A worker applied to your task.' },
  'application.accepted': { title: 'Application accepted', message: 'Your application was accepted.' },
  'application.rejected': { title: 'Application update', message: 'Your application was rejected.' },
  'contract.created': { title: 'Contract update', message: 'A contract is ready for your attention.' },
  'payment.updated': { title: 'Payment update', message: 'A payment requires your attention.' },
  'review.created': { title: 'New review', message: 'You received a new review.' },
  'dispute.updated': { title: 'Dispute update', message: 'A dispute requires your attention.' },
  'report.updated': { title: 'Report update', message: 'A report requires your attention.' },
  'verification.updated': { title: 'Verification update', message: 'Your verification status changed.' },
  'security.account': { title: 'Account security', message: 'There is an important update about your account.' },
};

const SECURITY_TYPES = new Set<NotificationType>(['SYSTEM', 'VERIFICATION']);
const CRITICAL_TYPES = new Set<NotificationType>(['PAYMENT', 'DISPUTE', 'CONTRACT']);

@Injectable()
export class NotificationService {
  async createFromDomainEvent(input: TrustedNotificationEvent): Promise<NotificationProjection> {
    this.validateTrustedInput(input);

    const recipientUserId = await db.transaction(async (tx) =>
      this.resolveRecipient(tx, input),
    );

    return db.transaction(async (tx) => {
      const existing = await tx.orm.public.Notification.where({
        eventId: input.eventId,
        userId: recipientUserId,
        type: input.notificationType,
      }).first();

      if (existing) return this.projectNotification(existing as NotificationRow);

      const recipient = await tx.orm.public.User.where({ id: recipientUserId }).first();
      if (!recipient) throw new NotFoundException('Notification recipient not found');
      if (recipient.status !== 'ACTIVE') {
        throw new ForbiddenException('Notification recipient account is not active');
      }

      const projection = this.buildProjection(input, recipientUserId);
      let created: NotificationRow | null = null;
      try {
        created = (await tx.orm.public.Notification.create(projection)) as NotificationRow;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        created = (await tx.orm.public.Notification.where({
          eventId: input.eventId,
          userId: recipientUserId,
          type: input.notificationType,
        }).first()) as NotificationRow | null;
        if (!created) throw new ConflictException('Notification was created concurrently');
      }

      return this.projectNotification(created);
    });
  }

  async getPreferenceEligibility(
    userId: string,
    type: NotificationType,
  ): Promise<Record<NotificationChannel, boolean>> {
    const rows = await db.orm.public.NotificationPreference.where({ userId, type }).all();
    const result: Record<NotificationChannel, boolean> = {
      IN_APP: true,
      EMAIL: true,
      PUSH: true,
    };

    for (const channel of Object.keys(result) as NotificationChannel[]) {
      const row = rows.find((candidate) => candidate.channel === channel);
      result[channel] = this.channelEligible(type, channel, row?.enabled ?? null);
    }
    return result;
  }

  async listForUser(user: AuthenticatedUser, page = 1, pageSize = 50) {
    this.validatePositivePage(page, pageSize);
    const normalizedPageSize = Math.min(pageSize, 100);
    const offset = (page - 1) * normalizedPageSize;

    const current = await db.orm.public.User.where({ id: user.userId }).first();
    if (!current) throw new NotFoundException('User not found');
    if (current.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');

    const rows = await db.orm.public.Notification
      .where({ userId: user.userId })
      .orderBy([(notification) => notification.createdAt.desc(), (notification) => notification.id.desc()])
      .offset(offset)
      .limit(normalizedPageSize + 1)
      .all();

    const hasMore = rows.length > normalizedPageSize;
    const items = rows.slice(0, normalizedPageSize).map((row) => this.projectNotification(row as NotificationRow));
    return { items, page, pageSize: normalizedPageSize, hasMore };
  }

  async getForUser(user: AuthenticatedUser, notificationId: string) {
    await this.assertActiveUser(user.userId);
    const row = await db.orm.public.Notification.where({ id: notificationId, userId: user.userId }).first();
    if (!row) throw new NotFoundException('Notification not found');
    return this.projectNotification(row as NotificationRow);
  }

  async markRead(user: AuthenticatedUser, notificationId: string) {
    await this.assertActiveUser(user.userId);
    const row = await db.orm.public.Notification.where({ id: notificationId, userId: user.userId }).first();
    if (!row) throw new NotFoundException('Notification not found');

    const updated = await db.orm.public.Notification.where({ id: notificationId, userId: user.userId }).update({
      readAt: row.readAt ?? new Date().toISOString(),
    });
    if (!updated) throw new ConflictException('Notification changed before read state could be updated');

    const refreshed = await db.orm.public.Notification.where({ id: notificationId, userId: user.userId }).first();
    if (!refreshed) throw new NotFoundException('Notification not found');
    return this.projectNotification(refreshed as NotificationRow);
  }

  private validateTrustedInput(input: TrustedNotificationEvent) {
    if (!input.eventId?.trim()) throw new BadRequestException('Server-generated eventId is required');
    if (!input.eventType?.trim()) throw new BadRequestException('eventType is required');
    if (!input.aggregateType?.trim() || !input.aggregateId?.trim()) {
      throw new BadRequestException('Aggregate identity is required');
    }
    if (!input.titleKey?.trim() || !input.messageKey?.trim()) {
      throw new BadRequestException('Server notification templates are required');
    }
    if (input.deepLink?.includes('://')) {
      throw new BadRequestException('Notification deepLink must remain an internal application reference');
    }
    if (input.expiresAt && Number.isNaN(new Date(input.expiresAt).getTime())) {
      throw new BadRequestException('Invalid notification expiry');
    }
    this.validateReferenceConsistency(input);
  }

  private validateReferenceConsistency(input: TrustedNotificationEvent) {
    const references: ReferenceKind[] = ['taskId', 'contractId', 'applicationId', 'paymentId', 'messageId'];
    const supplied = references.filter((key) => input[key] !== undefined);
    if (supplied.length === 0) return;

    if (input.aggregateType === 'Task' && input.taskId && input.aggregateId !== input.taskId) {
      throw new BadRequestException('Task aggregate and taskId must match');
    }
    if (input.aggregateType === 'Contract' && input.contractId && input.aggregateId !== input.contractId) {
      throw new BadRequestException('Contract aggregate and contractId must match');
    }
    if (input.aggregateType === 'Application' && input.applicationId && input.aggregateId !== input.applicationId) {
      throw new BadRequestException('Application aggregate and applicationId must match');
    }
    if (input.aggregateType === 'Payment' && input.paymentId && input.aggregateId !== input.paymentId) {
      throw new BadRequestException('Payment aggregate and paymentId must match');
    }
    if (input.aggregateType === 'Message' && input.messageId && input.aggregateId !== input.messageId) {
      throw new BadRequestException('Message aggregate and messageId must match');
    }
  }

  private async resolveRecipient(tx: Tx, input: TrustedNotificationEvent): Promise<string> {
    switch (input.notificationType) {
      case 'MESSAGE':
        if (!input.messageId) throw new BadRequestException('MESSAGE notifications require messageId');
        if (input.recipientUserId === undefined) throw new BadRequestException('MESSAGE notifications require a candidate recipient');
        return this.resolveMessageRecipient(tx, input.messageId, input.recipientUserId);
      case 'APPLICATION':
        if (!input.applicationId) throw new BadRequestException('APPLICATION notifications require applicationId');
        if (input.eventType === 'application.created') return this.resolveNewApplicationRecipient(tx, input.applicationId, input.recipientUserId);
        return this.resolveApplicationWorkerRecipient(tx, input.applicationId, input.recipientUserId);
      case 'CONTRACT':
        if (!input.contractId) throw new BadRequestException('CONTRACT notifications require contractId');
        return this.resolveContractParty(tx, input.contractId, input.recipientUserId);
      case 'PAYMENT':
        if (!input.paymentId) throw new BadRequestException('PAYMENT notifications require paymentId');
        return this.resolvePaymentParty(tx, input.paymentId, input.recipientUserId);
      case 'VERIFICATION':
      case 'SYSTEM':
        if (!input.recipientUserId) throw new BadRequestException('Account notifications require recipientUserId');
        return this.resolveAccountOwner(tx, input.recipientUserId);
      case 'REVIEW':
      case 'DISPUTE':
      case 'REPORT':
        if (!input.recipientUserId) throw new BadRequestException('Recipient is required for this notification type');
        return this.resolveExplicitRecipient(tx, input.recipientUserId, input);
      default:
        throw new BadRequestException('Unsupported notification type');
    }
  }

  private async resolveMessageRecipient(tx: Tx, messageId: string, candidate: string) {
    const message = await tx.orm.public.Message.where({ id: messageId }).first();
    if (!message) throw new NotFoundException('Message not found');
    const member = await tx.orm.public.ConversationMember.where({ conversationId: message.conversationId, userId: candidate }).first();
    if (!member) throw new ForbiddenException('Recipient is not an authorised conversation participant');
    if (message.senderId === candidate) throw new BadRequestException('A message notification cannot target the sender');
    return candidate;
  }

  private async resolveNewApplicationRecipient(tx: Tx, applicationId: string, candidate?: string) {
    const application = await tx.orm.public.Application.where({ id: applicationId }).first();
    if (!application) throw new NotFoundException('Application not found');
    const task = await tx.orm.public.Task.where({ id: application.taskId }).first();
    if (!task || task.clientId === application.workerId) throw new ConflictException('Application/task relationship is invalid');
    if (candidate !== undefined && candidate !== task.clientId) throw new ForbiddenException('Recipient does not own the application task');
    return task.clientId;
  }

  private async resolveApplicationWorkerRecipient(tx: Tx, applicationId: string, candidate?: string) {
    const application = await tx.orm.public.Application.where({ id: applicationId }).first();
    if (!application) throw new NotFoundException('Application not found');
    if (candidate !== undefined && candidate !== application.workerId) throw new ForbiddenException('Recipient is not the application worker');
    return application.workerId;
  }

  private async resolveContractParty(tx: Tx, contractId: string, candidate?: string) {
    const contract = await tx.orm.public.Contract.where({ id: contractId }).first();
    if (!contract) throw new NotFoundException('Contract not found');
    const task = await tx.orm.public.Task.where({ id: contract.taskId }).first();
    if (!task) throw new NotFoundException('Contract task not found');
    const parties = new Set([task.clientId, contract.workerId]);
    if (!candidate || !parties.has(candidate)) throw new ForbiddenException('Recipient is not an authorised contract party');
    return candidate;
  }

  private async resolvePaymentParty(tx: Tx, paymentId: string, candidate?: string) {
    const payment = await tx.orm.public.Payment.where({ id: paymentId }).first();
    if (!payment) throw new NotFoundException('Payment not found');
    const parties = [payment.clientId, payment.workerId].filter((id): id is string => Boolean(id));
    if (!candidate || !parties.includes(candidate)) throw new ForbiddenException('Recipient is not an authorised payment party');
    return candidate;
  }

  private async resolveAccountOwner(tx: Tx, candidate: string) {
    const user = await tx.orm.public.User.where({ id: candidate }).first();
    if (!user) throw new NotFoundException('Account owner not found');
    return user.id;
  }

  private async resolveExplicitRecipient(tx: Tx, candidate: string, input: TrustedNotificationEvent) {
    const user = await tx.orm.public.User.where({ id: candidate }).first();
    if (!user) throw new NotFoundException('Recipient not found');

    if (input.applicationId) return this.resolveApplicationWorkerRecipient(tx, input.applicationId, candidate);
    if (input.contractId) return this.resolveContractParty(tx, input.contractId, candidate);
    if (input.paymentId) return this.resolvePaymentParty(tx, input.paymentId, candidate);
    if (input.messageId) return this.resolveMessageRecipient(tx, input.messageId, candidate);
    if (input.taskId) {
      const task = await tx.orm.public.Task.where({ id: input.taskId }).first();
      if (!task) throw new NotFoundException('Task not found');
      if (task.clientId !== candidate) throw new ForbiddenException('Recipient is not authorised for the task');
      return candidate;
    }
    return user.id;
  }

  private buildProjection(input: TrustedNotificationEvent, userId: string) {
    const template = DEFAULT_MESSAGES[input.messageKey] ?? DEFAULT_MESSAGES[input.eventType];
    if (!template) throw new BadRequestException('Unsupported server notification template');
    const status = this.statusForExpiry(input.expiresAt ?? null);
    return {
      userId,
      type: input.notificationType,
      title: this.resolveTitle(input.titleKey, template.title),
      message: this.resolveMessage(input.messageKey, template.message),
      eventId: input.eventId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      taskId: input.taskId ?? null,
      contractId: input.contractId ?? null,
      applicationId: input.applicationId ?? null,
      paymentId: input.paymentId ?? null,
      messageId: input.messageId ?? null,
      referenceMetadata: input.referenceMetadata ? JSON.stringify(input.referenceMetadata) : null,
      deepLink: input.deepLink ?? null,
      status,
      readAt: null,
      expiresAt: input.expiresAt ?? null,
    };
  }

  private resolveTitle(key: string, fallback: string) {
    const template = DEFAULT_MESSAGES[key];
    return template?.title ?? fallback;
  }

  private resolveMessage(key: string, fallback: string) {
    const template = DEFAULT_MESSAGES[key];
    return template?.message ?? fallback;
  }

  private statusForExpiry(expiresAt: string | null): NotificationStatus {
    if (!expiresAt) return 'ACTIVE';
    return new Date(expiresAt).getTime() <= Date.now() ? 'EXPIRED' : 'ACTIVE';
  }

  private channelEligible(type: NotificationType, channel: NotificationChannel, explicit: boolean | null) {
    if (SECURITY_TYPES.has(type) || CRITICAL_TYPES.has(type)) return true;
    return explicit ?? true;
  }

  private projectNotification(row: NotificationRow) {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      title: row.title,
      message: row.message,
      eventId: row.eventId,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      taskId: row.taskId,
      contractId: row.contractId,
      applicationId: row.applicationId,
      paymentId: row.paymentId,
      messageId: row.messageId,
      referenceMetadata: row.referenceMetadata,
      deepLink: row.deepLink,
      status: this.statusForStoredNotification(row),
      readAt: row.readAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  private statusForStoredNotification(row: NotificationRow): NotificationStatus {
    if (row.status === 'ACTIVE' && row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'EXPIRED';
    return row.status;
  }

  private async assertActiveUser(userId: string) {
    const user = await db.orm.public.User.where({ id: userId }).first();
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');
  }

  private validatePositivePage(page: number, pageSize: number) {
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new BadRequestException('pageSize must be a positive integer');
  }
}

export type { TrustedNotificationEvent, NotificationChannel, NotificationType };
