import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import type { NotificationChannel, NotificationType } from './notification.service.js';
import type {
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

function outcomeFields(outcome: NotificationDeliveryOutcome) {
  return {
    provider: outcome.provider ?? null,
    providerRef: outcome.providerRef ?? null,
    providerOutcome: outcome.providerOutcome ?? null,
    errorClass: outcome.errorClass ?? null,
    uncertaintyInfo: outcome.uncertaintyInfo ?? null,
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

    if (!channelEligible) {
      return {
        notificationId,
        channel,
        eligible: false,
        attempt: null,
        reason: 'CHANNEL_DISABLED_BY_NOTIFICATION_POLICY',
      };
    }

    const notification = await this.loadNotification(notificationId);
    if (notification.status !== 'ACTIVE') {
      return {
        notificationId,
        channel,
        eligible: true,
        attempt: null,
        reason: 'NOTIFICATION_NOT_ACTIVE',
      };
    }

    if (notification.expiresAt && new Date(notification.expiresAt).getTime() <= Date.now()) {
      return {
        notificationId,
        channel,
        eligible: true,
        attempt: null,
        reason: 'NOTIFICATION_EXPIRED',
      };
    }

    const recipient = await db.orm.public.User.where({ id: notification.userId }).first();
    if (!recipient) throw new NotFoundException('Notification recipient not found');

    const attempt = await this.getOrCreateInitialAttempt(notification, channel as NotificationChannel);
    const currentAttempt = await this.getAttempt(attempt.id);

    if (isTerminalState(currentAttempt.status)) {
      return {
        notificationId,
        channel: channel as NotificationChannel,
        eligible: true,
        attempt: this.projectAttempt(currentAttempt),
      };
    }

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
      if (recipient.status !== 'ACTIVE') {
        outcome = {
          status: 'FAILED',
          providerOutcome: 'recipient_account_inactive',
          errorClass: 'NO_DESTINATION',
        };
      } else {
        const instructions = await this.buildInstructions(notification, recipient, channel as NotificationChannel);
        outcome = await this.dispatch(notification, instructions);
      }
    } catch (error) {
      outcome = {
        status: 'UNKNOWN',
        uncertaintyInfo: 'Delivery boundary failed before returning a normalized provider outcome.',
        errorClass: error instanceof Error ? error.name : 'UNKNOWN_DELIVERY_ERROR',
      };
    }

    const completed = await this.transitionAttemptStatus(processingAttempt.id, outcome.status, outcome);
    return {
      notificationId,
      channel: channel as NotificationChannel,
      eligible: true,
      attempt: this.projectAttempt(completed),
    };
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

  private async getOrCreateInitialAttempt(
    notification: PersistedNotification,
    channel: NotificationChannel,
  ): Promise<DeliveryAttemptRow> {
    const attemptNumber = 1;
    const existing = await db.orm.public.NotificationDeliveryAttempt
      .where({ notificationId: notification.id, channel, attemptNumber })
      .first();

    if (existing) return existing as DeliveryAttemptRow;

    const candidate = {
      notificationId: notification.id,
      recipientUserId: notification.userId,
      channel,
      attemptNumber,
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
        .where({ notificationId: notification.id, channel, attemptNumber })
        .first();

      if (!concurrent) throw new ConflictException('Delivery attempt was created concurrently');
      return concurrent as DeliveryAttemptRow;
    }
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
