import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TaskLifecycleService } from './task-lifecycle.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TasksController],
  providers: [TasksService, TaskLifecycleService],
})
export class TasksModule {}
