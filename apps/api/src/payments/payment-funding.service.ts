import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider.js';

const COMMISSION_RATE_NUMERATOR = 10n;
const COMMISSION_RATE_DENOMINATOR = 100n;

function decimalTenPercent(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException('Contract amount is not a valid decimal');
  }

  const [whole, fraction = ''] = normalized.split('.');
  const scale = fraction.length;
  const digits = BigInt(whole + fraction);
  const result = digits * COMMISSION_RATE_NUMERATOR / COMMISSION_RATE_DENOMINATOR;
  const commissionScale = scale + 1;
  const raw = result.toString().padStart(commissionScale + 1, '0');
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

    return db.transaction(async (tx) => {
      const taskTable = tx.sql.public.task;
      const taskPlan = tx.raw.sql`
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
      if (task.status !== 'WORKER_SELECTED') {
        throw new BadRequestException(
          'Funding is only permitted for a WORKER_SELECTED task',
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
      if (contract.taskId !== taskId) {
        throw new BadRequestException('Contract does not belong to this task');
      }

      const existingPayment = await tx.orm.public.Payment
        .where({ taskId })
        .first();

      if (existingPayment) {
        throw new ConflictException('Funding has already been initiated for this task');
      }

      const amount = contract.agreedPrice;
      const currency = task.currency;
      if (!currency) {
        throw new BadRequestException(
          'Funding currency is unavailable for this task',
        );
      }
      const commission = decimalTenPercent(amount);
      const paymentId = randomUUID();
      const providerResult = await this.paymentProvider.initiateFunding({
        paymentId,
        amount,
        currency,
      });

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
          provider: providerResult.provider,
          providerRef: providerResult.providerRef,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            'Funding has already been initiated for this task',
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
        details: `Funding initiated for contract ${contract.id}; payment awaiting provider confirmation`,
      });

      const updatedTask = await tx.orm.public.Task.where({
        id: taskId,
        clientId: client.userId,
        status: 'WORKER_SELECTED',
      }).update({
        status: 'AWAITING_PAYMENT',
      });

      if (!updatedTask) {
        throw new BadRequestException(
          'Task status changed before funding could be initiated',
        );
      }

      return {
        task: {
          id: taskId,
          status: 'AWAITING_PAYMENT',
        },
        contract: {
          id: contract.id,
          taskId: contract.taskId,
          workerId: contract.workerId,
          status: contract.status,
          agreedPrice: contract.agreedPrice,
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
          fundedAt: payment.fundedAt,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        },
        commission: {
          rate: '10%',
          amount: commission,
          currency,
        },
        providerConfirmation: 'AWAITING',
      };
    });
  }
}
