import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateTokenPurchaseDto } from './dto/create-token-purchase.dto.js';
import { TokensService } from './tokens.service.js';

@Controller('api/v1/tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get('packages')
  getPackages() {
    return this.tokensService.getPackages();
  }

  @Get('wallet')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('WORKER')
  getWallet(@Req() request: { user: AuthenticatedUser }) {
    return this.tokensService.getWallet(request.user);
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('WORKER')
  getTransactions(@Req() request: { user: AuthenticatedUser }) {
    return this.tokensService.getTransactions(request.user);
  }

  @Post('purchases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('WORKER')
  createPurchase(
    @Req() request: { user: AuthenticatedUser },
    @Body() body: CreateTokenPurchaseDto,
  ) {
    return this.tokensService.createPurchase(
      request.user,
      body.packageId,
    );
  }

  @Get('purchases/:purchaseId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('WORKER')
  getPurchase(
    @Req() request: { user: AuthenticatedUser },
    @Param('purchaseId') purchaseId: string,
  ) {
    return this.tokensService.getPurchase(request.user, purchaseId);
  }

  @Post('purchases/:purchaseId/retry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('WORKER')
  retryPurchase(
    @Req() request: { user: AuthenticatedUser },
    @Param('purchaseId') purchaseId: string,
  ) {
    return this.tokensService.initiatePurchase(
      request.user,
      purchaseId,
    );
  }
}
