import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { PaymentFundingService } from './payment-funding.service.js';

@Controller('api/v1/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CLIENT')
export class PaymentFundingController {
  constructor(
    private readonly paymentFundingService: PaymentFundingService,
  ) {}

  @Post(':taskId/fund')
  initiateFunding(
    @Req() request: { user: AuthenticatedUser },
    @Param('taskId') taskId: string,
  ) {
    return this.paymentFundingService.initiateFunding(request.user, taskId);
  }
}
