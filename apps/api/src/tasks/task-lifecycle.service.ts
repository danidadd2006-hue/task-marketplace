import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';

export type TaskLifecycleStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'RECEIVING_APPLICATIONS'
  | 'WORKER_SELECTED'
  | 'AWAITING_PAYMENT'
  | 'FUNDED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DISPUTED'
  | 'EXPIRED';

const ALLOWED_TRANSITIONS: Record<TaskLifecycleStatus, readonly TaskLifecycleStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED', 'EXPIRED'],
  PUBLISHED: ['RECEIVING_APPLICATIONS', 'CANCELLED', 'EXPIRED'],
  RECEIVING_APPLICATIONS: ['WORKER_SELECTED', 'CANCELLED', 'EXPIRED'],
  WORKER_SELECTED: ['AWAITING_PAYMENT', 'CANCELLED', 'DISPUTED'],
  AWAITING_PAYMENT: ['FUNDED', 'CANCELLED', 'DISPUTED'],
  FUNDED: ['IN_PROGRESS', 'CANCELLED', 'DISPUTED'],
  IN_PROGRESS: ['SUBMITTED', 'CANCELLED', 'DISPUTED'],
  SUBMITTED: ['AWAITING_APPROVAL', 'DISPUTED'],
  AWAITING_APPROVAL: ['COMPLETED', 'DISPUTED'],
  COMPLETED: [],
  CANCELLED: [],
  DISPUTED: [],
  EXPIRED: [],
};

@Injectable()
export class TaskLifecycleService {
  async transition(
    actor: AuthenticatedUser,
    taskId: string,
    targetStatus: TaskLifecycleStatus,
  ) {
    const task = await db.orm.public.Task.where({ id: taskId }).first();

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.clientId !== actor.userId) {
      throw new ForbiddenException('You do not own this task');
    }

    if (!actor.roles.includes('CLIENT')) {
      throw new ForbiddenException('CLIENT role required');
    }

    const currentStatus = task.status as TaskLifecycleStatus;
    const allowedTargets = ALLOWED_TRANSITIONS[currentStatus] ?? [];

    if (!allowedTargets.includes(targetStatus)) {
      throw new BadRequestException(
        `Invalid task status transition: ${currentStatus} -> ${targetStatus}`,
      );
    }

    if (targetStatus === 'PUBLISHED') {
      await this.validatePublishEligibility(task);
    }

    return db.transaction(async (tx) => {
      const updated = await tx.orm.public.Task.where({
        id: taskId,
        status: currentStatus,
        clientId: actor.userId,
      }).update({ status: targetStatus });

      if (!updated) {
        throw new BadRequestException('Task status changed before the transition could be completed');
      }

      return updated;
    });
  }

  private async validatePublishEligibility(task: {
    title: string;
    description: string;
    type: string;
    duration: string;
    categoryId: string;
  }) {
    if (!task.title?.trim() || !task.description?.trim()) {
      throw new BadRequestException('Task title and description are required before publishing');
    }

    if (!['PHYSICAL', 'VIRTUAL'].includes(task.type)) {
      throw new BadRequestException('Task type must be valid before publishing');
    }

    if (!['SHORT_TERM', 'LONG_TERM'].includes(task.duration)) {
      throw new BadRequestException('Task duration must be valid before publishing');
    }

    const category = await db.orm.public.Category.where({ id: task.categoryId }).first();
    if (!category || !category.active) {
      throw new BadRequestException('Task category must be active before publishing');
    }
  }
}
