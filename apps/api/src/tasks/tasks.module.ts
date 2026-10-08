import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PublicTasksController } from './public-tasks.controller.js';
import { PublicTaskDetailsService } from './public-task-details.service.js';
import { TaskDiscoveryService } from './task-discovery.service.js';
import { TaskLifecycleService } from './task-lifecycle.service.js';
import { TaskApplicationService } from './task-application.service.js';
import { TaskApplicationsController } from './task-applications.controller.js';
import { TaskWorkerSelectionService } from './task-worker-selection.service.js';
import { TaskWorkerSelectionController } from './task-worker-selection.controller.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    TasksController,
    PublicTasksController,
    TaskApplicationsController,
    TaskWorkerSelectionController,
  ],
  providers: [
    TasksService,
    TaskLifecycleService,
    TaskDiscoveryService,
    PublicTaskDetailsService,
    TaskApplicationService,
    TaskWorkerSelectionService,
  ],
})
export class TasksModule {}
