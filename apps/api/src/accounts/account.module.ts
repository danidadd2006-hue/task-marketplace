import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
@Module({ controllers: [AccountController], providers: [AccountService, RolesGuard] })
export class AccountModule {}
