import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../prisma/db.js';

export type NonActiveStatus = 'SUSPENDED' | 'BANNED' | 'DELETED';

@Injectable()
export class AccountService {
  async changeStatus(userId: string, status: NonActiveStatus) {
    return db.transaction(async (tx) => {
      const user = await tx.orm.public.User.where({ id: userId }).first();
      if (!user) throw new NotFoundException('User not found');
      if (user.status !== 'ACTIVE') throw new BadRequestException('Only ACTIVE accounts can transition to a non-active status');
      const updated = await tx.orm.public.User.where({ id: userId }).update({ status });
      await tx.orm.public.RefreshToken.where({ userId, revokedAt: null }).update({ revokedAt: new Date().toISOString() });
      return updated;
    });
  }
}
