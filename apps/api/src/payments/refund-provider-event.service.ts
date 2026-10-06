import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NotificationDomainEventService } from '../notifications/notification-domain-event.service.js';
import { db, type Tx } from '../prisma/db.js';
import { RefundStateService } from './refund-state.service.js';
import type { NormalizedRefundProviderEvent, NormalizedRefundProviderResult } from './payment-provider.js';

type RefundOutcome = 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

@Injectable()
export class RefundProviderEventService {
  constructor(
    private readonly refundStateService: RefundStateService,
    @Optional() private readonly notificationDomainEventService?: NotificationDomainEventService,
  ) {}

  async processWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
    normalize: (input: {
      body: unknown;
      headers: Record<string, string | string[] | undefined>;
      rawBody: string;
    }) => Promise<NormalizedRefundProviderEvent>;
  }) {
    const event = await input.normalize({
      body: input.body,
      headers: input.headers,
      rawBody: input.rawBody,
    });
    return this.processNormalizedEvent(event);
  }

  async processNormalizedEvent(event: NormalizedRefundProviderEvent) {
    const result = await db.transaction(async (tx) => {
      const duplicate = await tx.orm.public.RefundProviderEvent.where({
        provider: event.provider,
        providerEventId: event.providerEventId,
      }).first();

      if (duplicate) {
        return {
          status: 'DUPLICATE' as const,
          eventId: duplicate.id,
          refundId: duplicate.refundId,
          refundStatus: 'UNCHANGED' as const,
        };
      }

      const refund = (await this.correlateRefund(tx, event)) as any;
      if (!refund) {
        await this.auditUnresolved(tx, event);
        return {
          status: 'UNRESOLVED' as const,
          eventId: event.providerEventId,
          refundId: null,
          refundStatus: 'UNCHANGED' as const,
        };
      }

      const payment = (await this.lockPayment(tx, refund.paymentId)) as any;
      if (!payment) throw new NotFoundException('Refund payment not found');

      if (payment.provider && payment.provider !== event.provider) {
        throw new BadRequestException('Refund provider does not match the event');
      }

      if (refund.provider && refund.provider !== event.provider) {
        throw new BadRequestException('Refund provider does not match the event');
      }

      if (refund.providerRef && event.providerRef && refund.providerRef !== event.providerRef) {
        throw new ConflictException('Refund provider reference does not match the event');
      }

      if (refund.amount !== event.amount || refund.currency.toUpperCase() !== event.currency.trim().toUpperCase()) {
        throw new ConflictException('Refund amount or currency does not match the authoritative refund');
      }

      const recorded = await this.recordEventIfAbsent(tx, event, refund.id);
      if (!recorded) {
        const concurrent = await tx.orm.public.RefundProviderEvent.where({
          provider: event.provider,
          providerEventId: event.providerEventId,
        }).first();
        if (!concurrent) {
          throw new ConflictException('Refund provider event conflict could not be resolved safely');
        }
        return {
          status: 'DUPLICATE' as const,
          eventId: concurrent.id,
          refundId: concurrent.refundId,
          refundStatus: 'UNCHANGED' as const,
        };
      }

      await tx.orm.public.AuditLog.create({
        action: 'REFUND',
        entityType: 'RefundProviderEvent',
        entityId: recorded.id,
        details: JSON.stringify({
          event: 'REFUND_PROVIDER_EVENT_ACCEPTED_AND_CORRELATED',
          provider: event.provider,
          providerEventId: event.providerEventId,
          refundId: refund.id,
          providerRefundId: event.providerRefundId,
          providerRef: event.providerRef,
          paymentProviderRef: event.paymentProviderRef,
          outcome: event.type,
        }),
      });

      const nextStatus = this.outcomeFor(event.type);
      const currentStatus = refund.status as RefundOutcome;

      if (payment.status === 'RELEASED' && nextStatus === 'SUCCEEDED') {
        await tx.orm.public.AuditLog.create({
          action: 'REFUND',
          entityType: 'RefundProviderEvent',
          entityId: recorded.id,
          details: JSON.stringify({
            event: 'POST_RELEASE_REFUND_EVENT',
            provider: event.provider,
            providerEventId: event.providerEventId,
            refundId: refund.id,
            paymentId: payment.id,
            providerOutcome: nextStatus,
            paymentStatus: payment.status,
          }),
        });
        return {
          status: 'POST_RELEASE_CONFLICT' as const,
          eventId: recorded.id,
          refundId: refund.id,
          refundStatus: currentStatus,
          paymentStatus: payment.status,
        };
      }

      if (currentStatus === 'SUCCEEDED' || currentStatus === 'FAILED') {
        await tx.orm.public.AuditLog.create({
          action: 'REFUND',
          entityType: 'RefundProviderEvent',
          entityId: recorded.id,
          details: JSON.stringify({
            event: 'CONFLICTING_TERMINAL_PROVIDER_EVENT',
            provider: event.provider,
            providerEventId: event.providerEventId,
            refundId: refund.id,
            currentState: currentStatus,
            providerOutcome: nextStatus,
          }),
        });
        return {
          status: 'CONFLICTING_TERMINAL' as const,
          eventId: recorded.id,
          refundId: refund.id,
          refundStatus: currentStatus,
        };
      }

      const transition = await this.refundStateService.transitionInTransaction(
        refund.id,
        nextStatus,
        tx,
        {
          provider: event.provider,
          providerRef: event.providerRef,
          failureMessage:
            nextStatus === 'FAILED' ? 'Provider reported refund failure' : null,
          uncertaintyReason:
            nextStatus === 'UNKNOWN' ? 'Provider event did not establish a definitive refund outcome' : null,
          metadata: event.metadata,
        },
      );

      await tx.orm.public.Refund.where({ id: refund.id }).update({
        reconciledAt: new Date().toISOString(),
      });

      return {
        status: transition.idempotent ? 'ALREADY_APPLIED' as const : 'PROCESSED' as const,
        eventId: recorded.id,
        refundId: refund.id,
        refundStatus: transition.status,
        paymentStatus: transition.paymentStatus,
      };
    });

    if (result.refundStatus === 'SUCCEEDED' && result.refundId) {
      await this.notificationDomainEventService?.refundSucceeded(result.refundId);
    }

    return result;
  }

  async reconcileRefund(
    refundId: string,
    reconcile: (input: {
      refundId: string;
      providerRef: string;
      amount: string;
      currency: string;
      metadata?: string | null;
    }) => Promise<NormalizedRefundProviderResult>,
  ) {
    const refund = await db.orm.public.Refund.where({ id: refundId }).first();
    if (!refund) throw new NotFoundException('Refund not found');

    if (refund.status === 'SUCCEEDED' || refund.status === 'FAILED') {
      return {
        status: 'ALREADY_TERMINAL' as const,
        refundId: refund.id,
        refundStatus: refund.status,
      };
    }

    if (!refund.providerRef) {
      throw new ConflictException('Refund has no provider reference for reconciliation');
    }

    if (!refund.provider) {
      throw new ConflictException('Refund has no provider for reconciliation');
    }

    const result = await reconcile({
      refundId: refund.id,
      providerRef: refund.providerRef,
      amount: refund.amount,
      currency: refund.currency,
      metadata: refund.reconciliationMetadata,
    });

    const reconciled = await db.transaction(async (tx) => {
      const current = (await this.lockRefund(tx, refund.id)) as any;
      if (!current) throw new NotFoundException('Refund not found');

      if (current.status === 'SUCCEEDED' || current.status === 'FAILED') {
        return {
          status: 'ALREADY_TERMINAL' as const,
          refundId: current.id,
          refundStatus: current.status,
        };
      }

      const transition = await this.refundStateService.transitionInTransaction(
        current.id,
        result.status,
        tx,
        {
          provider: result.provider,
          providerRef: result.providerRef,
          failureCode: result.failureCode,
          failureMessage: result.failureMessage,
          uncertaintyReason: result.uncertaintyReason,
          metadata: result.metadata,
        },
      );

      await tx.orm.public.Refund.where({ id: current.id }).update({
        reconciledAt: new Date().toISOString(),
      });

      return {
        status: transition.idempotent ? 'ALREADY_APPLIED' as const : 'RECONCILED' as const,
        refundId: current.id,
        refundStatus: transition.status,
        paymentStatus: transition.paymentStatus,
      };
    });

    if (reconciled.refundStatus === 'SUCCEEDED' && reconciled.refundId) {
      await this.notificationDomainEventService?.refundSucceeded(reconciled.refundId);
    }

    return reconciled;
  }

  private outcomeFor(type: NormalizedRefundProviderEvent['type']): RefundOutcome {
    switch (type) {
      case 'REFUND_PROCESSING':
        return 'PROCESSING';
      case 'REFUND_SUCCEEDED':
        return 'SUCCEEDED';
      case 'REFUND_FAILED':
        return 'FAILED';
      case 'REFUND_UNKNOWN':
        return 'UNKNOWN';
    }
  }

  private async correlateRefund(tx: Tx, event: NormalizedRefundProviderEvent) {
    if (event.providerRef) {
      const byProviderRef = await tx.orm.public.Refund.where({
        provider: event.provider,
        providerRef: event.providerRef,
      }).first();
      if (byProviderRef) return byProviderRef;
    }

    if (event.paymentProviderRef) {
      const payment = await tx.orm.public.Payment.where({
        provider: event.provider,
        providerRef: event.paymentProviderRef,
      }).first();
      if (payment) {
        const refunds = (await tx.orm.public.Refund.where({
          paymentId: payment.id,
        }).all()) as any[];
        const candidates = refunds.filter((value) => value.provider === event.provider);
        if (candidates.length === 1) return candidates[0];
      }
    }

    if (event.providerRefundId) {
      const refunds = (await tx.orm.public.Refund.where({
        provider: event.provider,
      }).all()) as any[];
      const match = refunds.find((value) => {
        if (!value.reconciliationMetadata) return false;
        try {
          const metadata = JSON.parse(value.reconciliationMetadata) as Record<string, unknown>;
          return String(metadata.providerRefundId ?? '') === event.providerRefundId;
        } catch {
          return false;
        }
      });
      if (match) return match;
    }

    return null;
  }

  private async recordEventIfAbsent(
    tx: Tx,
    event: NormalizedRefundProviderEvent,
    refundId: string,
  ) {
    const table = tx.sql.public.refundProviderEvent;
    const id = randomUUID();
    const plan = db.raw.sql`
      INSERT INTO "RefundProviderEvent"
        ("id", "provider", "providerEventId", "refundId", "type", "providerRef", "metadata")
      VALUES
        (${id}, ${event.provider}, ${event.providerEventId}, ${refundId}, ${event.type}, ${event.providerRef ?? ''}, ${event.metadata ?? ''})
      ON CONFLICT ("provider", "providerEventId") DO NOTHING
      RETURNING "id", "refundId"
    `.returnsRow({
      id: table.columns.id,
      refundId: table.columns.refundId,
    }).build();

    const rows = await tx.query(plan);
    return rows[0] ?? null;
  }

  private async auditUnresolved(tx: Tx, event: NormalizedRefundProviderEvent) {
    await tx.orm.public.AuditLog.create({
      action: 'REFUND',
      entityType: 'RefundProviderEvent',
      entityId: null,
      details: JSON.stringify({
        event: 'UNRESOLVED_REFUND_PROVIDER_EVENT',
        provider: event.provider,
        providerEventId: event.providerEventId,
        providerRefundId: event.providerRefundId,
        providerRef: event.providerRef,
        paymentProviderRef: event.paymentProviderRef,
        outcome: event.type,
      }),
    });
  }

  private async lockRefund(tx: Tx, refundId: string) {
    const plan = db.raw.sql`
      SELECT *
      FROM "Refund"
      WHERE "id" = ${refundId}
      FOR UPDATE
    `.returnsRow({
      id: db.sql.public.refund.columns.id,
      paymentId: db.sql.public.refund.columns.paymentId,
      cancellationId: db.sql.public.refund.columns.cancellationId,
      amount: db.sql.public.refund.columns.amount,
      currency: db.sql.public.refund.columns.currency,
      status: db.sql.public.refund.columns.status,
      provider: db.sql.public.refund.columns.provider,
      providerRef: db.sql.public.refund.columns.providerRef,
      reconciliationMetadata: db.sql.public.refund.columns.reconciliationMetadata,
    }).build();
    const rows = await tx.query(plan);
    return rows[0] as any;
  }

  private async lockPayment(tx: Tx, paymentId: string) {
    const plan = db.raw.sql`
      SELECT *
      FROM "Payment"
      WHERE "id" = ${paymentId}
      FOR UPDATE
    `.returnsRow({
      id: db.sql.public.payment.columns.id,
      provider: db.sql.public.payment.columns.provider,
      providerRef: db.sql.public.payment.columns.providerRef,
      amount: db.sql.public.payment.columns.amount,
      currency: db.sql.public.payment.columns.currency,
      status: db.sql.public.payment.columns.status,
    }).build();
    const rows = await tx.query(plan);
    return rows[0] as any;
  }
}
