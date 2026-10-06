import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateTaskApplicationDto } from './dto/create-task-application.dto.js';
import { TaskApplicationService } from './task-application.service.js';

@Controller('api/v1/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WORKER')
export class TaskApplicationsController {
  constructor(private readonly taskApplicationService: TaskApplicationService) {}

  @Post(':taskId/applications')
  submitApplication(
    @Req() request: { user: AuthenticatedUser },
    @Param('taskId') taskId: string,
    @Body() body: CreateTaskApplicationDto,
  ) {
    return this.taskApplicationService.submitApplication(request.user, taskId, body);
  }
}
