import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AccountService, AccountStatus } from './account.service.js';

class ChangeAccountStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'])
  status!: AccountStatus;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;
}

@Controller('api/v1/accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Patch(':userId/status')
  changeStatus(
    @Req() request: { user: AuthenticatedUser },
    @Param('userId') userId: string,
    @Body() dto: ChangeAccountStatusDto,
  ) {
    return this.accounts.changeStatus(request.user, userId, dto.status, dto.reason);
  }
}
