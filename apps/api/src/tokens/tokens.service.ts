import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';

const DEFAULT_TOKEN_PACKAGE = {
  id: 'starter-50',
  name: '50 Tokens',
  tokenAmount: 50,
  price: '5.00',
  currency: 'USD',
  active: true,
} as const;

@Injectable()
export class TokensService {
  async getWallet(userId: string) {
    const wallet = await db.orm.public.TokenWallet.where({ userId }).first();

    if (wallet) return wallet;

    return db.orm.public.TokenWallet.create({
      userId,
      balance: 0,
    });
  }

  async getTransactions(userId: string) {
    return db.orm.public.TokenTransaction
      .where({ userId })
      .all();
  }

  async getPackages() {
    const packages = await db.orm.public.TokenPackage
      .where({ active: true })
      .all();

    return packages.length > 0 ? packages : [DEFAULT_TOKEN_PACKAGE];
  }

  async spend(
    userId: string,
    data: { amount: number; reference?: string; note?: string },
  ) {
    if (!Number.isInteger(data.amount) || data.amount <= 0) {
      throw new BadRequestException('Token amount must be a positive integer');
    }

    return db.transaction(async (tx) => {
      const wallet = await tx.orm.public.TokenWallet
        .where({ userId })
        .first();

      if (!wallet) {
        throw new NotFoundException('Token wallet not found');
      }

      if (wallet.balance < data.amount) {
        throw new BadRequestException('Insufficient token balance');
      }

      const nextBalance = wallet.balance - data.amount;

      const updated = await tx.orm.public.TokenWallet
        .where({ userId, balance: wallet.balance })
        .update({ balance: nextBalance });

      if (!updated) {
        throw new BadRequestException('Token balance changed; retry the request');
      }

      const transaction = await tx.orm.public.TokenTransaction.create({
        userId,
        type: 'SPEND',
        amount: -data.amount,
        balanceAfter: nextBalance,
        reference: data.reference ?? null,
        note: data.note ?? null,
      });

      return {
        wallet: {
          userId,
          balance: nextBalance,
        },
        transaction,
      };
    });
  }

  /**
   * Settlement hook for a verified external payment.
   *
   * The payment provider/webhook layer must verify the payment before
   * calling this method. This method never treats a client-supplied
   * provider reference as proof of payment.
   */
  async recordPurchase(
    userId: string,
    tokenAmount: number,
    reference: string,
    note?: string,
  ) {
    if (!Number.isInteger(tokenAmount) || tokenAmount <= 0) {
      throw new BadRequestException('Token amount must be a positive integer');
    }

    if (!reference.trim()) {
      throw new BadRequestException('Purchase reference is required');
    }

    return db.transaction(async (tx) => {
      const existing = await tx.orm.public.TokenTransaction
        .where({ reference })
        .first();

      if (existing) {
        if (existing.userId !== userId || existing.type !== 'PURCHASE') {
          throw new BadRequestException('Purchase reference already exists');
        }

        return existing;
      }

      const wallet =
        (await tx.orm.public.TokenWallet.where({ userId }).first()) ??
        (await tx.orm.public.TokenWallet.create({
          userId,
          balance: 0,
        }));

      const nextBalance = wallet.balance + tokenAmount;

      await tx.orm.public.TokenWallet
        .where({ userId, balance: wallet.balance })
        .update({ balance: nextBalance });

      return tx.orm.public.TokenTransaction.create({
        userId,
        type: 'PURCHASE',
        amount: tokenAmount,
        balanceAfter: nextBalance,
        reference,
        note: note ?? null,
      });
    });
  }

  /**
   * Administrative/manual credit hook. It is deliberately not exposed
   * through the public controller.
   */
  async grant(
    userId: string,
    tokenAmount: number,
    reference: string,
    note?: string,
  ) {
    if (!Number.isInteger(tokenAmount) || tokenAmount <= 0) {
      throw new BadRequestException('Token amount must be a positive integer');
    }

    return db.transaction(async (tx) => {
      const wallet =
        (await tx.orm.public.TokenWallet.where({ userId }).first()) ??
        (await tx.orm.public.TokenWallet.create({
          userId,
          balance: 0,
        }));

      const nextBalance = wallet.balance + tokenAmount;

      const updated = await tx.orm.public.TokenWallet
        .where({ userId, balance: wallet.balance })
        .update({ balance: nextBalance });

      if (!updated) {
        throw new BadRequestException('Token balance changed; retry the request');
      }

      return tx.orm.public.TokenTransaction.create({
        userId,
        type: 'GRANT',
        amount: tokenAmount,
        balanceAfter: nextBalance,
        reference,
        note: note ?? null,
      });
    });
  }
}
