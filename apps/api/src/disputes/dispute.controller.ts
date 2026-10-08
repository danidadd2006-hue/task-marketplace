import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { DisputeService, DISPUTE_CATEGORIES, DISPUTE_REASONS, DISPUTE_STATUSES } from './dispute.service.js';

@Controller('/api/v1/disputes')
@UseGuards(JwtAuthGuard)
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Post()
  create(@Req() req: { user: AuthenticatedUser }, @Body() body: any) {
    return this.disputes.createDispute(req.user, body);
  }

  @Get(':disputeId')
  get(@Req() req: { user: AuthenticatedUser }, @Param('disputeId') disputeId: string) {
    return this.disputes.getDispute(req.user, disputeId);
  }

  @Post(':disputeId/evidence')
  addEvidence(@Req() req: { user: AuthenticatedUser }, @Param('disputeId') disputeId: string, @Body() body: any) {
    return this.disputes.addEvidence(req.user, disputeId, body);
  }

  @Post(':disputeId/advance')
  advance(@Req() req: { user: AuthenticatedUser }, @Param('disputeId') disputeId: string, @Body() body: { status: string }) {
    return this.disputes.advanceForParticipant(req.user, disputeId, body.status as any);
  }

  static taxonomy() {
    return { statuses: DISPUTE_STATUSES, categories: DISPUTE_CATEGORIES, reasons: DISPUTE_REASONS };
  }
}
