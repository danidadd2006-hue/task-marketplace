import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db, type Tx } from '../prisma/db.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider.js';

type PaymentRow = {
  id: string;
  taskId: string;
  clientId: string;
  workerId: string | null;
  contractId: string;
  amount: string;
  currency: string;
  status: string;
  provider: string | null;
  providerRef: string | null;
  fundedAt: string | null;
  releasedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaskRow = { id: string; clientId: string; status: string; currency: string };
type ContractRow = { id: string; taskId: string; workerId: string; status: string; agreedPrice: string };
type DestinationRow = { id: string; userId: string; provider: string; method: string; providerAccountRef: string; status: string };
type CommissionRow = { amount: string; currency: string };

type PayoutRecord = {
  id: string;
  paymentId: string;
  contractId: string;
  taskId: string;
  workerId: string;
  payoutDestinationId: string;
  amount: string;
  currency: string;
  provider: string | null;
  providerRef: string | null;
  status: string;
};

function decimalToScaled(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException('Financial amount is not a valid decimal');
  }
  const [whole, fraction = ''] = normalized.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function normalizeDecimal(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException('Financial amount is not a valid decimal');
  }
  const [wholeRaw, fractionRaw = ''] = normalized.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function subtractDecimals(gross: string, commission: string): string {
  const a = decimalToScaled(gross);
  const b = decimalToScaled(commission);
  const scale = Math.max(a.scale, b.scale);
  const grossUnits = a.units * 10n ** BigInt(scale - a.scale);
  const commissionUnits = b.units * 10n ** BigInt(scale - b.scale);
  const net = grossUnits - commissionUnits;
  if (net <= 0n) throw new BadRequestException('Worker payout amount must be greater than zero');
  const digits = net.toString().padStart(scale + 1, '0');
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

@Injectable()
export class PaymentReleaseService {
  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async releasePayment(
    client: AuthenticatedUser,
    paymentId: string,
    payoutDestinationId: string,
  ) {
    if (!client?.roles.includes('CLIENT')) {
      throw new ForbiddenException('CLIENT role required');
    }

    const intent = await db.transaction(async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      if (!payment) throw new NotFoundException('Payment not found');

      if (payment.clientId !== client.userId) {
        throw new ForbiddenException('You do not own this payment');
      }

      const task = await tx.orm.public.Task.where({ id: payment.taskId }).first();
      if (!task) throw new NotFoundException('Task not found');
      if (task.clientId !== client.userId) {
        throw new ForbiddenException('You do not own this task');
      }

      const contract = (await tx.orm.public.Contract.where({
        id: payment.contractId,
        taskId: task.id,
      }).first()) as ContractRow | null;
      if (!contract) throw new NotFoundException('Contract not found');
      if (contract.status !== 'COMPLETED' || task.status !== 'COMPLETED') {
        throw new BadRequestException('Task and contract must both be COMPLETED before release');
      }
      if (payment.status === 'RELEASED') {
        const completed = await tx.orm.public.Payout.where({ paymentId }).first();
        return { kind: 'COMPLETE' as const, payout: completed };
      }
      if (payment.status !== 'FUNDED') {
        throw new BadRequestException('Payment must be FUNDED before release');
      }
      if (
        payment.contractId !== contract.id ||
        payment.clientId !== task.clientId ||
        payment.workerId !== contract.workerId ||
        payment.amount !== contract.agreedPrice ||
        payment.currency !== task.currency
      ) {
        throw new ConflictException('Payment, task, and contract financial relationships do not match');
      }

      const destination = (await tx.orm.public.PayoutDestination.where({
        id: payoutDestinationId,
        userId: contract.workerId,
        status: 'VERIFIED',
      }).first()) as DestinationRow | null;
      if (!destination || destination.userId !== contract.workerId) {
        throw new ForbiddenException('Verified payout destination is required for the selected worker');
      }

      const providerName =
        this.paymentProvider.payoutProviderName?.() ??
        process.env['PAYMENT_PROVIDER']?.toUpperCase() ??
        null;
      if (!providerName) {
        throw new ServiceUnavailableException('Payout provider is not configured');
      }
      if (destination.provider.toUpperCase() !== providerName.toUpperCase()) {
        throw new BadRequestException('Payout destination is not compatible with the configured payout provider');
      }

      let payout = (await tx.orm.public.Payout.where({ paymentId }).first()) as PayoutRecord | null;
      if (!payout) {
        const commission = (await tx.orm.public.LedgerEntry.where({
          paymentId,
          type: 'COMMISSION',
        }).first()) as CommissionRow | null;
        if (!commission) {
          throw new ConflictException('Authoritative commission record is required before release');
        }
        if (commission.currency.toUpperCase() !== payment.currency.toUpperCase()) {
          throw new ConflictException('Commission currency does not match the payment currency');
        }

        const amount = subtractDecimals(payment.amount, commission.amount);
        try {
          payout = await tx.orm.public.Payout.create({
            paymentId,
            contractId: contract.id,
            taskId: task.id,
            workerId: contract.workerId,
            payoutDestinationId: destination.id,
            amount,
            currency: payment.currency,
            status: 'PENDING',
          });
        } catch (error) {
          if ((error as { sqlState?: string })?.sqlState === '23505') {
            payout = await tx.orm.public.Payout.where({ paymentId }).first();
            if (!payout) throw new ConflictException('Payout was created concurrently');
          } else {
            throw error;
          }
        }

        await tx.orm.public.AuditLog.create({
          userId: client.userId,
          action: 'PAYMENT',
          entityType: 'Payout',
          entityId: payout.id,
          details: `Payment release initiated for payment ${payment.id}, task ${task.id}, contract ${contract.id}`,
        });
      }

      if (
        payout.contractId !== contract.id ||
        payout.taskId !== task.id ||
        payout.workerId !== contract.workerId ||
        payout.payoutDestinationId !== destination.id ||
        payout.currency !== payment.currency
      ) {
        throw new ConflictException('Existing payout does not match the authoritative release boundary');
      }

      return {
        kind: 'READY' as const,
        payout: {
          id: payout.id,
          paymentId: payout.paymentId,
          contractId: payout.contractId,
          taskId: payout.taskId,
          workerId: payout.workerId,
          payoutDestinationId: payout.payoutDestinationId,
          amount: payout.amount,
          currency: payout.currency,
          provider: payout.provider,
          providerRef: payout.providerRef,
          status: payout.status,
        } as PayoutRecord,
        destination: {
          provider: destination.provider,
          method: destination.method,
          providerAccountRef: destination.providerAccountRef,
        },
      };
    });

    if (intent.kind === 'COMPLETE') {
      return { status: 'RELEASED', payout: intent.payout };
    }

    if (!intent.payout) {
      throw new ConflictException('Payout intent is missing');
    }

    if (intent.payout.status === 'SUCCEEDED') {
      return this.completeVerifiedSuccess(intent.payout.id, 'IDEMPOTENT_RELEASE');
    }

    if (intent.payout.status === 'UNKNOWN' || intent.payout.status === 'PROCESSING') {
      return this.reconcileExistingPayout(intent.payout);
    }

    if (intent.payout.status !== 'PENDING') {
      if (intent.payout.status === 'FAILED') {
        throw new ConflictException('Payout has already failed and requires a verified provider retry/reconciliation');
      }
      throw new ConflictException(`Payout cannot be released from ${intent.payout.status}`);
    }

    let providerResult;
    try {
      providerResult = await this.paymentProvider.initiatePayout({
        payoutId: intent.payout.id,
        destination: intent.destination,
        amount: intent.payout.amount,
        currency: intent.payout.currency,
      });
    } catch (error) {
      if (error instanceof GatewayTimeoutException) {
        await this.markUnknown(intent.payout.id, 'Provider payout initiation timed out or had an uncertain outcome');
      }
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        throw error;
      }
      await this.markUnknown(intent.payout.id, 'Provider payout initiation returned an uncertain outcome');
      throw new ServiceUnavailableException('Payout initiation outcome is uncertain; payout reconciliation is required');
    }

    const updated = await db.transaction(async (tx) => {
      const changed = await tx.orm.public.Payout.where({
        id: intent.payout.id,
        status: 'PENDING',
      }).update({
        status: 'PROCESSING',
        provider: providerResult.provider,
        providerRef: providerResult.providerRef,
      });
      if (!changed) {
        const current = await tx.orm.public.Payout.where({ id: intent.payout.id }).first();
        if (current?.status === 'SUCCEEDED') return current;
        throw new ConflictException('Payout changed before provider reference could be persisted');
      }
      await tx.orm.public.AuditLog.create({
        userId: client.userId,
        action: 'PAYMENT',
        entityType: 'Payout',
        entityId: intent.payout.id,
        details: `Payout entered PROCESSING with provider ${providerResult.provider}`,
      });
      return tx.orm.public.Payout.where({ id: intent.payout.id }).first();
    });

    return { status: updated?.status ?? 'PROCESSING', payout: updated };
  }

  async reconcilePayout(payoutId: string) {
    const payout = (await db.orm.public.Payout.where({ id: payoutId }).first()) as PayoutRecord | null;
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status === 'SUCCEEDED') {
      return this.completeVerifiedSuccess(payout.id, 'IDEMPOTENT_RECONCILIATION');
    }
    if (!payout.providerRef) {
      throw new ConflictException('Payout has no provider reference to reconcile');
    }

    const result = await this.paymentProvider.reconcilePayout({
      payoutId: payout.id,
      providerRef: payout.providerRef,
      amount: payout.amount,
      currency: payout.currency,
    });

    if (result.status === 'FOUND') {
      return this.completeVerifiedSuccess(payout.id, 'VERIFIED_RECONCILIATION');
    }

    await this.markUnknown(payout.id, 'Provider reconciliation did not confirm payout success');
    throw new ServiceUnavailableException('Payout remains unresolved after reconciliation');
  }

  async applyProviderEvent(event: {
    provider: string;
    providerEventId: string;
    type: 'PAYOUT_PROCESSING' | 'PAYOUT_SUCCEEDED' | 'PAYOUT_FAILED' | 'PAYOUT_UNKNOWN' | 'PAYOUT_CANCELLED';
    payoutId: string;
    providerRef: string | null;
    amount: string;
    currency: string;
    metadata: string | null;
  }, tx: Tx) {
    const payout = (await tx.orm.public.Payout.where({ id: event.payoutId }).first()) as PayoutRecord | null;
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.provider && payout.provider !== event.provider) {
      throw new BadRequestException('Payout provider does not match the event');
    }
    if (payout.amount !== event.amount || payout.currency.toUpperCase() !== event.currency.trim().toUpperCase()) {
      throw new ConflictException('Payout event amount or currency does not match the payout');
    }
    if (payout.providerRef && event.providerRef && payout.providerRef !== event.providerRef) {
      throw new BadRequestException('Payout provider reference does not match the event');
    }

    if (event.type === 'PAYOUT_SUCCEEDED') {
      return this.completeVerifiedSuccessInTransaction(payout.id, tx, 'VERIFIED_PROVIDER_EVENT', event.provider, event.providerRef);
    }

    const nextStatus =
      event.type === 'PAYOUT_PROCESSING' ? 'PROCESSING' :
      event.type === 'PAYOUT_UNKNOWN' ? 'UNKNOWN' : 'FAILED';

    const allowed =
      event.type === 'PAYOUT_PROCESSING'
        ? ['PENDING', 'UNKNOWN']
        : event.type === 'PAYOUT_UNKNOWN'
          ? ['PENDING', 'PROCESSING']
          : ['PENDING', 'PROCESSING', 'UNKNOWN'];

    if (!allowed.includes(payout.status)) {
      if (payout.status === nextStatus) return payout;
      if (payout.status === 'SUCCEEDED') return payout;
      throw new ConflictException(`Payout cannot transition from ${payout.status} using ${event.type}`);
    }

    const updated = await tx.orm.public.Payout.where({
      id: payout.id,
      status: payout.status,
    }).update({
      status: nextStatus,
      provider: event.provider,
      providerRef: event.providerRef ?? payout.providerRef,
      uncertaintyReason: event.type === 'PAYOUT_UNKNOWN' ? event.metadata : null,
      failureMessage: event.type === 'PAYOUT_FAILED' || event.type === 'PAYOUT_CANCELLED' ? event.metadata : null,
    });
    if (!updated) throw new ConflictException('Payout changed before provider event processing');

    await tx.orm.public.AuditLog.create({
      userId: null,
      action: 'PAYMENT',
      entityType: 'Payout',
      entityId: payout.id,
      details: `Verified provider event ${event.type} changed payout state to ${nextStatus}`,
    });
    return tx.orm.public.Payout.where({ id: payout.id }).first();
  }

  private async completeVerifiedSuccess(payoutId: string, reason: string) {
    return db.transaction(async (tx) => this.completeVerifiedSuccessInTransaction(payoutId, tx, reason));
  }

  private async completeVerifiedSuccessInTransaction(
    payoutId: string,
    tx: Tx,
    reason = 'VERIFIED_PROVIDER_SUCCESS',
    provider?: string,
    providerRef?: string | null,
  ) {
    const payout = await tx.orm.public.Payout.where({ id: payoutId }).first();
    if (!payout) throw new NotFoundException('Payout not found');

    const payment = await this.lockPayment(tx, payout.paymentId);
    if (!payment) throw new NotFoundException('Payment not found');
    const task = await tx.orm.public.Task.where({ id: payment.taskId }).first();
    const contract = (await tx.orm.public.Contract.where({ id: payment.contractId }).first()) as ContractRow | null;
    if (!task || !contract || task.status !== 'COMPLETED' || contract.status !== 'COMPLETED') {
      throw new ConflictException('Completed task and contract are required for payout completion');
    }
    if (
      payment.contractId !== contract.id ||
      payment.taskId !== task.id ||
      payment.clientId !== task.clientId ||
      payment.workerId !== contract.workerId ||
      payment.amount !== contract.agreedPrice ||
      payment.currency !== task.currency ||
      payout.contractId !== contract.id ||
      payout.taskId !== task.id ||
      payout.workerId !== contract.workerId ||
      payout.currency !== payment.currency
    ) {
      throw new ConflictException('Authoritative payout relationships no longer match');
    }

    if (!['PENDING', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED'].includes(payout.status)) {
      throw new ConflictException(`Payout cannot be marked successful from ${payout.status}`);
    }

    const commission = (await tx.orm.public.LedgerEntry.where({
      paymentId: payment.id,
      type: 'COMMISSION',
    }).first()) as CommissionRow | null;
    if (!commission) throw new ConflictException('Authoritative commission record is required');
    const expectedAmount = subtractDecimals(payment.amount, commission.amount);
    if (normalizeDecimal(payout.amount) !== normalizeDecimal(expectedAmount)) {
      throw new ConflictException('Payout amount does not match the authoritative net payout');
    }

    const existingRelease = await tx.orm.public.LedgerEntry.where({
      paymentId: payment.id,
      type: 'RELEASE',
    }).first();

    if (payment.status === 'RELEASED' || payout.status === 'SUCCEEDED') {
      if (!existingRelease) {
        await tx.orm.public.LedgerEntry.create({
          paymentId: payment.id,
          taskId: task.id,
          userId: contract.workerId,
          type: 'RELEASE',
          amount: payout.amount,
          currency: payment.currency,
          description: 'Worker payout released after verified provider success',
          reference: payout.id,
        });
      }
      await tx.orm.public.Payout.where({ id: payout.id }).update({
        status: 'SUCCEEDED',
        provider: provider ?? payout.provider,
        providerRef: providerRef ?? payout.providerRef,
      });
      if (payment.status !== 'RELEASED') {
        await tx.orm.public.Payment.where({ id: payment.id, status: 'FUNDED' }).update({
          status: 'RELEASED',
          releasedAt: new Date().toISOString(),
        });
      }
      return { status: 'RELEASED', payoutId: payout.id, paymentId: payment.id, idempotent: true };
    }

    await tx.orm.public.Payout.where({
      id: payout.id,
      status: payout.status,
    }).update({
      status: 'SUCCEEDED',
      provider: provider ?? payout.provider,
      providerRef: providerRef ?? payout.providerRef,
      uncertaintyReason: null,
      failureMessage: null,
    });

    if (!existingRelease) {
      await tx.orm.public.LedgerEntry.create({
        paymentId: payment.id,
        taskId: task.id,
        userId: contract.workerId,
        type: 'RELEASE',
        amount: payout.amount,
        currency: payment.currency,
        description: 'Worker payout released after verified provider success',
        reference: payout.id,
      });
    }

    const released = await tx.orm.public.Payment.where({
      id: payment.id,
      status: 'FUNDED',
    }).update({
      status: 'RELEASED',
      releasedAt: new Date().toISOString(),
    });
    if (!released) throw new ConflictException('Payment changed before release could be completed');

    await tx.orm.public.AuditLog.create({
      userId: payment.clientId,
      action: 'PAYMENT',
      entityType: 'Payout',
      entityId: payout.id,
      details: `Verified payout success completed payment release (${reason})`,
    });

    return { status: 'RELEASED', payoutId: payout.id, paymentId: payment.id, idempotent: false };
  }

  private async reconcileExistingPayout(payout: PayoutRecord) {
    if (!payout.providerRef) {
      throw new ConflictException('Payout has no provider reference to reconcile');
    }

    const result = await this.paymentProvider.reconcilePayout({
      payoutId: payout.id,
      providerRef: payout.providerRef,
      amount: payout.amount,
      currency: payout.currency,
    });

    if (result.status === 'FOUND') {
      return this.completeVerifiedSuccess(payout.id, 'VERIFIED_RECONCILIATION');
    }

    await this.markUnknown(payout.id, 'Provider reconciliation did not confirm payout success');
    throw new ServiceUnavailableException('Payout remains unresolved after reconciliation');
  }

  private async markUnknown(payoutId: string, reason: string) {
    await db.transaction(async (tx) => {
      await tx.orm.public.Payout.where({
        id: payoutId,
        status: 'PENDING',
      }).update({ status: 'UNKNOWN', uncertaintyReason: reason });
      await tx.orm.public.Payout.where({
        id: payoutId,
        status: 'PROCESSING',
      }).update({ status: 'UNKNOWN', uncertaintyReason: reason });
      await tx.orm.public.AuditLog.create({
        userId: null,
        action: 'PAYMENT',
        entityType: 'Payout',
        entityId: payoutId,
        details: `Payout entered UNKNOWN: ${reason}`,
      });
    });
  }

  private async markFailed(payoutId: string, reason: string) {
    await db.transaction(async (tx) => {
      const updated = await tx.orm.public.Payout.where({
        id: payoutId,
        status: 'PENDING',
      }).update({ status: 'FAILED', failureMessage: reason });
      if (updated) {
        await tx.orm.public.AuditLog.create({
          userId: null,
          action: 'PAYMENT',
          entityType: 'Payout',
          entityId: payoutId,
          details: `Verified payout failure: ${reason}`,
        });
      }
    });
  }

  private async lockPayment(tx: Tx, paymentId: string) {
    const paymentTable = tx.sql.public.payment;
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
      createdAt: db.sql.public.payment.columns.createdAt,
      updatedAt: db.sql.public.payment.columns.updatedAt,
    }).build();
    const rows = await tx.query(plan);
    return rows[0] as PaymentRow | undefined;
  }
}
