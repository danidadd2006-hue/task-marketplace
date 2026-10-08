import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TrustSafetyModule } from '../trust-safety/trust-safety.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

@Module({
  imports: [AuthModule, TrustSafetyModule],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
