import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateModerationCaseDto } from './dto/create-moderation-case.dto.js';
import {
  ModerationAssignmentDto,
  ModerationDecisionDto,
  ModerationNoteDto,
  ModerationStatusDto,
  ReportResolutionDto,
} from './dto/moderation-status.dto.js';
import { ModerationQueueQueryDto } from './dto/moderation-queue-query.dto.js';
import { ModerationService } from './moderation.service.js';

@Controller('api/v1/moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('queue')
  queue(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ModerationQueueQueryDto,
  ) {
    return this.moderation.listQueue(request.user, query);
  }

  @Post('cases')
  createCase(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateModerationCaseDto,
  ) {
    return this.moderation.createCase(request.user, dto);
  }

  @Get('cases/:caseId')
  getCase(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
  ) {
    return this.moderation.getCase(request.user, caseId);
  }

  @Get('cases/:caseId/history')
  getHistory(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
  ) {
    return this.moderation.getHistory(request.user, caseId);
  }

  @Get('cases/:caseId/evidence')
  getEvidence(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
  ) {
    return this.moderation.getEvidence(request.user, caseId);
  }

  @Post('cases/:caseId/assignment')
  assign(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: ModerationAssignmentDto,
  ) {
    return this.moderation.assign(request.user, caseId, dto.assigneeId, dto.reason);
  }

  @Delete('cases/:caseId/assignment')
  unassign(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: ModerationNoteDto,
  ) {
    return this.moderation.unassign(request.user, caseId, dto.note);
  }

  @Post('cases/:caseId/notes')
  addNote(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: ModerationNoteDto,
  ) {
    return this.moderation.addNote(request.user, caseId, dto.note);
  }

  @Post('cases/:caseId/decisions')
  recordDecision(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: ModerationDecisionDto,
  ) {
    return this.moderation.recordDecision(request.user, caseId, dto.outcome, dto.reason, dto.metadata);
  }

  @Post('cases/:caseId/status')
  transition(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: ModerationStatusDto,
  ) {
    return this.moderation.transition(request.user, caseId, dto.status, dto.reason);
  }

  @Post('reports/:reportId/resolution')
  resolveReport(
    @Req() request: { user: AuthenticatedUser },
    @Param('reportId') reportId: string,
    @Body() dto: ReportResolutionDto,
  ) {
    return this.moderation.resolveReport(request.user, reportId, dto);
  }

  @Post('disputes/:disputeId/resolution')
  resolveDispute(
    @Req() request: { user: AuthenticatedUser },
    @Param('disputeId') disputeId: string,
    @Body() body: {
      status: 'RESOLVED' | 'REJECTED';
      resolutionCode: string;
      reason: string;
      relatedFinancialActionRef?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.moderation.resolveDispute(request.user, disputeId, body);
  }
}
