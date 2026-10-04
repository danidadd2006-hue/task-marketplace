import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  controllers: [TasksController],
  providers: [TasksService, RolesGuard],
})
export class TasksModule {}
