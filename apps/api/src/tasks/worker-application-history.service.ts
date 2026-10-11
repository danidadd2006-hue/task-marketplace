import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';
import { WorkerApplicationHistoryQueryDto } from './dto/worker-application-history-query.dto.js';

@Injectable()
export class WorkerApplicationHistoryService {
  async listOwnApplications(
    worker: AuthenticatedUser,
    query: WorkerApplicationHistoryQueryDto,
  ) {
    if (!worker?.roles.includes('WORKER')) {
      throw new ForbiddenException('WORKER role required');
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const rows = await db.orm.public.Application
      .where({ workerId: worker.userId })
      .select(
        'id',
        'taskId',
        'proposedPrice',
        'estimatedCompletionAt',
        'message',
        'qualifications',
        'questions',
        'status',
        'createdAt',
        'updatedAt',
      )
      .include('task', (task) =>
        task.select('id', 'title', 'status', 'currency', 'createdAt'),
      )
      .include('attachments', (attachment) =>
        attachment.select('id', 'fileName', 'fileType', 'fileSize', 'createdAt'),
      )
      .orderBy([(application) => application.createdAt.desc(), (application) => application.id.desc()])
      .offset(offset)
      .limit(pageSize + 1)
      .all();

    const hasMore = rows.length > pageSize;

    return {
      items: rows.slice(0, pageSize),
      page,
      pageSize,
      hasMore,
    };
  }
}
