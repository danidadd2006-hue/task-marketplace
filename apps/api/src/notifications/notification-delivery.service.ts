import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import type { NotificationChannel, NotificationType } from './notification.service.js';
import type {
  NotificationDeliveryFailureClass,
  NotificationDeliveryInstructions,
  NotificationDeliveryNotification,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
} from './notification-delivery.provider.js';
import { EmailNotificationDeliveryProvider } from './email-notification-delivery.provider.js';
import { InAppNotificationDeliveryProvider } from './in-app-notification-delivery.provider.js';
import { PushNotificationDeliveryProvider } from './push-notification-delivery.provider.js';

type DeliveryAttemptStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

type PersistedNotification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  deepLink: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'SUPPRESSED';
  expiresAt: string | null;
};

type DeliveryAttemptRow = {
  id: string;
  notificationId: string;
  recipientUserId: string;
  channel: NotificationChannel;
  attemptNumber: number;
  status: DeliveryAttemptStatus;
  startedAt: string | null;
  completedAt: string | null;
  provider: string | null;
  providerRef: string | null;
  providerOutcome: string | null;
  errorClass: string | null;
  uncertaintyInfo: string | null;
  createdAt: string;
};

type DeliveryResult = {
  notificationId: string;
  channel: NotificationChannel;
  eligible: boolean;
  attempt: ReturnType<NotificationDeliveryService['projectAttempt']> | null;
  reason?: string;
};

const SUPPORTED_CHANNELS = new Set<NotificationChannel>(['IN_APP', 'EMAIL', 'PUSH']);
const TERMINAL_STATES = new Set<DeliveryAttemptStatus>(['SUCCEEDED', 'FAILED', 'UNKNOWN']);
const MAX_DELIVERY_ATTEMPTS = 3;
const FAILURE_CLASSES = new Set<NotificationDeliveryFailureClass>([
  'PERMANENT_FAILURE',
  'TRANSIENT_FAILURE',
  'UNKNOWN',
  'SUPPRESSED',
  'NO_DESTINATION',
]);

function isSupportedChannel(value: string): value is NotificationChannel {
  return SUPPORTED_CHANNELS.has(value as NotificationChannel);
}

function isTerminalState(value: DeliveryAttemptStatus): boolean {
  return TERMINAL_STATES.has(value);
}

function isUniqueViolation(error: unknown): boolean {
  let current = error as { sqlState?: string; cause?: unknown } | undefined;
  while (current) {
    if (current.sqlState === '23505') return true;
    current = current.cause as typeof current | undefined;
  }
  return false;
}

function normalizeFailureClass(errorClass: string | undefined): string | null {
  if (!errorClass) return null;
  if (FAILURE_CLASSES.has(errorClass as NotificationDeliveryFailureClass)) return errorClass;
  if (errorClass === 'INVALID_INSTRUCTION') return 'PERMANENT_FAILURE';
  return errorClass;
}

function normalizeOutcome(outcome: NotificationDeliveryOutcome): NotificationDeliveryOutcome {
  if (outcome.status === 'SUCCEEDED') {
    if (!outcome.provider?.trim() || !outcome.providerOutcome?.trim()) {
      throw new ConflictException('Successful delivery requires a trusted provider outcome');
    }
    return {
      ...outcome,
      errorClass: undefined,
      uncertaintyInfo: undefined,
    };
  }

  if (outcome.status === 'UNKNOWN') {
    return {
      ...outcome,
      errorClass: 'UNKNOWN',
      uncertaintyInfo: outcome.uncertaintyInfo?.trim() || 'Delivery outcome is uncertain and requires trusted reconciliation.',
    };
  }

  return {
    ...outcome,
    errorClass: normalizeFailureClass(outcome.errorClass) ?? 'UNKNOWN',
  };
}

function outcomeFields(outcome: NotificationDeliveryOutcome) {
  const normalized = normalizeOutcome(outcome);
  return {
    provider: normalized.provider ?? null,
    providerRef: normalized.providerRef ?? null,
    providerOutcome: normalized.providerOutcome ?? null,
    errorClass: normalized.errorClass ?? null,
    uncertaintyInfo: normalized.uncertaintyInfo ?? null,
  };
}

@Injectable()
export class NotificationDeliveryService {
  private readonly providers: Readonly<Record<NotificationChannel, NotificationDeliveryProvider>>;

  constructor(
    private readonly inAppProvider: InAppNotificationDeliveryProvider,
    private readonly emailProvider: EmailNotificationDeliveryProvider,
    private readonly pushProvider: PushNotificationDeliveryProvider,
  ) {
    this.providers = {
      IN_APP: inAppProvider,
      EMAIL: emailProvider,
      PUSH: pushProvider,
    };
  }

  async deliverPersistedNotification(
    notificationId: string,
    channel: string,
    channelEligible: boolean,
  ): Promise<DeliveryResult> {
    if (!isSupportedChannel(channel)) {
      throw new BadRequestException('Unsupported notification delivery channel');
    }

    const supportedChannel = channel as NotificationChannel;
    const notification = await this.loadNotification(notificationId);

    if (notification.status !== 'ACTIVE') {
      return {
        notificationId,
        channel: supportedChannel,
        eligible: true,
        attempt: null,
        reason: 'NOTIFICATION_NOT_ACTIVE',
      };
    }

    if (this.isExpired(notification)) {
      return {
        notificationId,
        channel: supportedChannel,
        eligible: true,
        attempt: null,
        reason: 'NOTIFICATION_EXPIRED',
      };
    }

    const attempt = await this.getLatestOrCreateInitialAttempt(notification, supportedChannel);
    const currentAttempt = await this.getAttempt(attempt.id);

    if (isTerminalState(currentAttempt.status)) {
      return {
        notificationId,
        channel: supportedChannel,
        eligible: channelEligible,
        attempt: this.projectAttempt(currentAttempt),
        reason: channelEligible ? undefined : 'CHANNEL_DISABLED_BY_NOTIFICATION_POLICY',
      };
    }

    if (!channelEligible) {
      if (currentAttempt.status === 'PROCESSING') {
        throw new ConflictException('Notification delivery attempt is already processing');
      }
      if (currentAttempt.status !== 'PENDING') {
        throw new ConflictException('Notification delivery attempt is not deliverable');
      }

      await this.transitionAttemptStatus(currentAttempt.id, 'PROCESSING');
      const suppressed = await this.transitionAttemptStatus(currentAttempt.id, 'FAILED', {
        status: 'FAILED',
        providerOutcome: 'channel_suppressed_by_notification_policy',
        errorClass: 'SUPPRESSED',
      });
      return {
        notificationId,
        channel: supportedChannel,
        eligible: false,
        attempt: this.projectAttempt(suppressed),
        reason: 'CHANNEL_DISABLED_BY_NOTIFICATION_POLICY',
      };
    }

    if (notification.status !== 'ACTIVE') {
      return {
        notificationId,
        channel: supportedChannel,
        eligible: true,
        attempt: null,
        reason: 'NOTIFICATION_NOT_ACTIVE',
      };
    }

    if (this.isExpired(notification)) {
      return {
        notificationId,
        channel: supportedChannel,
        eligible: true,
        attempt: null,
        reason: 'NOTIFICATION_EXPIRED',
      };
    }

    const recipient = await db.orm.public.User.where({ id: notification.userId }).first();
    if (!recipient) throw new NotFoundException('Notification recipient not found');

    if (currentAttempt.status === 'PROCESSING') {
      throw new ConflictException('Notification delivery attempt is already processing');
    }

    if (currentAttempt.status !== 'PENDING') {
      throw new ConflictException('Notification delivery attempt is not deliverable');
    }

    await this.transitionAttemptStatus(currentAttempt.id, 'PROCESSING');
    const processingAttempt = await this.getAttempt(currentAttempt.id);

    let outcome: NotificationDeliveryOutcome;
    try {
      const processingNotification = await this.loadNotification(notificationId);
      if (processingNotification.status !== 'ACTIVE') {
        outcome = {
          status: 'FAILED',
          providerOutcome: 'notification_not_active',
          errorClass: 'SUPPRESSED',
        };
      } else if (this.isExpired(processingNotification)) {
        outcome = {
          status: 'FAILED',
          providerOutcome: 'notification_expired',
          errorClass: 'SUPPRESSED',
        };
      } else {
        const processingRecipient = await db.orm.public.User.where({ id: processingNotification.userId }).first();
        if (!processingRecipient || processingRecipient.status !== 'ACTIVE') {
          outcome = {
            status: 'FAILED',
            providerOutcome: 'recipient_account_inactive',
            errorClass: 'NO_DESTINATION',
          };
        } else {
          const instructions = await this.buildInstructions(
            processingNotification,
            processingRecipient,
            supportedChannel,
          );
          outcome = normalizeOutcome(await this.dispatch(processingNotification, instructions));
        }
      }
    } catch (error) {
      outcome = {
        status: 'UNKNOWN',
        uncertaintyInfo: 'Delivery boundary failed before returning a trusted normalized provider outcome.',
        errorClass: 'UNKNOWN',
      };
    }

    const completed = await this.transitionAttemptStatus(processingAttempt.id, outcome.status, outcome);
    return {
      notificationId,
      channel: supportedChannel,
      eligible: true,
      attempt: this.projectAttempt(completed),
    };
  }

  async createSubsequentAttempt(
    notificationId: string,
    channel: string,
    channelEligible: boolean,
  ): Promise<ReturnType<NotificationDeliveryService['projectAttempt']>> {
    if (!isSupportedChannel(channel)) {
      throw new BadRequestException('Unsupported notification delivery channel');
    }
    if (!channelEligible) {
      throw new ConflictException('Notification delivery channel is not eligible');
    }

    const notification = await this.loadNotification(notificationId);
    if (notification.status !== 'ACTIVE') {
      throw new ConflictException('Notification is not active');
    }
    if (this.isExpired(notification)) {
      throw new ConflictException('Notification has expired');
    }

    const attempts = await this.getAttempts(notificationId, channel as NotificationChannel);
    const latest = attempts.reduce<DeliveryAttemptRow | null>(
      (current, candidate) => (!current || candidate.attemptNumber > current.attemptNumber ? candidate : current),
      null,
    );

    if (!latest) {
      throw new ConflictException('An initial delivery attempt must exist before creating a subsequent attempt');
    }
    if (latest.status === 'UNKNOWN') {
      throw new ConflictException('UNKNOWN delivery outcomes require trusted reconciliation before retry');
    }
    if (latest.status !== 'FAILED') {
      throw new ConflictException('Only failed delivery attempts may be retried');
    }
    if (latest.attemptNumber >= MAX_DELIVERY_ATTEMPTS) {
      throw new ConflictException('Maximum notification delivery attempts reached');
    }

    const nextAttemptNumber = latest.attemptNumber + 1;
    const candidate = {
      notificationId: notification.id,
      recipientUserId: notification.userId,
      channel: channel as NotificationChannel,
      attemptNumber: nextAttemptNumber,
      status: 'PENDING' as const,
      startedAt: null,
      completedAt: null,
      provider: null,
      providerRef: null,
      providerOutcome: null,
      errorClass: null,
      uncertaintyInfo: null,
    };

    try {
      return this.projectAttempt(
        (await db.orm.public.NotificationDeliveryAttempt.create(candidate)) as DeliveryAttemptRow,
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const concurrent = await db.orm.public.NotificationDeliveryAttempt
        .where({ notificationId: notification.id, channel: channel as NotificationChannel, attemptNumber: nextAttemptNumber })
        .first();
      if (!concurrent) throw new ConflictException('Subsequent delivery attempt was created concurrently');
      return this.projectAttempt(concurrent as DeliveryAttemptRow);
    }
  }

  async transitionAttemptStatus(
    attemptId: string,
    nextStatus: DeliveryAttemptStatus,
    outcome?: NotificationDeliveryOutcome,
  ): Promise<DeliveryAttemptRow> {
    const attempt = await this.getAttempt(attemptId);

    if (!['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(nextStatus)) {
      throw new BadRequestException('Unsupported notification delivery attempt status');
    }

    if (isTerminalState(attempt.status)) {
      throw new ConflictException('Terminal notification delivery attempts cannot transition');
    }

    if (attempt.status === 'PENDING' && nextStatus !== 'PROCESSING') {
      throw new BadRequestException('PENDING delivery attempts may only transition to PROCESSING');
    }

    if (attempt.status === 'PROCESSING' && !isTerminalState(nextStatus)) {
      throw new BadRequestException('PROCESSING delivery attempts may only transition to a terminal state');
    }

    if (nextStatus === 'PROCESSING' && outcome) {
      throw new BadRequestException('Provider outcome is not valid for PROCESSING');
    }

    if (isTerminalState(nextStatus) && (!outcome || outcome.status !== nextStatus)) {
      throw new BadRequestException('A normalized provider outcome is required for terminal delivery state');
    }

    const update = nextStatus === 'PROCESSING'
      ? {
          status: nextStatus,
          startedAt: attempt.startedAt ?? new Date().toISOString(),
        }
      : {
          status: nextStatus,
          startedAt: attempt.startedAt ?? new Date().toISOString(),
          completedAt: new Date().toISOString(),
          ...outcomeFields(outcome!),
        };

    const updated = await db.orm.public.NotificationDeliveryAttempt
      .where({ id: attemptId, status: attempt.status })
      .update(update);

    if (!updated) {
      throw new ConflictException('Notification delivery attempt changed before status transition');
    }

    return this.getAttempt(attemptId);
  }

  private async loadNotification(notificationId: string): Promise<PersistedNotification> {
    const row = await db.orm.public.Notification.where({ id: notificationId }).first();
    if (!row) throw new NotFoundException('Notification not found');
    return row as PersistedNotification;
  }

  private async getAttempt(attemptId: string): Promise<DeliveryAttemptRow> {
    const row = await db.orm.public.NotificationDeliveryAttempt.where({ id: attemptId }).first();
    if (!row) throw new NotFoundException('Notification delivery attempt not found');
    return row as DeliveryAttemptRow;
  }

  private async getLatestOrCreateInitialAttempt(
    notification: PersistedNotification,
    channel: NotificationChannel,
  ): Promise<DeliveryAttemptRow> {
    const attempts = await this.getAttempts(notification.id, channel);
    const latest = attempts.reduce<DeliveryAttemptRow | null>(
      (current, candidate) => (!current || candidate.attemptNumber > current.attemptNumber ? candidate : current),
      null,
    );
    if (latest) return latest;

    const candidate = {
      notificationId: notification.id,
      recipientUserId: notification.userId,
      channel,
      attemptNumber: 1,
      status: 'PENDING' as const,
      startedAt: null,
      completedAt: null,
      provider: null,
      providerRef: null,
      providerOutcome: null,
      errorClass: null,
      uncertaintyInfo: null,
    };

    try {
      return (await db.orm.public.NotificationDeliveryAttempt.create(candidate)) as DeliveryAttemptRow;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const concurrent = await db.orm.public.NotificationDeliveryAttempt
        .where({ notificationId: notification.id, channel, attemptNumber: 1 })
        .first();
      if (!concurrent) throw new ConflictException('Delivery attempt was created concurrently');
      return concurrent as DeliveryAttemptRow;
    }
  }

  private async getAttempts(notificationId: string, channel: NotificationChannel): Promise<DeliveryAttemptRow[]> {
    const rows = await db.orm.public.NotificationDeliveryAttempt
      .where({ notificationId, channel })
      .all();
    return rows as DeliveryAttemptRow[];
  }

  private isExpired(notification: PersistedNotification): boolean {
    return Boolean(notification.expiresAt && new Date(notification.expiresAt).getTime() <= Date.now());
  }

  private async buildInstructions(
    notification: PersistedNotification,
    recipient: { id: string; email: string; status: string },
    channel: NotificationChannel,
  ): Promise<NotificationDeliveryInstructions> {
    const deliveryNotification = this.projectDeliveryNotification(notification);

    switch (channel) {
      case 'IN_APP':
        return { channel, notification: deliveryNotification };
      case 'EMAIL':
        if (!recipient.email?.trim()) {
          return {
            channel,
            notification: deliveryNotification,
            recipient: { userId: recipient.id, email: '' },
          };
        }
        return {
          channel,
          notification: deliveryNotification,
          recipient: {
            userId: recipient.id,
            email: recipient.email,
          },
        };
      case 'PUSH': {
        const devices = await db.orm.public.PushDevice
          .where({ userId: recipient.id, status: 'ACTIVE' })
          .all();

        return {
          channel,
          notification: deliveryNotification,
          devices: (devices as Array<{ id: string; provider: string; platform: string }>).map((device) => ({
            id: device.id,
            provider: device.provider,
            platform: device.platform,
          })),
        };
      }
    }
  }

  private async dispatch(
    notification: PersistedNotification,
    instructions: NotificationDeliveryInstructions,
  ): Promise<NotificationDeliveryOutcome> {
    const provider = this.providers[instructions.channel];
    return provider.deliver(this.projectDeliveryNotification(notification), instructions);
  }

  private projectDeliveryNotification(notification: PersistedNotification): NotificationDeliveryNotification {
    return {
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      eventId: notification.eventId,
      eventType: notification.eventType,
      aggregateType: notification.aggregateType,
      aggregateId: notification.aggregateId,
      deepLink: notification.deepLink,
    };
  }

  private projectAttempt(row: DeliveryAttemptRow) {
    return {
      id: row.id,
      notificationId: row.notificationId,
      recipientUserId: row.recipientUserId,
      channel: row.channel,
      attemptNumber: row.attemptNumber,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      provider: row.provider,
      providerRef: row.providerRef,
      providerOutcome: row.providerOutcome,
      errorClass: row.errorClass,
      uncertaintyInfo: row.uncertaintyInfo,
      createdAt: row.createdAt,
    };
  }
}
