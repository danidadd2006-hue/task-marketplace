import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DisputeModule } from '../disputes/dispute.module.js';
import { ModerationController } from './moderation.controller.js';
import { ModerationService } from './moderation.service.js';

@Module({
  imports: [AuthModule, DisputeModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
