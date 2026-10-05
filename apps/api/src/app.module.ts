import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ProfileService } from './profile.service.js';
import { ProfileController } from './profile.controller.js';
import { TasksModule } from './tasks/tasks.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AccountModule } from './accounts/account.module.js';

@Module({
  imports: [AuditModule, AuthModule, AccountModule, TasksModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class AppModule {}
