import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole } from './authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import { db } from '../prisma/db.js';

@Injectable()
export class RoleAssignmentService {
  constructor(private readonly audit: AuditService) {}

  async assign(actorId: string, userId: string, role: UserRole) {
    if (actorId === userId) throw new BadRequestException('Users cannot modify their own roles');
    const user = await db.orm.public.User.where({ id: userId }).first();
    if (!user) throw new NotFoundException('User not found');
    const existing = await db.orm.public.UserRoleAssignment.where({ userId, role }).first();
    if (existing) throw new ConflictException('Role is already assigned');
    const assignment = await db.orm.public.UserRoleAssignment.create({ userId, role, assignedBy: actorId });
    await this.audit.log(actorId, 'CREATE', 'UserRoleAssignment', assignment.id, JSON.stringify({ userId, role }));
    return assignment;
  }

  async remove(actorId: string, userId: string, role: UserRole) {
    if (actorId === userId) throw new BadRequestException('Users cannot modify their own roles');
    const assignments = await db.orm.public.UserRoleAssignment.where({ userId }).all();
    const assignment = assignments.find((item) => item.role === role);
    if (!assignment) throw new NotFoundException('Role assignment not found');
    if (assignments.length === 1) throw new BadRequestException('Cannot remove the final required role');
    await db.orm.public.UserRoleAssignment.where({ id: assignment.id }).delete();
    await this.audit.log(actorId, 'DELETE', 'UserRoleAssignment', assignment.id, JSON.stringify({ userId, role }));
  }
}
