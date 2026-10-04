import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';
import { CreateTaskDto } from './dto/create-task.dto.js';

@Injectable()
export class TasksService {
  async createTask(client: AuthenticatedUser, dto: CreateTaskDto) {
    if (!['PHYSICAL', 'VIRTUAL'].includes(dto.type)) throw new BadRequestException('Invalid task type');
    if (!['SHORT_TERM', 'LONG_TERM'].includes(dto.duration)) throw new BadRequestException('Invalid task duration');
    if (dto.budgetMin !== undefined && dto.budgetMax !== undefined && dto.budgetMax < dto.budgetMin) {
      throw new BadRequestException('budgetMax must be greater than or equal to budgetMin');
    }

    if (dto.expectedCompletionAt && new Date(dto.expectedCompletionAt).getTime() <= Date.now()) {
      throw new BadRequestException('expectedCompletionAt must be in the future');
    }

    if (dto.type === 'PHYSICAL' && !dto.locationDescription) {
      throw new BadRequestException('locationDescription is required for PHYSICAL tasks');
    }

    if (dto.type === 'VIRTUAL' && dto.locationDescription) {
      throw new BadRequestException('locationDescription is not allowed for VIRTUAL tasks');
    }

    const category = await db.orm.public.Category.where({ id: dto.categoryId }).first();
    if (!category || !category.active) {
      throw new NotFoundException('Active category not found');
    }

    return db.transaction(async (tx) => {
      const task = await tx.orm.public.Task.create({
        clientId: client.userId,
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        duration: dto.duration,
        budgetMin: dto.budgetMin?.toString() ?? null,
        budgetMax: dto.budgetMax?.toString() ?? null,
        expectedCompletionAt: dto.expectedCompletionAt ?? null,
        locationDescription: dto.locationDescription ?? null,
        requirements: dto.requirements ?? null,
      });
      const requirementItems = await Promise.all((dto.requirementItems ?? []).map((requirement) =>
        tx.orm.public.TaskRequirement.create({
          taskId: task.id,
          name: requirement.name,
          value: requirement.value ?? null,
        }),
      ));
      const attachments = await Promise.all((dto.attachments ?? []).map((attachment) =>
        tx.orm.public.TaskAttachment.create({
          taskId: task.id,
          fileUrl: attachment.fileUrl,
          fileName: attachment.fileName ?? null,
          fileType: attachment.fileType ?? null,
          fileSize: attachment.fileSize ?? null,
        }),
      ));
      return { ...task, requirementItems, attachments };
    });
  }
}
