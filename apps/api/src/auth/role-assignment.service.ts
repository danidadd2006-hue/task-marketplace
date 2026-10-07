import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole } from './authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import { db } from '../prisma/db.js';

const STARTING_WORKER_TOKENS = 100;

@Injectable()
export class RoleAssignmentService {
  constructor(private readonly audit: AuditService) {}

  async assign(actorId: string, userId: string, role: UserRole) {
    if (actorId === userId) throw new BadRequestException('Users cannot modify their own roles');

    const result = await db.transaction(async (tx) => {
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
        const wallet =
          (await tx.orm.public.TokenWallet.where({ userId }).first()) ??
          (await tx.orm.public.TokenWallet.create({ userId, balance: 0 }));

        if (wallet.balance === 0) {
          const updated = await tx.orm.public.TokenWallet
            .where({ userId, balance: 0 })
            .update({ balance: STARTING_WORKER_TOKENS });

          if (!updated) {
            throw new BadRequestException('Token wallet changed; retry the role assignment');
          }

          await tx.orm.public.TokenTransaction.create({
            userId,
            type: 'GRANT',
            amount: STARTING_WORKER_TOKENS,
            balanceAfter: STARTING_WORKER_TOKENS,
            reference: `worker-starting-grant:${userId}`,
            note: 'Initial token grant for new WORKER role',
          });
        }
      }

      return assignment;
    });

    await this.audit.log(
      actorId,
      'CREATE',
      'UserRoleAssignment',
      result.id,
      JSON.stringify({ userId, role }),
    );

    return result;
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
