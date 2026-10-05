import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PublicTasksController } from './public-tasks.controller.js';
import { TaskDiscoveryService } from './task-discovery.service.js';
import { TaskLifecycleService } from './task-lifecycle.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TasksController, PublicTasksController],
  providers: [TasksService, TaskLifecycleService, TaskDiscoveryService],
})
export class TasksModule {}
