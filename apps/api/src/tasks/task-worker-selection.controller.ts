import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TaskWorkerSelectionService } from './task-worker-selection.service.js';

@Controller('api/v1/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CLIENT')
export class TaskWorkerSelectionController {
  constructor(
    private readonly taskWorkerSelectionService: TaskWorkerSelectionService,
  ) {}

  @Post(':taskId/applications/:applicationId/select')
  selectWorker(
    @Req() request: { user: AuthenticatedUser },
    @Param('taskId') taskId: string,
    @Param('applicationId') applicationId: string,
  ) {
    return this.taskWorkerSelectionService.selectWorker(
      request.user,
      taskId,
      applicationId,
    );
  }
}
