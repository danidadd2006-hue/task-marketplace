import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ProfileService } from './profile.service.js';
import { ProfileController } from './profile.controller.js';
import { TasksModule } from './tasks/tasks.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AccountModule } from './accounts/account.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { NotificationModule } from './notifications/notification.module.js';
import { ReviewModule } from './reviews/review.module.js';
import { VerificationModule } from './verification/verification.module.js';
import { TrustSafetyModule } from './trust-safety/trust-safety.module.js';
import { ReportModule } from './reports/report.module.js';
import { DisputeModule } from './disputes/dispute.module.js';
import { ModerationModule } from './moderation/moderation.module.js';
import { RiskModule } from './risk/risk.module.js';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    AccountModule,
    TasksModule,
    MessagingModule,
    NotificationModule,
    ReviewModule,
    VerificationModule,
    TrustSafetyModule,
    ReportModule,
    DisputeModule,
    ModerationModule,
    RiskModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class AppModule {}
