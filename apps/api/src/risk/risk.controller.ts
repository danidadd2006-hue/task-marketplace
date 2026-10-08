import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateRiskSignalDto } from './dto/risk-signal.dto.js';
import {
  OpenRiskCaseDto,
  RiskAssignmentDto,
  RiskDecisionDto,
  RiskEvidenceDto,
  RiskEnforcementDto,
  RiskNoteDto,
  RiskQueueQueryDto,
  RiskStatusDto,
} from './dto/risk-case.dto.js';
import { RiskService } from './risk.service.js';

@Controller('api/v1/risk')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  @Get('queue')
  queue(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: RiskQueueQueryDto,
  ) {
    return this.risk.listQueue(request.user, query);
  }

  @Post('signals')
  createSignal(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateRiskSignalDto,
  ) {
    return this.risk.recordSignal(request.user, dto);
  }

  @Post('signals/:signalId/investigation')
  openInvestigation(
    @Req() request: { user: AuthenticatedUser },
    @Param('signalId') signalId: string,
    @Body() dto: OpenRiskCaseDto,
  ) {
    return this.risk.openInvestigation(request.user, signalId, dto.reason);
  }

  @Get('cases/:caseId')
  getCase(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
  ) {
    return this.risk.getCase(request.user, caseId);
  }

  @Post('cases/:caseId/evidence')
  addEvidence(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: RiskEvidenceDto,
  ) {
    return this.risk.addEvidence(request.user, caseId, dto);
  }

  @Post('cases/:caseId/assignment')
  assign(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: RiskAssignmentDto,
  ) {
    return this.risk.assign(request.user, caseId, dto.assigneeId, dto.reason);
  }

  @Delete('cases/:caseId/assignment')
  unassign(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: RiskNoteDto,
  ) {
    return this.risk.unassign(request.user, caseId, dto.note);
  }

  @Post('cases/:caseId/notes')
  addNote(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: RiskNoteDto,
  ) {
    return this.risk.addNote(request.user, caseId, dto.note);
  }

  @Post('cases/:caseId/status')
  transition(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: RiskStatusDto,
  ) {
    return this.risk.transition(request.user, caseId, dto.status, dto.reason, dto.resolutionCode);
  }

  @Post('cases/:caseId/decisions')
  decide(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: RiskDecisionDto,
  ) {
    return this.risk.recordDecision(request.user, caseId, dto);
  }

  @Post('cases/:caseId/enforcement')
  enforce(
    @Req() request: { user: AuthenticatedUser },
    @Param('caseId') caseId: string,
    @Body() dto: RiskEnforcementDto,
  ) {
    return this.risk.applyEnforcement(request.user, caseId, dto.actionType, dto.accountStatus, dto.reason);
  }
}
