import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';
import { NotificationDomainEventService } from '../notifications/notification-domain-event.service.js';

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
export class TaskWorkerSelectionService {
  constructor(@Optional() private readonly notificationDomainEventService?: NotificationDomainEventService) {}

  async selectWorker(
    client: AuthenticatedUser,
    taskId: string,
    applicationId: string,
  ) {
    if (!client?.roles.includes('CLIENT')) {
      throw new ForbiddenException('CLIENT role required');
    }

    const result = await db.transaction(async (tx) => {
      const taskTable = tx.sql.public.task;
      const applicationTable = tx.sql.public.application;

      const taskLockPlan = tx.raw.sql`
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

      const lockedTasks = await tx.query(taskLockPlan);
      const task = lockedTasks[0];

      if (!task) {
        throw new NotFoundException('Task not found');
      }

      if (task.clientId !== client.userId) {
        throw new ForbiddenException('You do not own this task');
      }

      if (task.status !== 'RECEIVING_APPLICATIONS') {
        throw new BadRequestException('Task is not accepting worker selection');
      }

      const applicationLockPlan = tx.raw.sql`
        SELECT "id", "taskId", "workerId", "status", "proposedPrice"
        FROM "Application"
        WHERE "id" = ${applicationId}
          AND "taskId" = ${taskId}
        FOR UPDATE
      `
        .returnsRow({
          id: applicationTable.columns.id,
          taskId: applicationTable.columns.taskId,
          workerId: applicationTable.columns.workerId,
          status: applicationTable.columns.status,
          proposedPrice: applicationTable.columns.proposedPrice,
        })
        .build();

      const lockedApplications = await tx.query(applicationLockPlan);
      const application = lockedApplications[0];

      if (!application) {
        throw new NotFoundException('Application not found for this task');
      }

      if (application.status !== 'SUBMITTED') {
        throw new BadRequestException('Application is not eligible for selection');
      }

      if (application.workerId === task.clientId) {
        throw new ForbiddenException('You cannot select your own application');
      }

      const worker = await tx.orm.public.User
        .where({
          id: application.workerId,
          status: 'ACTIVE',
        })
        .first();

      if (!worker) {
        throw new BadRequestException('Application worker is not eligible');
      }

      const workerRole = await tx.orm.public.UserRoleAssignment
        .where({
          userId: application.workerId,
          role: 'WORKER',
        })
        .first();

      if (!workerRole) {
        throw new BadRequestException('Application worker is not eligible');
      }

      let contract;
      try {
        contract = await tx.orm.public.Contract.create({
          taskId,
          workerId: application.workerId,
          status: 'ACTIVE',
          agreedPrice: application.proposedPrice,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A contract already exists for this task');
        }
        throw error;
      }

      const updatedApplication = await tx.orm.public.Application.where({
        id: applicationId,
        taskId,
        status: 'SUBMITTED',
      }).update({
        status: 'ACCEPTED',
      });

      if (!updatedApplication) {
        throw new BadRequestException(
          'Application status changed before selection could be completed',
        );
      }

      const updatedTask = await tx.orm.public.Task.where({
        id: taskId,
        clientId: client.userId,
        status: 'RECEIVING_APPLICATIONS',
      }).update({
        status: 'WORKER_SELECTED',
      });

      if (!updatedTask) {
        throw new BadRequestException(
          'Task status changed before selection could be completed',
        );
      }

      return {
        task: {
          id: taskId,
          status: 'WORKER_SELECTED',
        },
        application: {
          id: application.id,
          taskId: application.taskId,
          workerId: application.workerId,
          proposedPrice: application.proposedPrice,
          status: 'ACCEPTED',
        },
        contract: {
          id: contract.id,
          taskId: contract.taskId,
          workerId: contract.workerId,
          status: contract.status,
          agreedPrice: contract.agreedPrice,
          startedAt: contract.startedAt,
          completedAt: contract.completedAt,
          createdAt: contract.createdAt,
          updatedAt: contract.updatedAt,
        },
      };
    });

    await this.notificationDomainEventService?.applicationAccepted(result.application.id);
    await this.notificationDomainEventService?.contractCreated(result.contract.id);
    return result;
  }
}
