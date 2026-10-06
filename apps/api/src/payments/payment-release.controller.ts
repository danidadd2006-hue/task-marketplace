import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { PaymentReleaseService } from './payment-release.service.js';

@Controller('api/v1/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CLIENT')
export class PaymentReleaseController {
  constructor(private readonly paymentReleaseService: PaymentReleaseService) {}

  @Post(':paymentId/release')
  releasePayment(
    @Req() request: { user: AuthenticatedUser },
    @Param('paymentId') paymentId: string,
    @Body() body: { payoutDestinationId?: string },
  ) {
    if (!body?.payoutDestinationId) {
      throw new BadRequestException('payoutDestinationId is required');
    }
    return this.paymentReleaseService.releasePayment(request.user, paymentId, body.payoutDestinationId);
  }
}
