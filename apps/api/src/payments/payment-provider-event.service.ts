import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { db } from '../prisma/db.js';
import {
  PAYMENT_PROVIDER,
  type NormalizedPaymentProviderEvent,
  type PaymentProvider,
} from './payment-provider.js';

type SqlError = { sqlState?: string; cause?: SqlError };

function isUniqueViolation(error: unknown): boolean {
  let current: SqlError | undefined = error as SqlError | undefined;
  while (current) {
    if (current.sqlState === '23505') return true;
    current = current.cause;
  }
  return false;
}

@Injectable()
export class PaymentProviderEventService {
  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async processWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
  }) {
    const event = await this.paymentProvider.normalizeWebhook(input);
    return this.processNormalizedEvent(event);
  }

  async processNormalizedEvent(event: NormalizedPaymentProviderEvent) {
    return db.transaction(async (tx) => {
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
        SELECT "id", "taskId", "status", "amount", "currency", "provider", "providerRef"
        FROM "Payment"
        WHERE "id" = ${event.paymentId}
        FOR UPDATE
      `.returnsRow({
        id: paymentTable.columns.id,
        taskId: paymentTable.columns.taskId,
        status: paymentTable.columns.status,
        amount: paymentTable.columns.amount,
        currency: paymentTable.columns.currency,
        provider: paymentTable.columns.provider,
        providerRef: paymentTable.columns.providerRef,
      }).build();

      const payments = await tx.query(paymentPlan);
      const payment = payments[0];
      if (!payment) throw new NotFoundException('Payment not found');

      if (payment.provider && payment.provider !== event.provider) {
        throw new BadRequestException('Payment provider does not match the event');
      }
      if (
        payment.providerRef &&
        event.providerRef &&
        payment.providerRef !== event.providerRef
      ) {
        throw new BadRequestException('Payment provider reference does not match the event');
      }

      if (event.type === 'FUNDING_SUCCEEDED' && payment.status === 'FUNDED') {
        await this.recordEvent(tx, event);
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
        await this.recordEvent(tx, event);
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
        const task = await tx.orm.public.Task
          .where({ id: payment.taskId, status: 'AWAITING_PAYMENT' })
          .first();

        if (!task) {
          throw new ConflictException(
            'Task is not awaiting payment confirmation',
          );
        }

        const updatedPayment = await tx.orm.public.Payment.where({
          id: payment.id,
          status: 'PENDING',
        }).update({
          status: 'FUNDED',
          provider: event.provider,
          providerRef: event.providerRef,
          fundedAt: new Date().toISOString(),
        });

        if (!updatedPayment) {
          throw new ConflictException('Payment status changed before confirmation');
        }

        const updatedTask = await tx.orm.public.Task.where({
          id: payment.taskId,
          status: 'AWAITING_PAYMENT',
        }).update({
          status: 'FUNDED',
        });

        if (!updatedTask) {
          throw new ConflictException('Task status changed before confirmation');
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
          details: `Payment funded from provider event ${event.providerEventId}`,
        });

        await this.recordEvent(tx, event);

        return {
          status: 'PROCESSED' as const,
          eventId: event.providerEventId,
          paymentId: payment.id,
          paymentStatus: 'FUNDED' as const,
          taskStatus: 'FUNDED' as const,
        };
      }

      const nextStatus = event.type === 'FUNDING_FAILED' ? 'FAILED' : 'CANCELLED';
      const updatedPayment = await tx.orm.public.Payment.where({
        id: payment.id,
        status: 'PENDING',
      }).update({
        status: nextStatus,
        provider: event.provider,
        providerRef: event.providerRef,
      });

      if (!updatedPayment) {
        throw new ConflictException('Payment status changed before provider event processing');
      }

      await tx.orm.public.AuditLog.create({
        action: 'PAYMENT',
        entityType: 'Payment',
        entityId: payment.id,
        details: `Payment marked ${nextStatus} from provider event ${event.providerEventId}`,
      });

      await this.recordEvent(tx, event);

      return {
        status: 'PROCESSED' as const,
        eventId: event.providerEventId,
        paymentId: payment.id,
        paymentStatus: nextStatus,
      };
    });
  }

  private async recordEvent(tx: any, event: NormalizedPaymentProviderEvent) {
    try {
      return await tx.orm.public.PaymentProviderEvent.create({
        provider: event.provider,
        providerEventId: event.providerEventId,
        type: event.type,
        paymentId: event.paymentId,
        providerRef: event.providerRef,
        metadata: event.metadata,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Provider event was processed concurrently');
      }
      throw error;
    }
  }
}
