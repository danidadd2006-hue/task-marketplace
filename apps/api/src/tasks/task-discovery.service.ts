import { Injectable } from '@nestjs/common';
import { db } from '../prisma/db.js';
import { PublicTaskFeedQueryDto } from './dto/public-task-feed-query.dto.js';

const PUBLIC_STATUSES = ['PUBLISHED', 'RECEIVING_APPLICATIONS'] as const;

@Injectable()
export class TaskDiscoveryService {
  async discoverTasks(query: PublicTaskFeedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    let tasks = db.orm.public.Task
      .where((task) => task.status.in([...PUBLIC_STATUSES]))
      .select(
        'id',
        'title',
        'description',
        'type',
        'duration',
        'status',
        'budgetMin',
        'budgetMax',
        'currency',
        'expectedCompletionAt',
        'createdAt',
      )
      .include('category', (category) =>
        category.select('id', 'name'),
      );

    if (query.type) {
      tasks = tasks.where((task) => task.type.eq(query.type!));
    }

    if (query.duration) {
      tasks = tasks.where((task) => task.duration.eq(query.duration!));
    }

    if (query.categoryId) {
      tasks = tasks.where((task) => task.categoryId.eq(query.categoryId!));
    }

    const rows = await tasks
      .orderBy([(task) => task.createdAt.desc(), (task) => task.id.desc()])
      .offset(offset)
      .limit(pageSize + 1)
      .all();

    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);

    return {
      items,
      page,
      pageSize,
      hasMore,
    };
  }
}
