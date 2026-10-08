import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TrustSafetyModule } from '../trust-safety/trust-safety.module.js';
import { ReportController } from './report.controller.js';
import { ReportService } from './report.service.js';

@Module({
  imports: [AuthModule, TrustSafetyModule],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
