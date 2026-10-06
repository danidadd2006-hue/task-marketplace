import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TaskCancellationService } from './task-cancellation.service.js';

class CancelTaskBody {
  refundRequested?: boolean;
}

@Controller('api/v1/tasks')
@UseGuards(JwtAuthGuard)
export class TaskCancellationController {
  constructor(
    private readonly cancellationService: TaskCancellationService,
  ) {}

  @Post(':taskId/cancel')
  cancelTask(
    @Req() request: { user: AuthenticatedUser },
    @Param('taskId') taskId: string,
    @Body() body: CancelTaskBody,
  ) {
    return this.cancellationService.cancelTask(request.user, taskId, {
      refundRequested: body?.refundRequested,
    });
  }
}
