import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider.js';
import { db } from '../prisma/db.js';
import {
  DEFAULT_TOKEN_PACKAGE,
  getApplicationTokenCost,
  getStartingWorkerTokenGrant,
} from './token.constants.js';

@Injectable()
export class TokensService {
  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  private assertWorker(worker: AuthenticatedUser) {
    if (!worker?.roles.includes('WORKER')) {
      throw new ForbiddenException('WORKER role required');
    }
  }

  async getWallet(worker: AuthenticatedUser) {
    this.assertWorker(worker);
    return db.transaction((tx) => this.ensureWorkerWallet(tx, worker.userId));
  }

  async getTransactions(worker: AuthenticatedUser) {
    this.assertWorker(worker);
    return db.transaction(async (tx) => {
      await this.ensureWorkerWallet(tx, worker.userId);
      return tx.orm.public.TokenTransaction.where({
        userId: worker.userId,
      }).all();
    });
  }

  async getPackages() {
    const packages = await db.orm.public.TokenPackage.where({ active: true }).all();
    return packages.length > 0
      ? packages
      : [{
          id: DEFAULT_TOKEN_PACKAGE.id,
          name: DEFAULT_TOKEN_PACKAGE.name,
          tokenAmount: DEFAULT_TOKEN_PACKAGE.tokenAmount,
          price: DEFAULT_TOKEN_PACKAGE.price,
          currency: DEFAULT_TOKEN_PACKAGE.currency,
          active: true,
        }];
  }

  async createPurchase(worker: AuthenticatedUser, packageId: string) {
    this.assertWorker(worker);

    const packageRecord = await db.orm.public.TokenPackage
      .where({ id: packageId, active: true })
      .first();

    const tokenPackage = packageRecord ??
      (packageId === DEFAULT_TOKEN_PACKAGE.id ? DEFAULT_TOKEN_PACKAGE : null);

    if (!tokenPackage) throw new NotFoundException('Token package not found');

    if (tokenPackage.currency.toUpperCase() !== 'USD') {
      throw new BadRequestException('Token purchases currently use USD');
    }

    if (!Number.isInteger(tokenPackage.tokenAmount) || tokenPackage.tokenAmount <= 0) {
      throw new BadRequestException('Token package has an invalid token amount');
    }

    const amount = String(tokenPackage.price);
    if (!/^\d+(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      throw new BadRequestException('Token package has an invalid price');
    }

    const purchaseId = randomUUID();

    await db.orm.public.TokenPurchase.create({
      id: purchaseId,
      userId: worker.userId,
      tokenPackageId: tokenPackage.id,
      tokenAmount: tokenPackage.tokenAmount,
      amount,
      currency: 'USD',
      status: 'PENDING',
      provider: null,
      providerRef: null,
      paidAt: null,
    });

    return this.initiatePurchase(worker, purchaseId);
  }

  async initiatePurchase(worker: AuthenticatedUser, purchaseId: string) {
    this.assertWorker(worker);

    const purchase = await db.orm.public.TokenPurchase
      .where({ id: purchaseId, userId: worker.userId })
      .first();

    if (!purchase) throw new NotFoundException('Token purchase not found');

    if (purchase.status !== 'PENDING') {
      throw new BadRequestException(
        `Token purchase cannot be initiated from ${purchase.status}`,
      );
    }

    let providerResult: Awaited<
      ReturnType<PaymentProvider['initiateTokenPurchase']>
    >;

    if (purchase.providerRef) {
      const reconciliation = await this.paymentProvider.reconcileTokenPurchase({
        purchaseId: purchase.id,
        providerRef: purchase.providerRef,
        amount: String(purchase.amount),
        currency: purchase.currency,
      });

      providerResult = reconciliation.status === 'FOUND'
        ? {
            status: 'PENDING',
            provider: reconciliation.provider,
            providerRef: reconciliation.providerRef,
            checkoutUrl: reconciliation.checkoutUrl,
          }
        : await this.paymentProvider.initiateTokenPurchase({
            purchaseId: purchase.id,
            amount: String(purchase.amount),
            currency: purchase.currency,
            customerEmail: worker.email,
            tokenAmount: purchase.tokenAmount,
          });
    } else {
      providerResult = await this.paymentProvider.initiateTokenPurchase({
        purchaseId: purchase.id,
        amount: String(purchase.amount),
        currency: purchase.currency,
        customerEmail: worker.email,
        tokenAmount: purchase.tokenAmount,
      });
    }

    const updated = await db.orm.public.TokenPurchase
      .where({ id: purchase.id, userId: worker.userId, status: 'PENDING' })
      .update({
        provider: providerResult.provider,
        providerRef: providerResult.providerRef,
      });

    if (!updated) {
      throw new ServiceUnavailableException(
        'Token purchase changed before provider details could be recorded',
      );
    }

    return {
      purchase: {
        id: purchase.id,
        tokenAmount: purchase.tokenAmount,
        amount: purchase.amount,
        currency: purchase.currency,
        status: purchase.status,
        provider: providerResult.provider,
        providerRef: providerResult.providerRef,
        checkoutUrl: providerResult.checkoutUrl,
      },
      providerConfirmation: 'AWAITING' as const,
      retryable: true,
    };
  }

  async getPurchase(worker: AuthenticatedUser, purchaseId: string) {
    this.assertWorker(worker);
    const purchase = await db.orm.public.TokenPurchase.where({
      id: purchaseId,
      userId: worker.userId,
    }).first();

    if (!purchase) throw new NotFoundException('Token purchase not found');
    return purchase;
  }

  async spendForApplicationInTransaction(
    tx: any,
    workerId: string,
    applicationId: string,
  ) {
    const wallet = await this.ensureWorkerWallet(tx, workerId);
    const cost = getApplicationTokenCost();

    if (wallet.balance < cost) {
      throw new BadRequestException('Insufficient tokens to apply for this task');
    }

    const nextBalance = wallet.balance - cost;
    const updated = await tx.orm.public.TokenWallet
      .where({ userId: workerId, balance: wallet.balance })
      .update({ balance: nextBalance });

    if (!updated) {
      throw new ConflictException('Token balance changed; retry the application');
    }

    const transaction = await tx.orm.public.TokenTransaction.create({
      userId: workerId,
      type: 'SPEND',
      amount: -cost,
      balanceAfter: nextBalance,
      reference: `application:${applicationId}`,
      note: `Token cost for job application (${cost} tokens)`,
    });

    await tx.orm.public.AuditLog.create({
      userId: workerId,
      action: 'PAYMENT',
      entityType: 'TokenTransaction',
      entityId: transaction.id,
      details: `Spent ${cost} tokens to submit application ${applicationId}`,
    });

    return transaction;
  }

  private async ensureWorkerWallet(tx: any, userId: string) {
    const userTable = tx.sql.public.user;
    const lockPlan = tx.raw.sql`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `.returnsRow({ id: userTable.columns.id }).build();

    const users = await tx.query(lockPlan);
    if (!users[0]) throw new NotFoundException('Worker account not found');

    let wallet = await tx.orm.public.TokenWallet.where({ userId }).first();
    if (wallet) return wallet;

    const startingTokens = getStartingWorkerTokenGrant();
    wallet = await tx.orm.public.TokenWallet.create({
      userId,
      balance: startingTokens,
    });

    const grant = await tx.orm.public.TokenTransaction.create({
      userId,
      type: 'GRANT',
      amount: startingTokens,
      balanceAfter: startingTokens,
      reference: `worker-starting-grant:${userId}`,
      note: 'Initial token allocation for WORKER account',
    });

    await tx.orm.public.AuditLog.create({
      userId,
      action: 'CREATE',
      entityType: 'TokenTransaction',
      entityId: grant.id,
      details: `Initial worker token allocation: ${startingTokens} tokens`,
    });

    return wallet;
  }
}
