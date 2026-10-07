import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';
import { CreateTaskApplicationDto } from './dto/create-task-application.dto.js';

const ELIGIBLE_TASK_STATUSES = ['PUBLISHED', 'RECEIVING_APPLICATIONS'] as const;
const APPLICATION_TOKEN_COST = 5;
const STARTING_WORKER_TOKENS = 100;

type SqlError = {
  sqlState?: string;
  cause?: SqlError;
};

function isUniqueViolation(error: unknown): boolean {
  let current: SqlError | undefined = error as SqlError | undefined;

  while (current) {
    if (current.sqlState === '23505') {
      return true;
    }
    current = current.cause;
  }

  return false;
}

@Injectable()
export class TaskApplicationService {
  async submitApplication(
    worker: AuthenticatedUser,
    taskId: string,
    dto: CreateTaskApplicationDto,
  ) {
    if (!worker?.roles.includes('WORKER')) {
      throw new ForbiddenException('WORKER role required');
    }

    if (
      dto.estimatedCompletionAt &&
      new Date(dto.estimatedCompletionAt).getTime() <= Date.now()
    ) {
      throw new BadRequestException('estimatedCompletionAt must be in the future');
    }

    return db.transaction(async (tx) => {
      const userTable = tx.sql.public.user;
      const userLockPlan = tx.raw.sql`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${worker.userId}
        FOR UPDATE
      `
        .returnsRow({
          id: userTable.columns.id,
        })
        .build();

      const lockedUsers = await tx.query(userLockPlan);
      if (!lockedUsers[0]) {
        throw new NotFoundException('Worker account not found');
      }

      const taskTable = tx.sql.public.task;
      const lockPlan = tx.raw.sql`
        SELECT "id", "clientId", "status"
        FROM "Task"
        WHERE "id" = ${taskId}
        FOR UPDATE
      `
        .returnsRow({
          id: taskTable.columns.id,
          clientId: taskTable.columns.clientId,
          status: taskTable.columns.status,
        })
        .build();

      const lockedTasks = await tx.query(lockPlan);
      const task = lockedTasks[0];

      if (!task) {
        throw new NotFoundException('Task not found');
      }

      if (!ELIGIBLE_TASK_STATUSES.includes(task.status as (typeof ELIGIBLE_TASK_STATUSES)[number])) {
        throw new BadRequestException('Task is not accepting applications');
      }

      if (task.clientId === worker.userId) {
        throw new ForbiddenException('You cannot apply to your own task');
      }

      const existing = await tx.orm.public.Application
        .where({
          taskId,
          workerId: worker.userId,
        })
        .first();

      if (existing) {
        throw new ConflictException('You have already applied to this task');
      }

      let wallet = await tx.orm.public.TokenWallet
        .where({ userId: worker.userId })
        .first();

      if (!wallet) {
        wallet = await tx.orm.public.TokenWallet.create({
          userId: worker.userId,
          balance: STARTING_WORKER_TOKENS,
        });

        await tx.orm.public.TokenTransaction.create({
          userId: worker.userId,
          type: 'GRANT',
          amount: STARTING_WORKER_TOKENS,
          balanceAfter: STARTING_WORKER_TOKENS,
          reference: `worker-starting-grant:${worker.userId}`,
          note: 'Initial token grant for WORKER account',
        });
      }

      if (wallet.balance < APPLICATION_TOKEN_COST) {
        throw new BadRequestException('Insufficient tokens to apply for this task');
      }

      let application;
      try {
        application = await tx.orm.public.Application.create({
          taskId,
          workerId: worker.userId,
          proposedPrice: dto.proposedPrice.toString(),
          estimatedCompletionAt: dto.estimatedCompletionAt ?? null,
          message: dto.message ?? null,
          qualifications: dto.qualifications ?? null,
          questions: dto.questions ?? null,
          status: 'SUBMITTED',
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('You have already applied to this task');
        }
        throw error;
      }

      const nextBalance = wallet.balance - APPLICATION_TOKEN_COST;
      const tokenBalanceUpdated = await tx.orm.public.TokenWallet
        .where({
          userId: worker.userId,
          balance: wallet.balance,
        })
        .update({
          balance: nextBalance,
        });

      if (!tokenBalanceUpdated) {
        throw new BadRequestException('Token balance changed; retry the application');
      }

      await tx.orm.public.TokenTransaction.create({
        userId: worker.userId,
        type: 'SPEND',
        amount: -APPLICATION_TOKEN_COST,
        balanceAfter: nextBalance,
        reference: `application:${application.id}`,
        note: 'Token cost for job application',
      });

      for (const attachment of dto.attachments ?? []) {
        await tx.orm.public.ApplicationAttachment.create({
          applicationId: application.id,
          fileUrl: attachment.fileUrl,
          fileName: attachment.fileName ?? null,
          fileType: attachment.fileType ?? null,
          fileSize: attachment.fileSize ?? null,
        });
      }

      const created = await tx.orm.public.Application
        .where({ id: application.id })
        .select(
          'id',
          'taskId',
          'workerId',
          'proposedPrice',
          'estimatedCompletionAt',
          'message',
          'qualifications',
          'questions',
          'status',
          'createdAt',
          'updatedAt',
        )
        .include('attachments', (attachment) =>
          attachment.select(
            'id',
            'applicationId',
            'fileUrl',
            'fileName',
            'fileType',
            'fileSize',
            'createdAt',
            'updatedAt',
          ),
        )
        .first();

      if (!created) {
        throw new NotFoundException('Created application could not be loaded');
      }

      return created;
    });
  }
}
