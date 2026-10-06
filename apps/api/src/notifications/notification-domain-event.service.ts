import { Injectable, Logger } from '@nestjs/common';
import { db } from '../prisma/db.js';
import { NotificationService, type NotificationChannel } from './notification.service.js';

const DELIVERY_CHANNELS: readonly NotificationChannel[] = ['IN_APP', 'EMAIL', 'PUSH'];

@Injectable()
export class NotificationDomainEventService {
  private readonly logger = new Logger(NotificationDomainEventService.name);

  constructor(private readonly notificationService: NotificationService) {}

  async applicationCreated(applicationId: string): Promise<void> {
    const application = await db.orm.public.Application.where({ id: applicationId }).first();
    if (!application || application.status !== 'SUBMITTED') return;

    await this.emit({
      eventId: `Application:${application.id}:application.created:v1`,
      eventType: 'application.created',
      aggregateType: 'Application',
      aggregateId: application.id,
      notificationType: 'APPLICATION',
      taskId: application.taskId,
      applicationId: application.id,
      titleKey: 'application.created',
      messageKey: 'application.created',
    });
  }

  async applicationAccepted(applicationId: string): Promise<void> {
    const application = await db.orm.public.Application.where({ id: applicationId }).first();
    if (!application || application.status !== 'ACCEPTED') return;

    await this.emit({
      eventId: `Application:${application.id}:application.accepted:v1`,
      eventType: 'application.accepted',
      aggregateType: 'Application',
      aggregateId: application.id,
      notificationType: 'APPLICATION',
      recipientUserId: application.workerId,
      taskId: application.taskId,
      applicationId: application.id,
      titleKey: 'application.accepted',
      messageKey: 'application.accepted',
    });
  }

  async contractCreated(contractId: string): Promise<void> {
    const contract = await db.orm.public.Contract.where({ id: contractId }).first();
    if (!contract || contract.status !== 'ACTIVE') return;

    const task = await db.orm.public.Task.where({ id: contract.taskId }).first();
    if (!task) return;

    for (const recipientUserId of new Set([task.clientId, contract.workerId])) {
      await this.emit({
        eventId: `Contract:${contract.id}:contract.created:v1`,
        eventType: 'contract.created',
        aggregateType: 'Contract',
        aggregateId: contract.id,
        notificationType: 'CONTRACT',
        recipientUserId,
        taskId: task.id,
        contractId: contract.id,
        titleKey: 'contract.created',
        messageKey: 'contract.created',
      });
    }
  }

  async messageCreated(messageId: string): Promise<void> {
    const message = await db.orm.public.Message.where({ id: messageId }).first();
    if (!message) return;

    const members = await db.orm.public.ConversationMember
      .where({ conversationId: message.conversationId })
      .all();

    for (const recipientUserId of new Set(
      (members as Array<{ userId: string }>).map((member) => member.userId),
    )) {
      if (recipientUserId === message.senderId) continue;

      await this.emit({
        eventId: `Message:${message.id}:message.created:v1`,
        eventType: 'message.created',
        aggregateType: 'Message',
        aggregateId: message.id,
        notificationType: 'MESSAGE',
        recipientUserId,
        messageId: message.id,
        titleKey: 'message.created',
        messageKey: 'message.created',
      });
    }
  }

  async paymentFunded(paymentId: string): Promise<void> {
    const payment = await db.orm.public.Payment.where({ id: paymentId }).first();
    if (!payment || payment.status !== 'FUNDED') return;

    for (const recipientUserId of new Set(
      [payment.clientId, payment.workerId].filter((value): value is string => Boolean(value)),
    )) {
      await this.emit({
        eventId: `Payment:${payment.id}:payment.funded:v1`,
        eventType: 'payment.funded',
        aggregateType: 'Payment',
        aggregateId: payment.id,
        notificationType: 'PAYMENT',
        recipientUserId,
        paymentId: payment.id,
        titleKey: 'payment.updated',
        messageKey: 'payment.updated',
      });
    }
  }

  async paymentReleased(paymentId: string): Promise<void> {
    const payment = await db.orm.public.Payment.where({ id: paymentId }).first();
    if (!payment || payment.status !== 'RELEASED') return;

    for (const recipientUserId of new Set(
      [payment.clientId, payment.workerId].filter((value): value is string => Boolean(value)),
    )) {
      await this.emit({
        eventId: `Payment:${payment.id}:payment.released:v1`,
        eventType: 'payment.released',
        aggregateType: 'Payment',
        aggregateId: payment.id,
        notificationType: 'PAYMENT',
        recipientUserId,
        paymentId: payment.id,
        titleKey: 'payment.updated',
        messageKey: 'payment.updated',
      });
    }
  }

  async refundSucceeded(refundId: string): Promise<void> {
    const refund = await db.orm.public.Refund.where({ id: refundId }).first();
    if (!refund || refund.status !== 'SUCCEEDED') return;

    const payment = await db.orm.public.Payment.where({ id: refund.paymentId }).first();
    if (!payment || payment.status !== 'REFUNDED') return;

    for (const recipientUserId of new Set(
      [payment.clientId, payment.workerId].filter((value): value is string => Boolean(value)),
    )) {
      await this.emit({
        eventId: `Refund:${refund.id}:refund.succeeded:v1`,
        eventType: 'refund.succeeded',
        aggregateType: 'Refund',
        aggregateId: refund.id,
        notificationType: 'PAYMENT',
        recipientUserId,
        paymentId: payment.id,
        titleKey: 'payment.updated',
        messageKey: 'payment.updated',
        referenceMetadata: {
          paymentId: payment.id,
          refundId: refund.id,
        },
      });
    }
  }

  private async emit(input: Parameters<NotificationService['createFromDomainEvent']>[0]): Promise<void> {
    try {
      const notification = await this.notificationService.createFromDomainEvent(input);

      for (const channel of DELIVERY_CHANNELS) {
        await this.notificationService.deliverNotification(notification.id, channel);
      }
    } catch (error) {
      this.logger.warn(
        `Notification domain event ${input.eventId} could not be fully emitted; authoritative domain state remains unchanged.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
