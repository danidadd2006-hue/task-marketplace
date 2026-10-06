import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { db } from '../prisma/db.js';
import { Optional } from '@nestjs/common';
import { NotificationDomainEventService } from '../notifications/notification-domain-event.service.js';
import {
  PAYMENT_PROVIDER,
  type NormalizedPaymentProviderEvent,
  type PaymentProvider,
} from './payment-provider.js';

function normalizeDecimal(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException('Provider amount is not a valid decimal');
  }

  const [wholeRaw, fractionRaw = ''] = normalized.split('.');
  let whole = wholeRaw;
  let fraction = fractionRaw;

  while (whole.length > 1 && whole.startsWith('0')) {
    whole = whole.slice(1);
  }
  while (fraction.endsWith('0')) {
    fraction = fraction.slice(0, -1);
  }

  return `${whole}.${fraction || '0'}`;
}

@Injectable()
export class PaymentProviderEventService {
  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    @Optional() private readonly notificationDomainEventService?: NotificationDomainEventService,
  ) {}

  async processWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }) {
    // No payment mutation occurs before the provider adapter has verified the
    // raw request and re-queried the provider for authoritative transaction data.
    const event = await this.paymentProvider.normalizeWebhook(input);
    return this.processNormalizedEvent(event);
  }

  async processNormalizedEvent(event: NormalizedPaymentProviderEvent) {
    const result = await db.transaction(async (tx) => {
      const existingEvent = await tx.orm.public.PaymentProviderEvent
        .where({
          provider: event.provider,
          providerEventId: event.providerEventId,
        })
        .first();

      if (existingEvent) {
        return {
          status: 'DUPLICATE' as const,
          eventId: existingEvent.id,
          paymentId: existingEvent.paymentId,
          paymentStatus: 'UNCHANGED' as const,
        };
      }

      const paymentTable = tx.sql.public.payment;
      const paymentPlan = tx.raw.sql`
        SELECT
          "id",
          "taskId",
          "contractId",
          "status",
          "amount",
          "currency",
          "provider",
          "providerRef"
        FROM "Payment"
        WHERE "id" = ${event.paymentId}
        FOR UPDATE
      `.returnsRow({
        id: paymentTable.columns.id,
        taskId: paymentTable.columns.taskId,
        contractId: paymentTable.columns.contractId,
        status: paymentTable.columns.status,
        amount: paymentTable.columns.amount,
        currency: paymentTable.columns.currency,
        provider: paymentTable.columns.provider,
        providerRef: paymentTable.columns.providerRef,
      }).build();

      const payments = await tx.query(paymentPlan);
      const payment = payments[0];

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      // The payment lock serialises different terminal events for the same
      // Payment. The second lookup also closes the duplicate-event race.
      const committedEvent = await tx.orm.public.PaymentProviderEvent
        .where({
          provider: event.provider,
          providerEventId: event.providerEventId,
        })
        .first();

      if (committedEvent) {
        return {
          status: 'DUPLICATE' as const,
          eventId: committedEvent.id,
          paymentId: committedEvent.paymentId,
          paymentStatus: 'UNCHANGED' as const,
        };
      }

      if (payment.provider && payment.provider !== event.provider) {
        throw new BadRequestException(
          'Payment provider does not match the event',
        );
      }

      if (
        normalizeDecimal(payment.amount) !== normalizeDecimal(event.amount) ||
        payment.currency.toUpperCase() !== event.currency.trim().toUpperCase()
      ) {
        throw new ConflictException(
          'Provider transaction amount or currency does not match the payment',
        );
      }

      if (
        payment.providerRef &&
        event.providerRef &&
        payment.providerRef !== event.providerRef
      ) {
        throw new BadRequestException(
          'Payment provider reference does not match the event',
        );
      }

      const recordedEvent = await this.recordEventIfAbsent(tx, event);
      if (!recordedEvent) {
        const duplicateEvent = await tx.orm.public.PaymentProviderEvent
          .where({
            provider: event.provider,
            providerEventId: event.providerEventId,
          })
          .first();

        if (!duplicateEvent) {
          throw new ConflictException(
            'Provider event conflict could not be resolved safely',
          );
        }

        return {
          status: 'DUPLICATE' as const,
          eventId: duplicateEvent.id,
          paymentId: duplicateEvent.paymentId,
          paymentStatus: 'UNCHANGED' as const,
        };
      }

      if (event.type === 'FUNDING_SUCCEEDED' && payment.status === 'FUNDED') {
        return {
          status: 'ALREADY_APPLIED' as const,
          eventId: event.providerEventId,
          paymentId: payment.id,
          paymentStatus: 'FUNDED' as const,
        };
      }

      if (
        (event.type === 'FUNDING_FAILED' && payment.status === 'FAILED') ||
        (event.type === 'FUNDING_CANCELLED' && payment.status === 'CANCELLED')
      ) {
        return {
          status: 'ALREADY_APPLIED' as const,
          eventId: event.providerEventId,
          paymentId: payment.id,
          paymentStatus: payment.status,
        };
      }

      if (payment.status !== 'PENDING') {
        throw new ConflictException(
          `Payment cannot transition from ${payment.status} using ${event.type}`,
        );
      }

      if (event.type === 'FUNDING_SUCCEEDED') {
        const taskTable = tx.sql.public.task;
        const taskPlan = tx.raw.sql`
          SELECT "id", "status", "currency"
          FROM "Task"
          WHERE "id" = ${payment.taskId}
          FOR UPDATE
        `.returnsRow({
          id: taskTable.columns.id,
          status: taskTable.columns.status,
          currency: taskTable.columns.currency,
        }).build();

        const tasks = await tx.query(taskPlan);
        const task = tasks[0];

        if (!task || task.status !== 'AWAITING_PAYMENT') {
          throw new ConflictException(
            'Task is not awaiting payment confirmation',
          );
        }

        if (task.currency !== payment.currency) {
          throw new ConflictException(
            'Payment currency does not match the task currency',
          );
        }

        const contract = await tx.orm.public.Contract
          .where({
            id: payment.contractId,
            taskId: payment.taskId,
            status: 'ACTIVE',
          })
          .first();

        if (!contract) {
          throw new ConflictException(
            'Payment contract is no longer eligible for funding',
          );
        }

        if (contract.agreedPrice !== payment.amount) {
          throw new ConflictException(
            'Payment amount does not match the contract amount',
          );
        }

        const updatedPayment = await tx.orm.public.Payment.where({
          id: payment.id,
          status: 'PENDING',
        }).update({
          status: 'FUNDED',
          provider: event.provider,
          providerRef: event.providerRef ?? payment.providerRef,
          fundedAt: new Date().toISOString(),
        });

        if (!updatedPayment) {
          throw new ConflictException(
            'Payment status changed before confirmation',
          );
        }

        const updatedTask = await tx.orm.public.Task.where({
          id: payment.taskId,
          status: 'AWAITING_PAYMENT',
        }).update({
          status: 'FUNDED',
        });

        if (!updatedTask) {
          throw new ConflictException(
            'Task status changed before confirmation',
          );
        }

        await tx.orm.public.LedgerEntry.create({
          paymentId: payment.id,
          taskId: payment.taskId,
          type: 'FUNDING',
          amount: payment.amount,
          currency: payment.currency,
          description: 'Payment funded after verified provider confirmation',
          reference: event.providerEventId,
        });

        await tx.orm.public.AuditLog.create({
          action: 'PAYMENT',
          entityType: 'Payment',
          entityId: payment.id,
          details: `Payment funded from verified provider event ${event.providerEventId}`,
        });

        return {
          status: 'PROCESSED' as const,
          eventId: event.providerEventId,
          paymentId: payment.id,
          paymentStatus: 'FUNDED' as const,
          taskStatus: 'FUNDED' as const,
        };
      }

      const nextStatus =
        event.type === 'FUNDING_FAILED' ? 'FAILED' : 'CANCELLED';

      const updatedPayment = await tx.orm.public.Payment.where({
        id: payment.id,
        status: 'PENDING',
      }).update({
        status: nextStatus,
        provider: event.provider,
        providerRef: event.providerRef ?? payment.providerRef,
      });

      if (!updatedPayment) {
        throw new ConflictException(
          'Payment status changed before provider event processing',
        );
      }

      await tx.orm.public.AuditLog.create({
        action: 'PAYMENT',
        entityType: 'Payment',
        entityId: payment.id,
        details: `Payment marked ${nextStatus} from verified provider event ${event.providerEventId}`,
      });

      return {
        status: 'PROCESSED' as const,
        eventId: event.providerEventId,
        paymentId: payment.id,
        paymentStatus: nextStatus,
      };
    });

    if (result.paymentStatus === 'FUNDED') {
      await this.notificationDomainEventService?.paymentFunded(result.paymentId);
    }
    return result;
  }

  private async recordEventIfAbsent(
    tx: any,
    event: NormalizedPaymentProviderEvent,
  ): Promise<Record<string, unknown> | null> {
    const eventTable = tx.sql.public.paymentProviderEvent;
    const eventId = randomUUID();
    const plan = tx.raw.sql`
      INSERT INTO "PaymentProviderEvent"
        ("id", "provider", "providerEventId", "type", "paymentId", "providerRef", "metadata")
      VALUES
        (${eventId}, ${event.provider}, ${event.providerEventId}, ${event.type},
         ${event.paymentId}, ${event.providerRef}, ${event.metadata})
      ON CONFLICT ("provider", "providerEventId") DO NOTHING
      RETURNING "id", "paymentId"
    `.returnsRow({
      id: eventTable.columns.id,
      paymentId: eventTable.columns.paymentId,
    }).build();

    const inserted = await tx.query(plan);
    return inserted[0] ?? null;
  }
}
