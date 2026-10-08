import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { db, type Tx } from '../prisma/db.js';

@Injectable()
export class CancellationRefundAccountingService {
  async recordCancellationFeeInTransaction(tx: Tx, cancellationId: string) {
    const cancellation = await this.lockCancellation(tx, cancellationId);
    if (!cancellation) throw new NotFoundException('Cancellation not found');

    if (cancellation.financialClassification === 'NO_FINANCIAL_ACTION') {
      return { status: 'NO_ACTION' as const, ledgerEntryId: null };
    }

    if (cancellation.paymentId === null || cancellation.cancellationFee === '0') {
      return { status: 'NO_FEE' as const, ledgerEntryId: null };
    }

    const payment = await this.lockPayment(tx, cancellation.paymentId);
    if (!payment) throw new NotFoundException('Cancellation payment not found');

    if (payment.status === 'RELEASED') {
      throw new ConflictException('Released payments cannot receive ordinary cancellation accounting');
    }

    if (payment.id !== cancellation.paymentId || payment.currency.toUpperCase() !== cancellation.currency.toUpperCase()) {
      throw new ConflictException('Cancellation/payment accounting relationships are inconsistent');
    }

    const commission = await tx.orm.public.LedgerEntry.where({
      paymentId: payment.id,
      type: 'COMMISSION',
    }).first();

    if (commission) {
      const commissionReversalReference = `cancellation:${cancellation.id}:commission-reversal`;
      const existingCommissionReversal = await tx.orm.public.LedgerEntry.where({
        paymentId: payment.id,
        type: 'ADJUSTMENT',
        reference: commissionReversalReference,
      }).first();

      if (!existingCommissionReversal) {
        const commissionReversal = await tx.orm.public.LedgerEntry.create({
          paymentId: payment.id,
          taskId: cancellation.taskId,
          userId: null,
          type: 'ADJUSTMENT',
          amount: `-${commission.amount}`,
          currency: cancellation.currency,
          description: 'Reversal of the normal completion commission because the task was cancelled',
          reference: commissionReversalReference,
        });

        await tx.orm.public.AuditLog.create({
          action: 'PAYMENT',
          entityType: 'LedgerEntry',
          entityId: commissionReversal.id,
          details: JSON.stringify({
            event: 'COMMISSION_REVERSED_ON_CANCELLATION',
            ledgerEntryId: commissionReversal.id,
            originalCommissionLedgerEntryId: commission.id,
            paymentId: payment.id,
            cancellationId: cancellation.id,
            amount: commission.amount,
            currency: cancellation.currency,
            idempotent: false,
          }),
        });
      }
    }

    if (cancellation.cancellationFee === '0') {
      return { status: 'NO_FEE' as const, ledgerEntryId: null };
    }

    const reference = `cancellation:${cancellation.id}:fee`;
    const existing = await tx.orm.public.LedgerEntry.where({
      paymentId: payment.id,
      type: 'CANCELLATION_FEE',
      reference,
    }).first();

    if (existing) {
      return { status: 'ALREADY_ACCOUNTED' as const, ledgerEntryId: existing.id };
    }

    const entry = await tx.orm.public.LedgerEntry.create({
      paymentId: payment.id,
      taskId: cancellation.taskId,
      userId: null,
      type: 'CANCELLATION_FEE',
      amount: cancellation.cancellationFee,
      currency: cancellation.currency,
      description: 'Platform cancellation fee from authoritative cancellation allocation',
      reference,
    });

    await tx.orm.public.AuditLog.create({
      action: 'PAYMENT',
      entityType: 'LedgerEntry',
      entityId: entry.id,
      details: JSON.stringify({
        event: 'CANCELLATION_FEE_ACCOUNTED',
        ledgerEntryId: entry.id,
        paymentId: payment.id,
        cancellationId: cancellation.id,
        amount: cancellation.cancellationFee,
        currency: cancellation.currency,
        idempotent: false,
      }),
    });

    return { status: 'ACCOUNTED' as const, ledgerEntryId: entry.id };
  }

  async recordRefundInTransaction(tx: Tx, refundId: string) {
    const refund = await this.lockRefund(tx, refundId);
    if (!refund) throw new NotFoundException('Refund not found');

    const payment = await this.lockPayment(tx, refund.paymentId);
    if (!payment) throw new NotFoundException('Refund payment not found');

    const cancellation = await tx.orm.public.Cancellation.where({
      id: refund.cancellationId,
    }).first();
    if (!cancellation) throw new NotFoundException('Cancellation not found');

    if (refund.status !== 'SUCCEEDED') {
      return { status: 'NOT_ELIGIBLE' as const, ledgerEntryId: null };
    }

    if (cancellation.paymentId !== payment.id || refund.paymentId !== payment.id) {
      throw new ConflictException('Refund/cancellation/payment accounting relationships are inconsistent');
    }

    if (payment.status === 'RELEASED') {
      throw new ConflictException('Released payments cannot receive ordinary refund accounting');
    }

    if (refund.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      throw new ConflictException('Refund/payment currencies do not match');
    }

    if (refund.amount !== cancellation.clientRefund) {
      throw new ConflictException('Refund amount does not match the authoritative cancellation client refund');
    }

    const reference = `refund:${refund.id}`;
    const existing = await tx.orm.public.LedgerEntry.where({
      paymentId: payment.id,
      type: 'REFUND',
      reference,
    }).first();

    if (existing) {
      return { status: 'ALREADY_ACCOUNTED' as const, ledgerEntryId: existing.id };
    }

    const entry = await tx.orm.public.LedgerEntry.create({
      paymentId: payment.id,
      taskId: cancellation.taskId,
      userId: payment.clientId,
      type: 'REFUND',
      amount: refund.amount,
      currency: refund.currency,
      description: 'Confirmed client refund from authoritative refund state',
      reference,
    });

    await tx.orm.public.AuditLog.create({
      action: 'REFUND',
      entityType: 'LedgerEntry',
      entityId: entry.id,
      details: JSON.stringify({
        event: 'REFUND_ACCOUNTED',
        ledgerEntryId: entry.id,
        paymentId: payment.id,
        cancellationId: cancellation.id,
        refundId: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        idempotent: false,
      }),
    });

    return { status: 'ACCOUNTED' as const, ledgerEntryId: entry.id };
  }

  private async lockCancellation(tx: Tx, cancellationId: string) {
    const table = db.sql.public.cancellation;
    const plan = db.raw.sql`
      SELECT *
      FROM "Cancellation"
      WHERE "id" = ${cancellationId}
      FOR UPDATE
    `.returnsRow({
      id: table.columns.id,
      taskId: table.columns.taskId,
      paymentId: table.columns.paymentId,
      cancellationFee: table.columns.cancellationFee,
      clientRefund: table.columns.clientRefund,
      currency: table.columns.currency,
      financialClassification: table.columns.financialClassification,
    }).build();
    const rows = await tx.query(plan);
    return rows[0] as any;
  }

  private async lockRefund(tx: Tx, refundId: string) {
    const table = db.sql.public.refund;
    const plan = db.raw.sql`
      SELECT *
      FROM "Refund"
      WHERE "id" = ${refundId}
      FOR UPDATE
    `.returnsRow({
      id: table.columns.id,
      paymentId: table.columns.paymentId,
      cancellationId: table.columns.cancellationId,
      amount: table.columns.amount,
      currency: table.columns.currency,
      status: table.columns.status,
    }).build();
    const rows = await tx.query(plan);
    return rows[0] as any;
  }

  private async lockPayment(tx: Tx, paymentId: string) {
    const table = db.sql.public.payment;
    const plan = db.raw.sql`
      SELECT *
      FROM "Payment"
      WHERE "id" = ${paymentId}
      FOR UPDATE
    `.returnsRow({
      id: table.columns.id,
      taskId: table.columns.taskId,
      clientId: table.columns.clientId,
      amount: table.columns.amount,
      currency: table.columns.currency,
      status: table.columns.status,
    }).build();
    const rows = await tx.query(plan);
    return rows[0] as any;
  }
}
