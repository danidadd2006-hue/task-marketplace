import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TaskCompletionService } from './task-completion.service.js';

@Controller('api/v1/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskCompletionController {
  constructor(private readonly taskCompletionService: TaskCompletionService) {}

  @Post(':taskId/start')
  @Roles('WORKER')
  startWork(@Req() request: { user: AuthenticatedUser }, @Param('taskId') taskId: string) {
    return this.taskCompletionService.startWork(request.user, taskId);
  }

  @Post(':taskId/submit-completion')
  @Roles('WORKER')
  submitCompletion(@Req() request: { user: AuthenticatedUser }, @Param('taskId') taskId: string) {
    return this.taskCompletionService.submitCompletion(request.user, taskId);
  }

  @Post(':taskId/approve-completion')
  @Roles('CLIENT')
  approveCompletion(@Req() request: { user: AuthenticatedUser }, @Param('taskId') taskId: string) {
    return this.taskCompletionService.approveCompletion(request.user, taskId);
  }
}