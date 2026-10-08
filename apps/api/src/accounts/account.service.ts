import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { TrustSafetyService } from '../trust-safety/trust-safety.service.js';
import { db } from '../prisma/db.js';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';

@Injectable()
export class AccountService {
  constructor(private readonly trustSafety: TrustSafetyService) {}

  async changeStatus(actor: AuthenticatedUser, userId: string, status: AccountStatus, reason: string) {
    const cleanReason = reason.trim();
    if (!cleanReason) throw new BadRequestException('Administrative reason is required');

    return db.transaction(async (tx: any) => {
      await this.requireAdmin(actor, tx);
      if (actor.userId === userId) throw new BadRequestException('Administrators cannot change their own account status');

      const user = await tx.orm.public.User.where({ id: userId }).first();
      if (!user) throw new NotFoundException('User not found');

      this.validateTransition(user.status, status);

      const caseRow = await this.trustSafety.createCaseInTransaction(tx, actor, {
        type: 'MODERATION',
        category: 'ACCOUNT_ENFORCEMENT',
        subjectType: 'USER',
        subjectId: userId,
        reason: cleanReason,
      });

      const updated = await tx.orm.public.User
        .where({ id: userId, status: user.status })
        .update({ status });

      if (!updated) throw new ConflictException('Account status changed concurrently');

      if (status !== 'ACTIVE') {
        await tx.orm.public.RefreshToken
          .where({ userId, revokedAt: null })
          .update({ revokedAt: new Date().toISOString() });
      }

      await tx.orm.public.TrustCaseHistory.create({
        caseId: caseRow.id,
        actorId: actor.userId,
        action: 'ACTION_APPLIED',
        fromStatus: 'OPEN',
        toStatus: 'OPEN',
        reason: cleanReason,
        metadataJson: JSON.stringify({
          actionName: 'ACCOUNT_STATUS_CHANGED',
          targetUserId: userId,
          previousStatus: user.status,
          resultingStatus: status,
        }),
      });

      await tx.orm.public.AuditLog.create({
        userId: actor.userId,
        action: 'ADMIN_ACTION',
        entityType: 'User',
        entityId: userId,
        details: JSON.stringify({
          action: 'ACCOUNT_STATUS_CHANGED',
          previousStatus: user.status,
          resultingStatus: status,
          caseId: caseRow.id,
          reason: cleanReason,
        }),
      });

      return {
        userId,
        previousStatus: user.status,
        status,
        caseId: caseRow.id,
        reason: cleanReason,
      };
    });
  }

  private validateTransition(currentStatus: string, requestedStatus: AccountStatus) {
    if (requestedStatus === currentStatus) {
      throw new ConflictException('Account is already in the requested status');
    }

    if (requestedStatus === 'ACTIVE') {
      if (!['SUSPENDED', 'BANNED'].includes(currentStatus)) {
        throw new BadRequestException('Only SUSPENDED or BANNED accounts can be restored');
      }
      return;
    }

    if (currentStatus !== 'ACTIVE') {
      if (currentStatus === 'DELETED') {
        throw new BadRequestException('DELETED accounts cannot be restored or re-enforced');
      }
      throw new BadRequestException('Only ACTIVE accounts can transition to a non-active status');
    }
  }

  private async requireAdmin(actor: AuthenticatedUser, client: any) {
    const user = await client.orm.public.User.where({ id: actor.userId }).first();
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active');
    }

    const assignments = await client.orm.public.UserRoleAssignment.where({ userId: actor.userId }).all();
    if (!assignments.some((assignment: any) => assignment.role === 'ADMIN')) {
      throw new ForbiddenException('Administrative authorization required');
    }
  }
}
