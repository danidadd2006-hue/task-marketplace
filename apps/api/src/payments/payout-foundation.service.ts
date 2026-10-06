import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';

function decimalToScaled(value: string): { units: bigint; scale: number } {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException('Financial amount is not a valid decimal');
  }
  const [whole, fraction = ''] = normalized.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function subtractDecimals(gross: string, commission: string): string {
  const a = decimalToScaled(gross);
  const b = decimalToScaled(commission);
  const scale = Math.max(a.scale, b.scale);
  const grossUnits = a.units * 10n ** BigInt(scale - a.scale);
  const commissionUnits = b.units * 10n ** BigInt(scale - b.scale);
  const net = grossUnits - commissionUnits;
  if (net < 0n) throw new BadRequestException('Commission exceeds payment amount');
  const digits = net.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale || undefined) || '0';
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

@Injectable()
export class PayoutFoundationService {
  async createPayoutIntent(
    client: AuthenticatedUser,
    paymentId: string,
    payoutDestinationId: string,
  ) {
    if (!client?.roles.includes('CLIENT')) {
      throw new ForbiddenException('CLIENT role required');
    }

    return db.transaction(async (tx) => {
      const payment = await tx.orm.public.Payment.where({ id: paymentId }).first();
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.clientId !== client.userId) {
        throw new ForbiddenException('You do not own this payment');
      }
      if (payment.status !== 'FUNDED') {
        throw new BadRequestException('Payment must be FUNDED before payout preparation');
      }

      const task = await tx.orm.public.Task.where({ id: payment.taskId }).first();
      if (!task || task.status !== 'COMPLETED' || task.clientId !== client.userId) {
        throw new BadRequestException('Task must be COMPLETED before payout preparation');
      }

      const contract = await tx.orm.public.Contract.where({
        id: payment.contractId,
        taskId: payment.taskId,
        status: 'COMPLETED',
      }).first();
      if (!contract || contract.workerId !== payment.workerId || contract.agreedPrice !== payment.amount) {
        throw new ConflictException('Payment contract is not a completed authoritative match');
      }

      const destination = await tx.orm.public.PayoutDestination.where({
        id: payoutDestinationId,
        userId: contract.workerId,
        status: 'VERIFIED',
      }).first();
      if (!destination) {
        throw new ForbiddenException('Verified payout destination is required for the selected worker');
      }

      const existing = await tx.orm.public.Payout.where({ paymentId }).first();
      if (existing) {
        return existing;
      }

      const commission = await tx.orm.public.LedgerEntry.where({
        paymentId,
        type: 'COMMISSION',
      }).first();
      if (!commission) {
        throw new ConflictException('Authoritative commission record is required before payout preparation');
      }

      const amount = subtractDecimals(payment.amount, commission.amount);
      if (amount === '0') {
        throw new BadRequestException('Worker payout amount must be greater than zero');
      }

      let payout;
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
        const sqlState = (error as { sqlState?: string })?.sqlState;
        if (sqlState === '23505') {
          const concurrent = await tx.orm.public.Payout.where({ paymentId }).first();
          if (concurrent) return concurrent;
          throw new ConflictException('Payout intent was created concurrently');
        }
        throw error;
      }

      await tx.orm.public.AuditLog.create({
        userId: client.userId,
        action: 'PAYMENT',
        entityType: 'Payout',
        entityId: payout.id,
        details: `Payout foundation prepared for completed contract ${contract.id}; no provider payout initiated`,
      });

      return payout;
    });
  }
}
