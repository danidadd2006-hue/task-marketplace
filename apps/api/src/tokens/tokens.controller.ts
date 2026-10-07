import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { SpendTokensDto } from './dto/spend-tokens.dto.js';
import { TokensService } from './tokens.service.js';

@Controller('api/v1/tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get('packages')
  getPackages() {
    return this.tokensService.getPackages();
  }

  @Get('wallet')
  @UseGuards(JwtAuthGuard)
  getWallet(@Req() request: { user: AuthenticatedUser }) {
    return this.tokensService.getWallet(request.user.userId);
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  getTransactions(@Req() request: { user: AuthenticatedUser }) {
    return this.tokensService.getTransactions(request.user.userId);
  }

  @Post('spend')
  @UseGuards(JwtAuthGuard)
  spend(
    @Req() request: { user: AuthenticatedUser },
    @Body() body: SpendTokensDto,
  ) {
    return this.tokensService.spend(request.user.userId, body);
  }
}
