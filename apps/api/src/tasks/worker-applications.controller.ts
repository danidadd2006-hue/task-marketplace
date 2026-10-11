import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { WorkerApplicationHistoryQueryDto } from './dto/worker-application-history-query.dto.js';
import { WorkerApplicationHistoryService } from './worker-application-history.service.js';

@Controller('api/v1/applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WORKER')
export class WorkerApplicationsController {
  constructor(private readonly applicationHistoryService: WorkerApplicationHistoryService) {}

  @Get('me')
  listOwnApplications(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: WorkerApplicationHistoryQueryDto,
  ) {
    return this.applicationHistoryService.listOwnApplications(request.user, query);
  }
}
