import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TaskWorkerSelectionController } from './task-worker-selection.controller.js';

describe('TaskWorkerSelectionController', () => {
  it('requires JWT and the effective-role guard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TaskWorkerSelectionController,
    ) as unknown[];

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
  });

  it('requires the effective CLIENT role', () => {
    expect(Reflect.getMetadata('roles', TaskWorkerSelectionController)).toEqual([
      'CLIENT',
    ]);
  });

  it('takes the owner from the authenticated request user and does not accept an owner body field', async () => {
    const service = {
      selectWorker: vi.fn().mockResolvedValue({ id: 'contract-id' }),
    };
    const controller = new TaskWorkerSelectionController(service as never);
    const request = {
      user: {
        userId: 'client-id',
        email: 'client@example.com',
        roles: ['CLIENT'] as const,
      },
    };

    await controller.selectWorker(request, 'task-id', 'application-id');

    expect(service.selectWorker).toHaveBeenCalledWith(
      request.user,
      'task-id',
      'application-id',
    );
  });
});
