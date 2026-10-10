import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TaskLifecycleService } from './task-lifecycle.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { TasksService } from './tasks.service.js';

@Controller('api/v1/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CLIENT')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly lifecycleService: TaskLifecycleService,
  ) {}

  @Post()
  createTask(
    @Req() request: { user: AuthenticatedUser },
    @Body() body: CreateTaskDto,
  ) {
    return this.tasksService.createTask(request.user, body);
  }

  @Post(':taskId/publish')
  publishTask(
    @Req() request: { user: AuthenticatedUser },
    @Param('taskId') taskId: string,
  ) {
    return this.lifecycleService.transition(request.user, taskId, 'PUBLISHED');
  }

  @Post(':taskId/open-applications')
  openApplications(
    @Req() request: { user: AuthenticatedUser },
    @Param('taskId') taskId: string,
  ) {
    return this.lifecycleService.transition(request.user, taskId, 'RECEIVING_APPLICATIONS');
  }
}
