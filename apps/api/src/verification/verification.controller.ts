import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AdminVerificationDecisionDto, RevokeVerificationDto } from './dto/admin-decision.dto.js';
import { CreateVerificationDto } from './dto/create-verification.dto.js';
import { VerifyChallengeDto } from './dto/challenge.dto.js';
import { AddVerificationEvidenceDto } from './dto/evidence.dto.js';
import { VerificationService } from './verification.service.js';

@Controller('api/v1/verifications')
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Get()
  getMine(@Req() request: { user: AuthenticatedUser }) {
    return this.verificationService.getMyVerifications(request.user);
  }

  @Post()
  create(@Req() request: { user: AuthenticatedUser }, @Body() dto: CreateVerificationDto) {
    return this.verificationService.createVerification(request.user, dto);
  }

  @Post(':verificationId/evidence')
  addEvidence(
    @Req() request: { user: AuthenticatedUser },
    @Param('verificationId') verificationId: string,
    @Body() dto: AddVerificationEvidenceDto,
  ) {
    return this.verificationService.addEvidence(request.user, verificationId, dto);
  }

  @Post(':verificationId/challenge')
  issueChallenge(
    @Req() request: { user: AuthenticatedUser },
    @Param('verificationId') verificationId: string,
  ) {
    return this.verificationService.issueChallenge(request.user, verificationId, 'EMAIL');
  }

  @Post(':verificationId/challenge/verify')
  verifyChallenge(
    @Req() request: { user: AuthenticatedUser },
    @Param('verificationId') verificationId: string,
    @Body() dto: VerifyChallengeDto,
  ) {
    return this.verificationService.verifyChallenge(request.user, verificationId, 'EMAIL', dto.challenge);
  }

  @Post(':verificationId/phone-challenge')
  issuePhoneChallenge(
    @Req() request: { user: AuthenticatedUser },
    @Param('verificationId') verificationId: string,
  ) {
    return this.verificationService.issueChallenge(request.user, verificationId, 'PHONE');
  }

  @Post(':verificationId/phone-challenge/verify')
  verifyPhoneChallenge(
    @Req() request: { user: AuthenticatedUser },
    @Param('verificationId') verificationId: string,
    @Body() dto: VerifyChallengeDto,
  ) {
    return this.verificationService.verifyChallenge(request.user, verificationId, 'PHONE', dto.challenge);
  }
}

@Controller('api/v1/admin/verifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class VerificationAdminController {
  constructor(private readonly verificationService: VerificationService) {}

  @Get('pending')
  listPending() {
    return this.verificationService.listPendingAsAdmin();
  }

  @Post(':verificationId/decision')
  decide(
    @Req() request: { user: AuthenticatedUser },
    @Param('verificationId') verificationId: string,
    @Body() dto: AdminVerificationDecisionDto,
  ) {
    return this.verificationService.decideAsAdmin(request.user, verificationId, dto);
  }

  @Post(':verificationId/revoke')
  revoke(
    @Req() request: { user: AuthenticatedUser },
    @Param('verificationId') verificationId: string,
    @Body() dto: RevokeVerificationDto,
  ) {
    return this.verificationService.revokeAsAdmin(request.user, verificationId, dto);
  }
}
