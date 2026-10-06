import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { db, type Tx } from '../prisma/db.js';
import { CancellationRefundAccountingService } from './cancellation-refund-accounting.service.js';

function decimalToScaled(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new ConflictException('Invalid financial amount');
  const [whole, fraction = ''] = normalized.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function compareDecimals(aValue: string, bValue: string) {
  const a = decimalToScaled(aValue);
  const b = decimalToScaled(bValue);
  const scale = Math.max(a.scale, b.scale);
  const aUnits = a.units * 10n ** BigInt(scale - a.scale);
  const bUnits = b.units * 10n ** BigInt(scale - b.scale);
  return aUnits < bUnits ? -1 : aUnits > bUnits ? 1 : 0;
}

export type RefundState = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

const ALLOWED_TRANSITIONS: Record<RefundState, readonly RefundState[]> = {
  PENDING: ['PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'UNKNOWN'],
  SUCCEEDED: [],
  FAILED: [],
  UNKNOWN: [],
};

export interface RefundTransitionResult {
  refundId: string;
  paymentId: string;
  cancellationId: string;
  previousStatus: RefundState;
  status: RefundState;
  amount: string;
  currency: string;
  paymentStatus: string;
  paymentRefundedAt: string | null;
  idempotent: boolean;
}

@Injectable()
export class RefundStateService {
  constructor(
    @Optional()
    private readonly accountingService?: CancellationRefundAccountingService,
  ) {}

  async transition(
    refundId: string,
    nextStatus: RefundState,
    outcome: {
      provider?: string | null;
      providerRef?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      uncertaintyReason?: string | null;
      metadata?: string | null;
      actorUserId?: string | null;
    } = {},
  ): Promise<RefundTransitionResult> {
    return db.transaction(async (tx) =>
      this.transitionInTransaction(refundId, nextStatus, tx, outcome),
    );
  }

  async transitionInTransaction(
    refundId: string,
    nextStatus: RefundState,
    tx: Tx,
    outcome: {
      provider?: string | null;
      providerRef?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      uncertaintyReason?: string | null;
      metadata?: string | null;
      actorUserId?: string | null;
    } = {},
  ): Promise<RefundTransitionResult> {
    const refund = await this.lockRefund(tx, refundId);
    if (!refund) throw new NotFoundException('Refund not found');

    const previousStatus = refund.status as RefundState;
    if (previousStatus === nextStatus) {
      if (outcome.provider || outcome.providerRef || outcome.failureCode || outcome.failureMessage || outcome.uncertaintyReason || outcome.metadata) {
        await tx.orm.public.Refund.where({ id: refund.id, status: previousStatus }).update({
          provider: outcome.provider ?? refund.provider,
          providerRef: outcome.providerRef ?? refund.providerRef,
          failureCode: outcome.failureCode ?? refund.failureCode,
          failureMessage: outcome.failureMessage ?? refund.failureMessage,
          uncertaintyReason: outcome.uncertaintyReason ?? refund.uncertaintyReason,
          reconciliationMetadata: outcome.metadata ?? refund.reconciliationMetadata,
        });
      }
      const payment = await this.lockPayment(tx, refund.paymentId);
      if (!payment) throw new NotFoundException('Payment not found');
      if (nextStatus === 'SUCCEEDED' && this.accountingService) {
        await this.accountingService.recordRefundInTransaction(tx, refund.id);
      }
      return {
        refundId: refund.id,
        paymentId: refund.paymentId,
        cancellationId: refund.cancellationId,
        previousStatus,
        status: nextStatus,
        amount: refund.amount,
        currency: refund.currency,
        paymentStatus: payment.status as string,
        paymentRefundedAt: payment.refundedAt ?? null,
        idempotent: true,
      };
    }

    if (!this.isAllowed(previousStatus, nextStatus)) {
      throw new ConflictException(
        `Refund cannot transition from ${previousStatus} to ${nextStatus}`,
      );
    }

    const payment = await this.lockPayment(tx, refund.paymentId);
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.id !== refund.paymentId) {
      throw new ConflictException('Refund does not belong to the expected payment');
    }

    const cancellation = await tx.orm.public.Cancellation.where({
      id: refund.cancellationId,
    }).first();
    if (!cancellation) throw new NotFoundException('Cancellation not found');
    if (cancellation.paymentId !== payment.id) {
      throw new ConflictException('Refund cancellation does not belong to the refund payment');
    }

    if (nextStatus === 'SUCCEEDED') {
      await this.validateSuccessfulFinalisation(tx, refund, payment, cancellation);
    }

    const now = new Date().toISOString();
    const updated = await tx.orm.public.Refund.where({
      id: refund.id,
      status: previousStatus,
    }).update({
      status: nextStatus,
      initiatedAt: nextStatus === 'PROCESSING' && !refund.initiatedAt ? now : refund.initiatedAt,
      provider: outcome.provider ?? refund.provider,
      providerRef: outcome.providerRef ?? refund.providerRef,
      failureCode: nextStatus === 'FAILED' ? outcome.failureCode ?? refund.failureCode : null,
      failureMessage: nextStatus === 'FAILED' ? outcome.failureMessage ?? refund.failureMessage : null,
      uncertaintyReason: nextStatus === 'UNKNOWN' ? outcome.uncertaintyReason ?? refund.uncertaintyReason : null,
      reconciliationMetadata: outcome.metadata ?? refund.reconciliationMetadata,
      succeededAt: nextStatus === 'SUCCEEDED' ? now : refund.succeededAt,
    });

    if (!updated) {
      const current = await this.lockRefund(tx, refund.id);
      if (!current) throw new NotFoundException('Refund not found');
      if (current.status === nextStatus) {
        const currentPayment = await this.lockPayment(tx, current.paymentId);
        if (!currentPayment) throw new NotFoundException('Payment not found');
        return {
          refundId: current.id,
          paymentId: current.paymentId,
          cancellationId: current.cancellationId,
          previousStatus,
          status: nextStatus,
          amount: current.amount,
          currency: current.currency,
          paymentStatus: currentPayment.status as string,
          paymentRefundedAt: currentPayment.refundedAt ?? null,
          idempotent: true,
        };
      }
      throw new ConflictException('Refund changed before the requested state transition could be committed');
    }

    let paymentStatus = payment.status as string;
    let paymentRefundedAt = payment.refundedAt ?? null;

    if (nextStatus === 'SUCCEEDED') {
      if (this.accountingService) {
        await this.accountingService.recordRefundInTransaction(tx, refund.id);
      }
      const paymentChanged = await tx.orm.public.Payment.where({
        id: payment.id,
        status: 'FUNDED',
      }).update({
        status: 'REFUNDED',
        refundedAt: now,
      });

      if (!paymentChanged) {
        const currentPayment = await this.lockPayment(tx, payment.id);
        if (currentPayment?.status === 'REFUNDED') {
          paymentStatus = 'REFUNDED';
          paymentRefundedAt = currentPayment.refundedAt ?? null;
        } else {
          throw new ConflictException('Payment changed before refund finalisation could be completed');
        }
      } else {
        paymentStatus = 'REFUNDED';
        paymentRefundedAt = now;
      }
    }

    await tx.orm.public.AuditLog.create({
      userId: outcome.actorUserId ?? null,
      action: 'REFUND',
      entityType: 'Refund',
      entityId: refund.id,
      details: JSON.stringify({
        refundId: refund.id,
        paymentId: refund.paymentId,
        cancellationId: refund.cancellationId,
        previousState: previousStatus,
        newState: nextStatus,
        actorSource: outcome.actorUserId ? 'USER' : 'SYSTEM',
        providerOutcome: outcome.provider ? {
          provider: outcome.provider,
          providerRef: outcome.providerRef ?? null,
          classification: nextStatus,
        } : null,
        timestamp: now,
      }),
    });

    if (nextStatus === 'SUCCEEDED') {
      await tx.orm.public.AuditLog.create({
        userId: outcome.actorUserId ?? null,
        action: 'REFUND',
        entityType: 'Payment',
        entityId: payment.id,
        details: JSON.stringify({
          refundId: refund.id,
          paymentId: payment.id,
          cancellationId: refund.cancellationId,
          previousState: 'FUNDED',
          newState: 'REFUNDED',
          actorSource: outcome.actorUserId ? 'USER' : 'SYSTEM',
          timestamp: now,
        }),
      });
    }

    const finalRefund = await this.lockRefund(tx, refund.id);
    if (!finalRefund) throw new NotFoundException('Refund disappeared after transition');

    return {
      refundId: finalRefund.id,
      paymentId: finalRefund.paymentId,
      cancellationId: finalRefund.cancellationId,
      previousStatus,
      status: finalRefund.status as RefundState,
      amount: finalRefund.amount,
      currency: finalRefund.currency,
      paymentStatus,
      paymentRefundedAt,
      idempotent: false,
    };
  }

  private isAllowed(previous: RefundState, next: RefundState) {
    return ALLOWED_TRANSITIONS[previous]?.includes(next) ?? false;
  }

  private async validateSuccessfulFinalisation(tx: Tx, refund: any, payment: any, cancellation: any) {
    if (payment.status === 'RELEASED') {
      throw new ConflictException('Released payments cannot be refund-finalised through ordinary cancellation');
    }
    if (payment.status !== 'FUNDED' && payment.status !== 'REFUNDED') {
      throw new ConflictException('Only FUNDED payments may be refund-finalised');
    }
    if (refund.paymentId !== payment.id || cancellation.paymentId !== payment.id) {
      throw new ConflictException('Refund/payment/cancellation relationships are inconsistent');
    }
    if (refund.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      throw new ConflictException('Refund currency does not match the payment');
    }
    if (compareDecimals(refund.amount, '0') <= 0) {
      throw new ConflictException('Refund amount must be positive');
    }
    if (compareDecimals(refund.amount, payment.amount) > 0) {
      throw new ConflictException('Refund amount cannot exceed the funded payment amount');
    }

    const authoritativeRefund = await tx.orm.public.Refund.where({
      cancellationId: cancellation.id,
    }).first();
    if (!authoritativeRefund || authoritativeRefund.id !== refund.id) {
      throw new ConflictException('Refund is not the authoritative refund for the cancellation');
    }

    const conflicting = await tx.orm.public.Refund.where({
      paymentId: payment.id,
      status: 'SUCCEEDED',
    }).first();
    if (conflicting && conflicting.id !== refund.id) {
      throw new ConflictException('Another successful refund already exists for this payment');
    }
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
      type: db.sql.public.refund.columns.type,
      status: db.sql.public.refund.columns.status,
      provider: db.sql.public.refund.columns.provider,
      providerRef: db.sql.public.refund.columns.providerRef,
      failureCode: db.sql.public.refund.columns.failureCode,
      failureMessage: db.sql.public.refund.columns.failureMessage,
      uncertaintyReason: db.sql.public.refund.columns.uncertaintyReason,
      reconciliationMetadata: db.sql.public.refund.columns.reconciliationMetadata,
      initiatedAt: db.sql.public.refund.columns.initiatedAt,
      succeededAt: db.sql.public.refund.columns.succeededAt,
      reconciledAt: db.sql.public.refund.columns.reconciledAt,
      createdAt: db.sql.public.refund.columns.createdAt,
      updatedAt: db.sql.public.refund.columns.updatedAt,
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
      taskId: db.sql.public.payment.columns.taskId,
      clientId: db.sql.public.payment.columns.clientId,
      workerId: db.sql.public.payment.columns.workerId,
      contractId: db.sql.public.payment.columns.contractId,
      amount: db.sql.public.payment.columns.amount,
      currency: db.sql.public.payment.columns.currency,
      status: db.sql.public.payment.columns.status,
      provider: db.sql.public.payment.columns.provider,
      providerRef: db.sql.public.payment.columns.providerRef,
      fundedAt: db.sql.public.payment.columns.fundedAt,
      releasedAt: db.sql.public.payment.columns.releasedAt,
      refundedAt: db.sql.public.payment.columns.refundedAt,
      createdAt: db.sql.public.payment.columns.createdAt,
      updatedAt: db.sql.public.payment.columns.updatedAt,
    }).build();
    const rows = await tx.query(plan);
    return rows[0] as any;
  }

}
