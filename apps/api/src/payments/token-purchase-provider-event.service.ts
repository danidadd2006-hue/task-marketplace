import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import type { NormalizedPaymentProviderEvent } from './payment-provider.js';
import { getStartingWorkerTokenGrant } from '../tokens/token.constants.js';

type SqlError = { sqlState?: string; cause?: SqlError };

function isUniqueViolation(error: unknown): boolean {
  let current = error as SqlError | undefined;
  while (current) {
    if (current.sqlState === '23505') return true;
    current = current.cause;
  }
  return false;
}

function normalizeDecimal(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException('Provider amount is not a valid decimal');
  }

  const [wholeRaw, fractionRaw = ''] = normalized.split('.');
  let whole = wholeRaw;
  let fraction = fractionRaw;
  while (whole.length > 1 && whole.startsWith('0')) whole = whole.slice(1);
  while (fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return `${whole}.${fraction || '0'}`;
}

@Injectable()
export class TokenPurchaseProviderEventService {
  async processNormalizedEvent(event: NormalizedPaymentProviderEvent) {
    if (!event.tokenPurchaseId) {
      throw new BadRequestException(
        'Token purchase provider event has no purchase target',
      );
    }

    return db.transaction(async (tx: any) => {
      const existingEvent =
        await tx.orm.public.TokenPurchaseProviderEvent.where({
          provider: event.provider,
          providerEventId: event.providerEventId,
        }).first();

      if (existingEvent) {
        return {
          status: 'DUPLICATE' as const,
          eventId: existingEvent.id,
          purchaseId: existingEvent.tokenPurchaseId,
          tokenStatus: 'UNCHANGED' as const,
        };
      }

      const purchaseTable = tx.sql.public.tokenPurchase;
      const purchasePlan = tx.raw.sql`
        SELECT "id", "userId", "status", "tokenAmount", "amount",
               "currency", "provider", "providerRef"
        FROM "TokenPurchase"
        WHERE "id" = ${event.tokenPurchaseId}
        FOR UPDATE
      `.returnsRow({
        id: purchaseTable.columns.id,
        userId: purchaseTable.columns.userId,
        status: purchaseTable.columns.status,
        tokenAmount: purchaseTable.columns.tokenAmount,
        amount: purchaseTable.columns.amount,
        currency: purchaseTable.columns.currency,
        provider: purchaseTable.columns.provider,
        providerRef: purchaseTable.columns.providerRef,
      }).build();

      const purchases = await tx.query(purchasePlan);
      const purchase = purchases[0];

      if (!purchase) throw new NotFoundException('Token purchase not found');

      if (purchase.provider && purchase.provider !== event.provider) {
        throw new BadRequestException(
          'Token purchase provider does not match the event',
        );
      }

      if (
        normalizeDecimal(String(purchase.amount)) !==
          normalizeDecimal(event.amount) ||
        purchase.currency.trim().toUpperCase() !==
          event.currency.trim().toUpperCase()
      ) {
        throw new ConflictException(
          'Provider transaction amount or currency does not match the token purchase',
        );
      }

      if (
        purchase.providerRef &&
        event.providerRef &&
        purchase.providerRef !== event.providerRef
      ) {
        throw new BadRequestException(
          'Token purchase provider reference does not match the event',
        );
      }

      let recordedEvent;
      try {
        recordedEvent =
          await tx.orm.public.TokenPurchaseProviderEvent.create({
            provider: event.provider,
            providerEventId: event.providerEventId,
            type:
              event.type === 'FUNDING_SUCCEEDED'
                ? 'PURCHASE_SUCCEEDED'
                : event.type === 'FUNDING_FAILED'
                  ? 'PURCHASE_FAILED'
                  : 'PURCHASE_CANCELLED',
            tokenPurchaseId: purchase.id,
            providerRef: event.providerRef,
            metadata: event.metadata,
          });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        const duplicate =
          await tx.orm.public.TokenPurchaseProviderEvent.where({
            provider: event.provider,
            providerEventId: event.providerEventId,
          }).first();

        if (!duplicate) {
          throw new ConflictException(
            'Token purchase provider event conflict could not be resolved safely',
          );
        }

        return {
          status: 'DUPLICATE' as const,
          eventId: duplicate.id,
          purchaseId: duplicate.tokenPurchaseId,
          tokenStatus: 'UNCHANGED' as const,
        };
      }

      if (purchase.status === 'PAID') {
        return {
          status: 'ALREADY_APPLIED' as const,
          eventId: recordedEvent.id,
          purchaseId: purchase.id,
          tokenStatus: 'PAID' as const,
        };
      }

      if (purchase.status !== 'PENDING') {
        throw new ConflictException(
          `Token purchase cannot transition from ${purchase.status} using ${event.type}`,
        );
      }

      if (event.type === 'FUNDING_SUCCEEDED') {
        const userTable = tx.sql.public.user;
        const userLockPlan = tx.raw.sql`
          SELECT "id" FROM "User" WHERE "id" = ${purchase.userId} FOR UPDATE
        `.returnsRow({ id: userTable.columns.id }).build();

        const users = await tx.query(userLockPlan);
        if (!users[0]) {
          throw new NotFoundException('Token purchase owner not found');
        }

        let wallet = await tx.orm.public.TokenWallet
          .where({ userId: purchase.userId })
          .first();

        if (!wallet) {
          const startingTokens = getStartingWorkerTokenGrant();
          wallet = await tx.orm.public.TokenWallet.create({
            userId: purchase.userId,
            balance: startingTokens,
          });

          await tx.orm.public.TokenTransaction.create({
            userId: purchase.userId,
            type: 'GRANT',
            amount: startingTokens,
            balanceAfter: startingTokens,
            reference: `worker-starting-grant:${purchase.userId}`,
            note: 'Initial token allocation for WORKER account',
          });
        }

        const nextBalance = wallet.balance + purchase.tokenAmount;
        const updatedWallet =
          await tx.orm.public.TokenWallet.where({
            userId: purchase.userId,
            balance: wallet.balance,
          }).update({ balance: nextBalance });

        if (!updatedWallet) {
          throw new ConflictException(
            'Token wallet changed before purchase settlement',
          );
        }

        await tx.orm.public.TokenTransaction.create({
          userId: purchase.userId,
          type: 'PURCHASE',
          amount: purchase.tokenAmount,
          balanceAfter: nextBalance,
          reference: `token-purchase:${purchase.id}`,
          note: `Purchased ${purchase.tokenAmount} tokens for ${purchase.amount} USD`,
        });

        const updatedPurchase =
          await tx.orm.public.TokenPurchase.where({
            id: purchase.id,
            status: 'PENDING',
          }).update({
            status: 'PAID',
            provider: event.provider,
            providerRef: event.providerRef ?? purchase.providerRef,
            paidAt: new Date().toISOString(),
          });

        if (!updatedPurchase) {
          throw new ConflictException(
            'Token purchase changed before settlement',
          );
        }

        await tx.orm.public.AuditLog.create({
          userId: purchase.userId,
          action: 'PAYMENT',
          entityType: 'TokenPurchase',
          entityId: purchase.id,
          details: `Token purchase settled: ${purchase.tokenAmount} tokens`,
        });

        return {
          status: 'PROCESSED' as const,
          eventId: recordedEvent.id,
          purchaseId: purchase.id,
          tokenStatus: 'PAID' as const,
        };
      }

      const nextStatus =
        event.type === 'FUNDING_FAILED' ? 'FAILED' : 'CANCELLED';

      const updatedPurchase =
        await tx.orm.public.TokenPurchase.where({
          id: purchase.id,
          status: 'PENDING',
        }).update({
          status: nextStatus,
          provider: event.provider,
          providerRef: event.providerRef ?? purchase.providerRef,
        });

      if (!updatedPurchase) {
        throw new ConflictException(
          'Token purchase changed before provider event processing',
        );
      }

      return {
        status: 'PROCESSED' as const,
        eventId: recordedEvent.id,
        purchaseId: purchase.id,
        tokenStatus: nextStatus,
      };
    });
  }
}
