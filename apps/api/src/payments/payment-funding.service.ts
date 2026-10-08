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
import { db } from '../prisma/db.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider.js';

function decimalTenPercent(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException('Contract amount is not a valid decimal');
  }

  const [whole, fraction = ''] = normalized.split('.');
  const scale = fraction.length;
  const digits = BigInt(whole + fraction);
  const commissionScale = scale + 1;
  const raw = digits.toString().padStart(commissionScale + 1, '0');
  const wholePart = raw.slice(0, -commissionScale);
  const fractionPart = raw.slice(-commissionScale).replace(/0+$/, '');

  return fractionPart ? wholePart + '.' + fractionPart : wholePart;
}

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
export class PaymentFundingService {
  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async initiateFunding(client: AuthenticatedUser, taskId: string) {
    if (!client?.roles.includes('CLIENT')) {
      throw new ForbiddenException('CLIENT role required');
    }

    // The database transaction creates the local payment intent first. No
    // external provider call is made until this transaction has committed.
    const intent = await db.transaction(async (tx) => {
      const taskTable = tx.sql.public.task;
      const taskPlan = db.raw.sql`
        SELECT "id", "clientId", "status", "currency"
        FROM "Task"
        WHERE "id" = ${taskId}
        FOR UPDATE
      `.returnsRow({
        id: taskTable.columns.id,
        clientId: taskTable.columns.clientId,
        status: taskTable.columns.status,
        currency: taskTable.columns.currency,
      }).build();

      const tasks = await tx.query(taskPlan);
      const task = tasks[0];

      if (!task) throw new NotFoundException('Task not found');
      if (task.clientId !== client.userId) {
        throw new ForbiddenException('You do not own this task');
      }
      if (
        task.status !== 'WORKER_SELECTED' &&
        task.status !== 'AWAITING_PAYMENT'
      ) {
        throw new BadRequestException(
          'Funding is only permitted for a selected worker task awaiting payment',
        );
      }

      const contract = await tx.orm.public.Contract
        .where({ taskId })
        .first();

      if (!contract) {
        throw new NotFoundException('Contract not found for this task');
      }
      if (contract.status !== 'ACTIVE') {
        throw new BadRequestException('Contract is not eligible for funding');
      }

      const existingPayment = await tx.orm.public.Payment
        .where({ taskId })
        .first();

      if (existingPayment?.status === 'FUNDED') {
        throw new ConflictException('Payment has already been funded');
      }

      if (
        existingPayment &&
        existingPayment.status !== 'PENDING' &&
        existingPayment.status !== 'FAILED' &&
        existingPayment.status !== 'CANCELLED'
      ) {
        throw new ConflictException(
          `Payment cannot be retried from ${existingPayment.status}`,
        );
      }

      const amount = contract.agreedPrice;
      const currency = task.currency;
      if (!currency) {
        throw new BadRequestException(
          'Funding currency is unavailable for this task',
        );
      }

      if (existingPayment) {
        if (
          existingPayment.contractId !== contract.id ||
          existingPayment.clientId !== client.userId ||
          existingPayment.amount !== amount ||
          existingPayment.currency !== currency
        ) {
          throw new ConflictException(
            'Existing payment does not match the active task contract',
          );
        }

        const shouldReopen =
          existingPayment.status === 'FAILED' ||
          existingPayment.status === 'CANCELLED';

        const payment =
          shouldReopen
            ? await tx.orm.public.Payment.where({
                id: existingPayment.id,
                status: existingPayment.status,
              }).update({
                status: 'PENDING',
                provider: null,
                providerRef: null,
                fundedAt: null,
              })
            : existingPayment;

        if (!payment) {
          throw new ConflictException('Payment changed before retry could start');
        }

        const updatedTask = await tx.orm.public.Task.where({
          id: taskId,
          clientId: client.userId,
          status: task.status,
        }).update({
          status: 'AWAITING_PAYMENT',
        });

        if (!updatedTask && task.status !== 'AWAITING_PAYMENT') {
          throw new ConflictException('Task changed before payment retry could start');
        }

        if (shouldReopen) {
          await tx.orm.public.AuditLog.create({
            userId: client.userId,
            action: 'PAYMENT',
            entityType: 'Payment',
            entityId: existingPayment.id,
            details: 'Payment retry reopened the existing payment intent',
          });
        }

        return {
          paymentId: existingPayment.id,
          contractId: contract.id,
          amount,
          currency,
          providerRef: payment.providerRef,
          taskStatus: 'AWAITING_PAYMENT' as const,
          isRetry: shouldReopen,
          isExistingPayment: true,
        };
      }

      const paymentId = randomUUID();
      const commission = decimalTenPercent(amount);

      let payment;
      try {
        payment = await tx.orm.public.Payment.create({
          id: paymentId,
          taskId,
          clientId: client.userId,
          workerId: contract.workerId,
          contractId: contract.id,
          amount,
          currency,
          status: 'PENDING',
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            'Funding was initiated concurrently for this task',
          );
        }
        throw error;
      }

      await tx.orm.public.LedgerEntry.create({
        paymentId: payment.id,
        taskId,
        userId: client.userId,
        type: 'COMMISSION',
        amount: commission,
        currency,
        description: 'Marketplace commission for funding initiation',
        reference: contract.id,
      });

      await tx.orm.public.AuditLog.create({
        userId: client.userId,
        action: 'PAYMENT',
        entityType: 'Payment',
        entityId: payment.id,
        details: `Funding intent created for contract ${contract.id}; awaiting provider initiation`,
      });

      const updatedTask = await tx.orm.public.Task.where({
        id: taskId,
        clientId: client.userId,
        status: 'WORKER_SELECTED',
      }).update({
        status: 'AWAITING_PAYMENT',
      });

      if (!updatedTask) {
        throw new ConflictException(
          'Task status changed before funding could be initiated',
        );
      }

      return {
        paymentId,
        contractId: contract.id,
        amount,
        currency,
        providerRef: null,
        taskStatus: 'AWAITING_PAYMENT' as const,
        isRetry: false,
        isExistingPayment: false,
      };
    });

    try {
      let providerResult: Awaited<
        ReturnType<PaymentProvider['initiateFunding']>
      >;

      if (intent.isExistingPayment) {
        const reconciliation = await this.paymentProvider.reconcileFunding({
          paymentId: intent.paymentId,
          providerRef: intent.providerRef,
          amount: intent.amount,
          currency: intent.currency,
        });

        if (reconciliation.status === 'FOUND') {
          providerResult = {
            status: 'PENDING',
            provider: reconciliation.provider,
            providerRef: reconciliation.providerRef,
            checkoutUrl: reconciliation.checkoutUrl,
          };
        } else {
          providerResult = await this.paymentProvider.initiateFunding({
            paymentId: intent.paymentId,
            amount: intent.amount,
            currency: intent.currency,
            customerEmail: client.email,
          });
        }
      } else {
        providerResult = await this.paymentProvider.initiateFunding({
          paymentId: intent.paymentId,
          amount: intent.amount,
          currency: intent.currency,
          customerEmail: client.email,
        });
      }

      const updated = await db.transaction(async (tx) => {
        const payment = await tx.orm.public.Payment
          .where({
            id: intent.paymentId,
            status: 'PENDING',
          })
          .first();

        if (!payment) {
          return tx.orm.public.Payment.where({ id: intent.paymentId }).first();
        }

        return tx.orm.public.Payment.where({
          id: intent.paymentId,
          status: 'PENDING',
        }).update({
          provider: providerResult.provider,
          providerRef: providerResult.providerRef,
        });
      });

      const payment = updated ?? (await db.orm.public.Payment.where({
        id: intent.paymentId,
      }).first());

      if (!payment) {
        throw new NotFoundException('Payment disappeared after provider initiation');
      }

      return {
        task: {
          id: taskId,
          status: payment.status === 'FUNDED' ? 'FUNDED' : 'AWAITING_PAYMENT',
        },
        contract: {
          id: intent.contractId,
          taskId,
          status: 'ACTIVE',
          agreedPrice: intent.amount,
        },
        payment: {
          id: payment.id,
          taskId: payment.taskId,
          clientId: payment.clientId,
          workerId: payment.workerId,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          provider: payment.provider,
          providerRef: payment.providerRef,
          checkoutUrl: providerResult.checkoutUrl,
          fundedAt: payment.fundedAt,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        },
        providerConfirmation: payment.status === 'FUNDED' ? 'CONFIRMED' : 'AWAITING',
        retryable: payment.status === 'PENDING',
      };
    } catch (error) {
      // A provider timeout or initiation failure must not roll back the local
      // payment intent. The same local Payment ID remains the retry identity.
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Payment provider initiation failed; the payment can be retried safely',
      );
    }
  }
}
