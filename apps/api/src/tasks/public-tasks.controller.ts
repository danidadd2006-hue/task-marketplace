import { Controller, Get, Query } from '@nestjs/common';
import { PublicTaskFeedQueryDto } from './dto/public-task-feed-query.dto.js';
import { TaskDiscoveryService } from './task-discovery.service.js';

@Controller('api/v1/tasks')
export class PublicTasksController {
  constructor(private readonly taskDiscoveryService: TaskDiscoveryService) {}

  @Get('feed')
  discoverTasks(@Query() query: PublicTaskFeedQueryDto) {
    return this.taskDiscoveryService.discoverTasks(query);
  }
}
