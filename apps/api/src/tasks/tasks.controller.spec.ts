import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { Roles } from '../auth/roles.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TasksController } from './tasks.controller.js';

describe('TasksController lifecycle endpoints', () => {
  it('protects lifecycle endpoints with JWT and effective-role guards', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TasksController) as unknown[];

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('requires the CLIENT effective role for lifecycle operations', () => {
    const roleMetadata = Reflect.getMetadata('roles', TasksController);

    expect(roleMetadata).toEqual(['CLIENT']);
  });

  it('publishes and opens applications through fixed server-side transitions', async () => {
    const lifecycle = {
      transition: vi.fn()
        .mockResolvedValueOnce({ status: 'PUBLISHED' })
        .mockResolvedValueOnce({ status: 'RECEIVING_APPLICATIONS' }),
    };
    const controller = new TasksController({} as never, lifecycle as never);
    const request = { user: { userId: 'client-id', email: 'client@example.com', roles: ['CLIENT'] as const } };

    await controller.publishTask(request, 'task-id');
    await controller.openApplications(request, 'task-id');

    expect(lifecycle.transition).toHaveBeenNthCalledWith(1, request.user, 'task-id', 'PUBLISHED');
    expect(lifecycle.transition).toHaveBeenNthCalledWith(2, request.user, 'task-id', 'RECEIVING_APPLICATIONS');
  });
});
