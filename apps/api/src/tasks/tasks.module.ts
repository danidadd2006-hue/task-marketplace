import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PublicTasksController } from './public-tasks.controller.js';
import { TaskDiscoveryService } from './task-discovery.service.js';
import { TaskLifecycleService } from './task-lifecycle.service.js';
import { TaskApplicationService } from './task-application.service.js';
import { TaskApplicationsController } from './task-applications.controller.js';
import { TaskWorkerSelectionService } from './task-worker-selection.service.js';
import { TaskWorkerSelectionController } from './task-worker-selection.controller.js';
import { TaskCompletionService } from './task-completion.service.js';
import { TaskCompletionController } from './task-completion.controller.js';
import { TaskCancellationService } from './task-cancellation.service.js';
import { TaskCancellationController } from './task-cancellation.controller.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [
    TasksController,
    PublicTasksController,
    TaskApplicationsController,
    TaskWorkerSelectionController,
    TaskCompletionController,
    TaskCancellationController,
  ],
  providers: [
    TasksService,
    TaskLifecycleService,
    TaskDiscoveryService,
    TaskApplicationService,
    TaskWorkerSelectionService,
    TaskCompletionService,
    TaskCancellationService,
  ],
})
export class TasksModule {}
