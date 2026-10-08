import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TrustSafetyModule } from '../trust-safety/trust-safety.module.js';
import { DisputeController } from './dispute.controller.js';
import { DisputeService } from './dispute.service.js';

@Module({
  imports: [AuthModule, TrustSafetyModule],
  controllers: [DisputeController],
  providers: [DisputeService],
  exports: [DisputeService],
})
export class DisputeModule {}
