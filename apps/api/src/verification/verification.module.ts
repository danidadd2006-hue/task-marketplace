import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { VerificationAdminController, VerificationController } from './verification.controller.js';
import { VerificationService } from './verification.service.js';

@Module({
  imports: [AuthModule],
  controllers: [VerificationController, VerificationAdminController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
