import { Controller, Get, Param, Query } from '@nestjs/common';
import { PublicTaskFeedQueryDto } from './dto/public-task-feed-query.dto.js';
import { PublicTaskDetailsService } from './public-task-details.service.js';
import { TaskDiscoveryService } from './task-discovery.service.js';

@Controller('api/v1/tasks')
export class PublicTasksController {
  constructor(
    private readonly taskDiscoveryService: TaskDiscoveryService,
    private readonly publicTaskDetailsService: PublicTaskDetailsService,
  ) {}

  @Get('feed')
  discoverTasks(@Query() query: PublicTaskFeedQueryDto) {
    return this.taskDiscoveryService.discoverTasks(query);
  }

  @Get(':taskId')
  getTaskDetails(@Param('taskId') taskId: string) {
    return this.publicTaskDetailsService.getTaskDetails(taskId);
  }
}
