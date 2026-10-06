import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AccountService, NonActiveStatus } from './account.service.js';

class ChangeAccountStatusDto { @IsIn(['SUSPENDED', 'BANNED', 'DELETED']) status!: NonActiveStatus; }

@Controller('api/v1/accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}
  @Patch(':userId/status') changeStatus(@Param('userId') userId: string, @Body() dto: ChangeAccountStatusDto) { return this.accounts.changeStatus(userId, dto.status); }
}
