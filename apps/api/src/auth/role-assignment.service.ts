import { BadRequestException, ConflictException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { UserRole } from './authenticated-user.js';
import { db } from '../prisma/db.js';
import { getStartingWorkerTokenGrant } from '../tokens/token.constants.js';

@Injectable()
export class RoleAssignmentService {

  async assign(actorId: string, userId: string, role: UserRole) {
    if (actorId === userId) throw new BadRequestException('Users cannot modify their own roles');
    this.validateRole(role);

    return db.transaction(async (tx: any) => {
      await this.requireAdmin(actorId, tx);

      const user = await tx.orm.public.User.where({ id: userId }).first();
      if (!user) throw new NotFoundException('User not found');

      const existing = await tx.orm.public.UserRoleAssignment.where({ userId, role }).first();
      if (existing) throw new ConflictException('Role is already assigned');

      const assignment = await tx.orm.public.UserRoleAssignment.create({
        userId,
        role,
        assignedBy: actorId,
      });

      if (role === 'WORKER') {
        const wallet = await tx.orm.public.TokenWallet.where({ userId }).first();

        if (!wallet) {
          const startingTokens = getStartingWorkerTokenGrant();

          await tx.orm.public.TokenWallet.create({
            userId,
            balance: startingTokens,
          });

          await tx.orm.public.TokenTransaction.create({
            userId,
            type: 'GRANT',
            amount: startingTokens,
            balanceAfter: startingTokens,
            reference: 'worker-starting-grant:' + userId,
            note: 'Initial token allocation for WORKER account',
          });
        }
      }

      await tx.orm.public.AuditLog.create({
        userId: actorId,
        action: 'ADMIN_ACTION',
        entityType: 'UserRoleAssignment',
        entityId: assignment.id,
        details: JSON.stringify({ action: 'ASSIGN_ROLE', userId, role }),
      });

      return assignment;
    });
  }

  async remove(actorId: string, userId: string, role: UserRole) {
    if (actorId === userId) throw new BadRequestException('Users cannot modify their own roles');
    this.validateRole(role);

    return db.transaction(async (tx: any) => {
      await this.requireAdmin(actorId, tx);

      const assignments = await tx.orm.public.UserRoleAssignment.where({ userId }).all();
      const assignment = assignments.find((item: any) => item.role === role);
      if (!assignment) throw new NotFoundException('Role assignment not found');
      if (assignments.length === 1) throw new BadRequestException('Cannot remove the final required role');

      const deleted = await tx.orm.public.UserRoleAssignment.where({ id: assignment.id }).delete();
      if (!deleted) throw new ConflictException('Role assignment changed concurrently');

      await tx.orm.public.AuditLog.create({
        userId: actorId,
        action: 'ADMIN_ACTION',
        entityType: 'UserRoleAssignment',
        entityId: assignment.id,
        details: JSON.stringify({ action: 'REMOVE_ROLE', userId, role }),
      });
    });
  }

  private validateRole(role: UserRole) {
    if (!['CLIENT', 'WORKER', 'ADMIN'].includes(role)) {
      throw new BadRequestException('Invalid role');
    }
  }

  private async requireAdmin(actorId: string, client: any) {
    const actor = await client.orm.public.User.where({ id: actorId }).first();
    if (!actor || actor.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active');
    }

    const assignments = await client.orm.public.UserRoleAssignment.where({ userId: actorId }).all();
    if (!assignments.some((assignment: any) => assignment.role === 'ADMIN')) {
      throw new ForbiddenException('Administrative authorization required');
    }
  }
}
