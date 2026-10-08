import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db, type Tx } from '../prisma/db.js';
import { RefundProviderService } from '../payments/refund-provider.service.js';
import { CancellationRefundAccountingService } from '../payments/cancellation-refund-accounting.service.js';

type CancellationStageValue = 'DRAFT' | 'PUBLISHED' | 'RECEIVING_APPLICATIONS' | 'WORKER_SELECTED' | 'AWAITING_PAYMENT' | 'FUNDED' | 'IN_PROGRESS' | 'EXPIRED';

const CANCELLABLE_STAGES = new Set<CancellationStageValue>([
  'DRAFT',
  'PUBLISHED',
  'RECEIVING_APPLICATIONS',
  'WORKER_SELECTED',
  'AWAITING_PAYMENT',
  'FUNDED',
  'IN_PROGRESS',
  'EXPIRED',
]);

const POST_WORK_STAGES = new Set(['SUBMITTED', 'AWAITING_APPROVAL', 'COMPLETED', 'DISPUTED']);
const CONTRACT_REQUIRED_STAGES = new Set<CancellationStageValue>([
  'WORKER_SELECTED',
  'AWAITING_PAYMENT',
  'FUNDED',
  'IN_PROGRESS',
]);

type TaskRow = {
  id: string;
  clientId: string;
  status: string;
  currency: string;
};

type ContractRow = {
  id: string;
  taskId: string;
  workerId: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED" | "DISPUTED";
  agreedPrice: string;
  hiredAt: string | null;
  agreedDurationDays: number | null;
  extensionStartedAt: string | null;
};

type PaymentRow = {
  id: string;
  taskId: string;
  clientId: string;
  workerId: string | null;
  contractId: string;
  amount: string;
  currency: string;
  status: "PENDING" | "FUNDED" | "RELEASED" | "REFUNDED" | "FAILED" | "DISPUTED" | "CANCELLED";
};

type PenaltyRow = {
  id: string;
  sequenceNumber: number;
  banDurationDays: number;
  rollingPeriodAnchorAt: string;
  banStartedAt: string;
  banEndsAt: string;
  warningIssuedAt: string | null;
};

type CancellationAllocation = {
  category:
    | 'PRE_WORK_FIRST_DAY'
    | 'LONG_JOB_ELAPSED'
    | 'EXTENSION'
    | 'EXPIRY_REFUND'
    | 'ADMINISTRATIVE';
  calculationBasis:
    | 'NO_FINANCIAL_ALLOCATION'
    | 'FIRST_DAY_FULL_REFUND'
    | 'LONG_JOB_ELAPSED_ALLOCATION'
    | 'EXTENSION_90_PERCENT_REFUND'
    | 'EXPIRY_FULL_REFUND'
    | 'ADMINISTRATIVE';
  financialClassification: 'NO_FINANCIAL_ACTION' | 'FULL_REFUND' | 'PARTIAL_REFUND';
  workerPercentage: string;
  workerAmount: string;
  cancellationFee: string;
  clientRefund: string;
  elapsedApplicableSeconds: bigint | null;
  applicableDurationSeconds: bigint | null;
};

type CancelOptions = {
  refundRequested?: boolean;
};

function decimalToScaled(value: string): { units: bigint; scale: number } {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException('Financial amount is not a valid decimal');
  }
  const [whole, fraction = ''] = normalized.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function decimalFromScaled(units: bigint, scale: number): string {
  if (units < 0n) throw new BadRequestException('Financial allocation cannot be negative');
  const digits = units.toString().padStart(scale + 1, '0');
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

function multiplyDecimal(value: string, numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n) throw new BadRequestException('Invalid financial allocation denominator');
  const input = decimalToScaled(value);
  return decimalFromScaled((input.units * numerator) / denominator, input.scale);
}

function multiplyDecimalFraction(value: string, numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n) throw new BadRequestException('Invalid financial allocation denominator');
  const input = decimalToScaled(value);
  const outputScale = Math.max(input.scale, 2);
  const scaledInput = input.units * 10n ** BigInt(outputScale - input.scale);
  return decimalFromScaled((scaledInput * numerator) / denominator, outputScale);
}

function decimalRatio(numerator: bigint, denominator: bigint, decimalPlaces = 6): string {
  if (denominator <= 0n) throw new BadRequestException('Invalid ratio denominator');
  const scale = 10n ** BigInt(decimalPlaces);
  return decimalFromScaled((numerator * scale) / denominator, decimalPlaces);
}

function subtractDecimals(a: string, b: string): string {
  const left = decimalToScaled(a);
  const right = decimalToScaled(b);
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = left.units * 10n ** BigInt(scale - left.scale);
  const rightUnits = right.units * 10n ** BigInt(scale - right.scale);
  return decimalFromScaled(leftUnits - rightUnits, scale);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function monthAgo(date: Date): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - 1);
  return result;
}

@Injectable()
export class TaskCancellationService {
  constructor(
    private readonly refundProviderService: RefundProviderService,
    @Optional()
    private readonly accountingService?: CancellationRefundAccountingService,
  ) {}

  async cancelTask(
    actor: AuthenticatedUser,
    taskId: string,
    options: CancelOptions = {},
  ) {
    if (!actor?.userId || !actor.email) {
      throw new ForbiddenException('Authenticated user required');
    }

    const result = await db.transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId);
      if (!task) throw new NotFoundException('Task not found');

      const rawStage = task.status;
      if (rawStage === 'CANCELLED') {
        throw new ConflictException('Task is already cancelled');
      }
      const stage = rawStage as CancellationStageValue;
      if (POST_WORK_STAGES.has(stage)) {
        throw new ConflictException(
          'This task is beyond ordinary cancellation and requires the dispute/admin-resolution boundary',
        );
      }
      if (!CANCELLABLE_STAGES.has(stage)) {
        throw new BadRequestException('Task is not eligible for ordinary cancellation');
      }

      const contract = await this.lockContract(tx, taskId);

      if (CONTRACT_REQUIRED_STAGES.has(stage) && !contract) {
        throw new ConflictException('Cancellation requires an existing contract at this lifecycle stage');
      }
      if (contract && contract.status !== 'ACTIVE') {
        throw new ConflictException('Contract is not eligible for ordinary cancellation');
      }

      const actorType = this.deriveActorType(actor, task, contract);

      const payment = contract
        ? await this.lockPaymentForContract(tx, contract.id, taskId)
        : null;

      if (payment?.status === 'RELEASED') {
        throw new ConflictException(
          'Released payments cannot be ordinarily cancelled',
        );
      }

      if (payment && (
        payment.taskId !== task.id ||
        payment.contractId !== contract!.id ||
        payment.clientId !== task.clientId ||
        payment.workerId !== contract!.workerId ||
        payment.currency !== task.currency ||
        payment.amount !== contract!.agreedPrice
      )) {
        throw new ConflictException('Payment, task, and contract financial relationships do not match');
      }

      if (stage === 'EXPIRED' && actorType !== 'CLIENT') {
        throw new ForbiddenException('Only the client may choose a refund for an expired task');
      }

      if (stage === 'EXPIRED' && options.refundRequested !== true) {
        throw new BadRequestException(
          'An expired task requires an explicit client refund choice',
        );
      }

      if (stage !== 'EXPIRED' && options.refundRequested === true) {
        throw new BadRequestException(
          'Refund choice is only applicable when cancelling an expired task',
        );
      }

      const cancellationAt = new Date();
      const allocation = contract
        ? this.calculateAllocation(task, contract, payment, cancellationAt, stage)
        : this.noFinancialAllocation('PRE_WORK_FIRST_DAY', 'NO_FINANCIAL_ALLOCATION');

      const cancellation = await tx.orm.public.Cancellation.create({
        taskId,
        contractId: contract?.id ?? null,
        paymentId: payment?.id ?? null,
        actorId: actor.userId,
        actorType,
        stage,
        category: allocation.category,
        calculationBasis: allocation.calculationBasis,
        reason: null,
        agreedDurationDays: contract?.agreedDurationDays ?? null,
        hiredAt: contract?.hiredAt ?? null,
        firstDayBoundaryAt: contract?.hiredAt
          ? addDays(new Date(contract.hiredAt), 1).toISOString()
          : null,
        extensionStartedAt: contract?.extensionStartedAt ?? null,
        cancellationAt: cancellationAt.toISOString(),
        elapsedApplicableSeconds: allocation.elapsedApplicableSeconds,
        applicableDurationSeconds: allocation.applicableDurationSeconds,
        fundedAmount: payment?.amount ?? null,
        currency: payment?.currency ?? task.currency,
        workerPercentage: allocation.workerPercentage,
        workerAmount: allocation.workerAmount,
        cancellationFee: allocation.cancellationFee,
        clientRefund: allocation.clientRefund,
        financialClassification: allocation.financialClassification,
        metadata: JSON.stringify({
          refundRequested: options.refundRequested === true,
        }),
      });

      if (this.accountingService) {
        await this.accountingService.recordCancellationFeeInTransaction(tx, cancellation.id);
      }

      const updatedTask = await tx.orm.public.Task.where({
        id: taskId,
        status: stage,
      }).update({ status: 'CANCELLED' });

      if (!updatedTask) {
        throw new ConflictException(
          'Task changed before cancellation could be completed',
        );
      }

      if (contract) {
        const updatedContract = await tx.orm.public.Contract.where({
          id: contract.id,
          taskId,
          status: contract.status,
        }).update({ status: 'CANCELLED' });

        if (!updatedContract) {
          throw new ConflictException('Contract changed before cancellation could be completed');
        }
      }

      let penalty: PenaltyRow | null = null;
      if (actorType === 'WORKER') {
        penalty = await this.createWorkerPenalty(tx, actor.userId, cancellation.id, cancellationAt);
      }

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'Cancellation',
        entityId: cancellation.id,
        details: [
          `Cancellation created for task ${taskId}, contract ${contract?.id ?? 'none'}`,
          `actorType=${actorType}`,
          `stage=${stage}`,
          `category=${allocation.category}`,
          `calculationBasis=${allocation.calculationBasis}`,
          `cancellationAt=${cancellationAt.toISOString()}`,
          `fundedAmount=${payment?.amount ?? '0'}`,
          `currency=${payment?.currency ?? task.currency}`,
          `workerPercentage=${allocation.workerPercentage}`,
          `workerAmount=${allocation.workerAmount}`,
          `cancellationFee=${allocation.cancellationFee}`,
          `clientRefund=${allocation.clientRefund}`,
          `penalty=${penalty ? `${penalty.sequenceNumber}/${penalty.banDurationDays}d` : 'none'}`,
        ].join('; '),
      });

      return {
        cancellation: {
          id: cancellation.id,
          taskId,
          contractId: contract?.id ?? null,
          actorType,
          stage,
          category: allocation.category,
          calculationBasis: allocation.calculationBasis,
          cancellationAt: cancellation.cancellationAt,
          fundedAmount: cancellation.fundedAmount,
          currency: cancellation.currency,
          workerPercentage: cancellation.workerPercentage,
          workerAmount: cancellation.workerAmount,
          cancellationFee: cancellation.cancellationFee,
          clientRefund: cancellation.clientRefund,
          financialClassification: cancellation.financialClassification,
        },
        refund: payment && allocation.clientRefund !== '0'
          ? { status: 'PENDING', amount: allocation.clientRefund, currency: payment.currency }
          : null,
        workerPenalty: penalty
          ? {
              sequenceNumber: penalty.sequenceNumber,
              banDurationDays: penalty.banDurationDays,
              banStartedAt: penalty.banStartedAt,
              banEndsAt: penalty.banEndsAt,
            }
          : null,
        workerWarning: actorType === 'WORKER' && penalty?.sequenceNumber === 1
          ? 'You have reached one worker cancellation. A second cancellation within 30 days triggers a 3-day worker ban.'
          : null,
      };
    });

    const refund = result.refund
      ? await this.refundProviderService.initiateForCancellation(result.cancellation.id)
      : null;
    return { ...result, refund };
  }

  private deriveActorType(
    actor: AuthenticatedUser,
    task: TaskRow,
    contract: ContractRow | null,
  ): 'CLIENT' | 'WORKER' | 'ADMIN' {
    if (actor.roles.includes('ADMIN')) {
      return 'ADMIN';
    }

    if (actor.roles.includes('CLIENT') && task.clientId === actor.userId) {
      return 'CLIENT';
    }

    if (actor.roles.includes('WORKER') && contract?.workerId === actor.userId) {
      return 'WORKER';
    }

    throw new ForbiddenException(
      'You are not authorised to cancel this task or contract',
    );
  }

  private noFinancialAllocation(category: CancellationAllocation['category'], calculationBasis: CancellationAllocation['calculationBasis']): CancellationAllocation {
    return {
      category,
      calculationBasis,
      financialClassification: 'NO_FINANCIAL_ACTION',
      workerPercentage: '0',
      workerAmount: '0',
      cancellationFee: '0',
      clientRefund: '0',
      elapsedApplicableSeconds: null,
      applicableDurationSeconds: null,
    };
  }

  private calculateAllocation(
    task: TaskRow,
    contract: ContractRow,
    payment: PaymentRow | null,
    cancellationAt: Date,
    stage: CancellationStageValue,
  ): CancellationAllocation {
    if (!payment || payment.status === 'PENDING') {
      return {
        category: 'PRE_WORK_FIRST_DAY',
        calculationBasis: 'NO_FINANCIAL_ALLOCATION',
        financialClassification: 'NO_FINANCIAL_ACTION',
        workerPercentage: '0',
        workerAmount: '0',
        cancellationFee: '0',
        clientRefund: '0',
        elapsedApplicableSeconds: null,
        applicableDurationSeconds: null,
      };
    }

    if (payment.status !== 'FUNDED') {
      throw new ConflictException(
        `Payment cannot be ordinarily cancelled from status ${payment.status}`,
      );
    }

    if (!contract.hiredAt || !contract.agreedDurationDays) {
      throw new BadRequestException(
        'Contract lacks required cancellation timing data: hiredAt and agreedDurationDays',
      );
    }

    const hiredAt = new Date(contract.hiredAt);
    const firstDayBoundary = addDays(hiredAt, 1);

    if (contract.extensionStartedAt) {
      const extensionStartedAt = new Date(contract.extensionStartedAt);
      if (cancellationAt.getTime() >= extensionStartedAt.getTime()) {
        return this.partialRefundAllocation(
          'EXTENSION',
          'EXTENSION_90_PERCENT_REFUND',
          payment.amount,
        );
      }
    }

    if (cancellationAt.getTime() < firstDayBoundary.getTime()) {
      return this.fullRefundAllocation(
        'PRE_WORK_FIRST_DAY',
        'FIRST_DAY_FULL_REFUND',
        payment.amount,
      );
    }

    if (stage === 'EXPIRED') {
      return this.fullRefundAllocation(
        'EXPIRY_REFUND',
        'EXPIRY_FULL_REFUND',
        payment.amount,
      );
    }

    const fee = multiplyDecimal(payment.amount, 10n, 100n);

    if (contract.agreedDurationDays <= 3) {
      return {
        category: 'LONG_JOB_ELAPSED',
        calculationBasis: 'LONG_JOB_ELAPSED_ALLOCATION',
        financialClassification: 'PARTIAL_REFUND',
        workerPercentage: '0',
        workerAmount: '0',
        cancellationFee: fee,
        clientRefund: subtractDecimals(payment.amount, fee),
        elapsedApplicableSeconds: null,
        applicableDurationSeconds: null,
      };
    }

    const applicableDurationSeconds = BigInt(contract.agreedDurationDays) * 86_400n;
    const elapsedApplicableSeconds = BigInt(
      Math.min(
        Number(applicableDurationSeconds),
        Math.max(0, Math.floor((cancellationAt.getTime() - firstDayBoundary.getTime()) / 1000)),
      ),
    );

    const workerPercentageNumerator = elapsedApplicableSeconds * 50n;
    const workerPercentage = elapsedApplicableSeconds >= applicableDurationSeconds
      ? '50'
      : decimalRatio(workerPercentageNumerator, applicableDurationSeconds);

    const workerAmount = elapsedApplicableSeconds >= applicableDurationSeconds
      ? multiplyDecimal(payment.amount, 50n, 100n)
      : multiplyDecimalFraction(
          payment.amount,
          workerPercentageNumerator,
          applicableDurationSeconds * 100n,
        );
    const refund = subtractDecimals(
      subtractDecimals(payment.amount, workerAmount),
      fee,
    );

    return {
      category: 'LONG_JOB_ELAPSED',
      calculationBasis: 'LONG_JOB_ELAPSED_ALLOCATION',
      financialClassification: 'PARTIAL_REFUND',
      workerPercentage: workerPercentage.toString(),
      workerAmount,
      cancellationFee: fee,
      clientRefund: refund,
      elapsedApplicableSeconds,
      applicableDurationSeconds,
    };
  }

  private fullRefundAllocation(
    category: 'PRE_WORK_FIRST_DAY' | 'EXPIRY_REFUND',
    calculationBasis: 'FIRST_DAY_FULL_REFUND' | 'EXPIRY_FULL_REFUND',
    amount: string,
  ): CancellationAllocation {
    return {
      category,
      calculationBasis,
      financialClassification: 'FULL_REFUND',
      workerPercentage: '0',
      workerAmount: '0',
      cancellationFee: '0',
      clientRefund: amount,
      elapsedApplicableSeconds: null,
      applicableDurationSeconds: null,
    };
  }

  private partialRefundAllocation(
    category: 'EXTENSION',
    calculationBasis: 'EXTENSION_90_PERCENT_REFUND',
    amount: string,
  ): CancellationAllocation {
    const cancellationFee = multiplyDecimal(amount, 10n, 100n);
    return {
      category,
      calculationBasis,
      financialClassification: 'PARTIAL_REFUND',
      workerPercentage: '0',
      workerAmount: '0',
      cancellationFee,
      clientRefund: subtractDecimals(amount, cancellationFee),
      elapsedApplicableSeconds: null,
      applicableDurationSeconds: null,
    };
  }

  private async createWorkerPenalty(
    tx: Tx,
    workerId: string,
    cancellationId: string,
    cancellationAt: Date,
  ): Promise<PenaltyRow | null> {
    const previous = await tx.orm.public.WorkerCancellationPenalty
      .where({ workerId })
      .orderBy([(penalty) => penalty.createdAt.desc()])
      .first() as PenaltyRow | null;

    const resetBoundary = monthAgo(cancellationAt);
    const withinRollingPeriod =
      previous !== null &&
      new Date(previous.rollingPeriodAnchorAt).getTime() >= resetBoundary.getTime();

    const sequenceNumber = withinRollingPeriod
      ? Math.min(previous!.sequenceNumber + 1, 4)
      : 1;

    const banDurationDays = sequenceNumber === 1
      ? 0
      : sequenceNumber === 2
        ? 3
        : sequenceNumber === 3
          ? 5
          : 7;

    const rollingPeriodAnchorAt = withinRollingPeriod
      ? previous!.rollingPeriodAnchorAt
      : cancellationAt.toISOString();
    const banStartedAt = cancellationAt;
    const banEndsAt = addDays(banStartedAt, banDurationDays);

    const penalty = await tx.orm.public.WorkerCancellationPenalty.create({
      workerId,
      cancellationId,
      rollingPeriodAnchorAt,
      sequenceNumber,
      banDurationDays,
      banStartedAt: banStartedAt.toISOString(),
      banEndsAt: banEndsAt.toISOString(),
      warningIssuedAt: sequenceNumber === 1 ? cancellationAt.toISOString() : (previous?.warningIssuedAt ?? null),
    }) as PenaltyRow;

    if (sequenceNumber === 1) {
      await tx.orm.public.AuditLog.create({
        userId: workerId,
        action: 'UPDATE',
        entityType: 'WorkerCancellation',
        entityId: cancellationId,
        details: 'WARNING: worker cancellation count reached one; the second cancellation within the 30-day reset window triggers a 3-day worker ban.',
      });
    }

    return penalty;
  }

  private async lockTask(tx: Tx, taskId: string): Promise<TaskRow | null> {
    const taskTable = db.sql.public.task;
    const plan = db.raw.sql`
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

    const rows = await tx.query(plan);
    return rows[0] as TaskRow | undefined ?? null;
  }

  private async lockContract(tx: Tx, taskId: string): Promise<ContractRow | null> {
    const contractTable = db.sql.public.contract;
    const plan = db.raw.sql`
      SELECT "id", "taskId", "workerId", "status", "agreedPrice", "hiredAt", "agreedDurationDays", "extensionStartedAt"
      FROM "Contract"
      WHERE "taskId" = ${taskId}
      FOR UPDATE
    `.returnsRow({
      id: contractTable.columns.id,
      taskId: contractTable.columns.taskId,
      workerId: contractTable.columns.workerId,
      status: contractTable.columns.status,
      agreedPrice: contractTable.columns.agreedPrice,
      hiredAt: contractTable.columns.hiredAt,
      agreedDurationDays: contractTable.columns.agreedDurationDays,
      extensionStartedAt: contractTable.columns.extensionStartedAt,
    }).build();

    const rows = await tx.query(plan);
    return rows[0] as ContractRow | undefined ?? null;
  }

  private async lockPaymentForContract(
    tx: Tx,
    contractId: string,
    taskId: string,
  ): Promise<PaymentRow | null> {
    const paymentTable = db.sql.public.payment;
    const plan = db.raw.sql`
      SELECT "id", "taskId", "clientId", "workerId", "contractId", "amount", "currency", "status"
      FROM "Payment"
      WHERE "contractId" = ${contractId}
        AND "taskId" = ${taskId}
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `.returnsRow({
      id: paymentTable.columns.id,
      taskId: paymentTable.columns.taskId,
      clientId: paymentTable.columns.clientId,
      workerId: paymentTable.columns.workerId,
      contractId: paymentTable.columns.contractId,
      amount: paymentTable.columns.amount,
      currency: paymentTable.columns.currency,
      status: paymentTable.columns.status,
    }).build();

    const rows = await tx.query(plan);
    return rows[0] as PaymentRow | undefined ?? null;
  }
}
