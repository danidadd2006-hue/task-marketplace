import { Injectable } from '@nestjs/common';
import { db } from '../prisma/db.js';

@Injectable()
export class AuditService {
  log(userId: string | null, action: 'CREATE' | 'DELETE' | 'ADMIN_ACTION', entityType: string, entityId: string | null, details: string) {
    return db.orm.public.AuditLog.create({ userId, action, entityType, entityId, details, ipAddress: null, userAgent: null });
  }
}
