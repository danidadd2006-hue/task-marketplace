import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../prisma/db.js';

const PUBLIC_STATUSES = ['PUBLISHED', 'RECEIVING_APPLICATIONS'] as const;

@Injectable()
export class PublicTaskDetailsService {
  async getTaskDetails(taskId: string) {
    const task = await db.orm.public.Task
      .where((task) => task.status.in([...PUBLIC_STATUSES]))
      .where({ id: taskId })
      .select(
        'id',
        'title',
        'description',
        'type',
        'duration',
        'status',
        'currency',
        'budgetMin',
        'budgetMax',
        'expectedCompletionAt',
        'requirements',
        'createdAt',
        'updatedAt',
      )
      .include('category', (category) =>
        category.select('id', 'name'),
      )
      .include('requirementsList', (requirement) =>
        requirement.select(
          'id',
          'taskId',
          'name',
          'value',
          'createdAt',
          'updatedAt',
        ),
      )
      .include('attachments', (attachment) =>
        attachment.select(
          'id',
          'taskId',
          'fileName',
          'fileType',
          'fileSize',
          'createdAt',
          'updatedAt',
        ),
      )
      .first();

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }
}
