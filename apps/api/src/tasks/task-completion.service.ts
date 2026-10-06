import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';

@Injectable()
export class TaskCompletionService {
  async startWork(worker: AuthenticatedUser, taskId: string) {
    if (!worker?.roles.includes('WORKER')) throw new ForbiddenException('WORKER role required');
    return db.transaction(async (tx) => {
      const contract = await tx.orm.public.Contract.where({ taskId }).first();
      if (!contract) throw new NotFoundException('Contract not found for this task');
      if (contract.workerId !== worker.userId) throw new ForbiddenException('You are not the selected worker for this task');
      if (contract.status !== 'ACTIVE') throw new BadRequestException('Contract is not active');
      const task = await tx.orm.public.Task.where({ id: taskId }).first();
      if (!task) throw new NotFoundException('Task not found');
      if (task.clientId === worker.userId) throw new ForbiddenException('A client cannot start work as the worker');
      if (task.status !== 'FUNDED') throw new BadRequestException('Task must be FUNDED before work can start');
      const updated = await tx.orm.public.Task.where({ id: taskId, status: 'FUNDED' }).update({ status: 'IN_PROGRESS' });
      if (!updated) throw new ConflictException('Task changed before work could start');
      await tx.orm.public.AuditLog.create({ userId: worker.userId, action: 'UPDATE', entityType: 'Task', entityId: taskId, details: 'Worker started work under contract ' + contract.id });
      return { task: { id: taskId, status: 'IN_PROGRESS' }, contract: { id: contract.id, status: 'ACTIVE' } };
    });
  }

  async submitCompletion(worker: AuthenticatedUser, taskId: string) {
    if (!worker?.roles.includes('WORKER')) throw new ForbiddenException('WORKER role required');
    return db.transaction(async (tx) => {
      const contract = await tx.orm.public.Contract.where({ taskId }).first();
      if (!contract) throw new NotFoundException('Contract not found for this task');
      if (contract.workerId !== worker.userId) throw new ForbiddenException('You are not the selected worker for this task');
      if (contract.status !== 'ACTIVE') throw new BadRequestException('Contract is not active');
      const task = await tx.orm.public.Task.where({ id: taskId }).first();
      if (!task) throw new NotFoundException('Task not found');
      if (task.clientId === worker.userId) throw new ForbiddenException('A client cannot submit completion as the worker');
      if (task.status !== 'IN_PROGRESS') throw new BadRequestException('Task must be IN_PROGRESS before completion can be submitted');
      const submitted = await tx.orm.public.Task.where({ id: taskId, status: 'IN_PROGRESS' }).update({ status: 'SUBMITTED' });
      if (!submitted) throw new ConflictException('Task changed before completion could be submitted');
      await tx.orm.public.AuditLog.create({ userId: worker.userId, action: 'UPDATE', entityType: 'Task', entityId: taskId, details: 'Worker submitted completion under contract ' + contract.id });
      const awaitingApproval = await tx.orm.public.Task.where({ id: taskId, status: 'SUBMITTED' }).update({ status: 'AWAITING_APPROVAL' });
      if (!awaitingApproval) throw new ConflictException('Task changed before approval could be requested');
      await tx.orm.public.AuditLog.create({ userId: worker.userId, action: 'UPDATE', entityType: 'Task', entityId: taskId, details: 'Task entered AWAITING_APPROVAL for contract ' + contract.id });
      return { task: { id: taskId, status: 'AWAITING_APPROVAL' }, contract: { id: contract.id, status: 'ACTIVE' } };
    });
  }

  async approveCompletion(client: AuthenticatedUser, taskId: string) {
    if (!client?.roles.includes('CLIENT')) throw new ForbiddenException('CLIENT role required');
    return db.transaction(async (tx) => {
      const contract = await tx.orm.public.Contract.where({ taskId }).first();
      if (!contract) throw new NotFoundException('Contract not found for this task');
      const task = await tx.orm.public.Task.where({ id: taskId }).first();
      if (!task) throw new NotFoundException('Task not found');
      if (task.clientId !== client.userId) throw new ForbiddenException('You do not own this task');
      if (contract.status !== 'ACTIVE') throw new BadRequestException('Contract is not active');
      if (task.status !== 'AWAITING_APPROVAL') throw new BadRequestException('Task must be AWAITING_APPROVAL before approval');
      const completedAt = new Date().toISOString();
      const updatedTask = await tx.orm.public.Task.where({ id: taskId, clientId: client.userId, status: 'AWAITING_APPROVAL' }).update({ status: 'COMPLETED' });
      if (!updatedTask) throw new ConflictException('Task changed before approval could be completed');
      const completedContract = await tx.orm.public.Contract.where({ id: contract.id, taskId, workerId: contract.workerId, status: 'ACTIVE' }).update({ status: 'COMPLETED', completedAt });
      if (!completedContract) throw new ConflictException('Contract changed before approval could be completed');
      await tx.orm.public.AuditLog.create({ userId: client.userId, action: 'UPDATE', entityType: 'Contract', entityId: contract.id, details: 'Client approved completion for task ' + taskId });
      await tx.orm.public.AuditLog.create({ userId: client.userId, action: 'UPDATE', entityType: 'Task', entityId: taskId, details: 'Client approved completion for contract ' + contract.id });
      return { task: { id: taskId, status: 'COMPLETED' }, contract: { id: contract.id, status: 'COMPLETED', completedAt } };
    });
  }
}