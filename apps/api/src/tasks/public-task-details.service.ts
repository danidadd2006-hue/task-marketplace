import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../prisma/db.js';
import { PublicTaskDetailsResponseDto } from './dto/public-task-details-response.dto.js';

const PUBLIC_STATUSES = ['PUBLISHED', 'RECEIVING_APPLICATIONS'] as const;

type PublicTaskDetailsRecord = {
  id: string;
  title: string;
  description: string;
  type: 'PHYSICAL' | 'VIRTUAL';
  duration: 'SHORT_TERM' | 'LONG_TERM';
  status: 'PUBLISHED' | 'RECEIVING_APPLICATIONS';
  currency: string;
  budgetMin: unknown;
  budgetMax: unknown;
  expectedCompletionAt: unknown;
  requirements: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  category: {
    id: string;
    name: string;
  };
  requirementsList: Array<{
    id: string;
    taskId: string;
    name: string;
    value: string | null;
    createdAt: unknown;
    updatedAt: unknown;
  }>;
  attachments: Array<{
    id: string;
    taskId: string;
    fileName: string | null;
    fileType: string | null;
    fileSize: unknown;
    createdAt: unknown;
    updatedAt: unknown;
  }>;
};

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function toNullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function toNullableIsoString(value: unknown): string | null {
  return value == null ? null : toIsoString(value);
}

function toNullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

@Injectable()
export class PublicTaskDetailsService {
  async getTaskDetails(taskId: string): Promise<PublicTaskDetailsResponseDto> {
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

    return this.toResponse(task as PublicTaskDetailsRecord);
  }

  private toResponse(task: PublicTaskDetailsRecord): PublicTaskDetailsResponseDto {
    return Object.assign(new PublicTaskDetailsResponseDto(), {
      id: task.id,
      title: task.title,
      description: task.description,
      type: task.type,
      duration: task.duration,
      status: task.status,
      currency: task.currency,
      budgetMin: toNullableString(task.budgetMin),
      budgetMax: toNullableString(task.budgetMax),
      expectedCompletionAt: toNullableIsoString(task.expectedCompletionAt),
      requirements: task.requirements,
      createdAt: toIsoString(task.createdAt),
      updatedAt: toIsoString(task.updatedAt),
      category: {
        id: task.category.id,
        name: task.category.name,
      },
      requirementsList: task.requirementsList.map((requirement) => ({
        id: requirement.id,
        taskId: requirement.taskId,
        name: requirement.name,
        value: requirement.value,
        createdAt: toIsoString(requirement.createdAt),
        updatedAt: toIsoString(requirement.updatedAt),
      })),
      attachments: task.attachments.map((attachment) => ({
        id: attachment.id,
        taskId: attachment.taskId,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        fileSize: toNullableNumber(attachment.fileSize),
        createdAt: toIsoString(attachment.createdAt),
        updatedAt: toIsoString(attachment.updatedAt),
      })),
    });
  }
}
