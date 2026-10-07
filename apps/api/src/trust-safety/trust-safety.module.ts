import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { TrustSafetyService } from './trust-safety.service.js';

@Module({
  imports: [AuditModule],
  providers: [TrustSafetyService],
  exports: [TrustSafetyService],
})
export class TrustSafetyModule {}
