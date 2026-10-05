import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TaskApplicationsController } from './task-applications.controller.js';

describe('TaskApplicationsController', () => {
  it('requires JWT and the effective-role guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TaskApplicationsController) as unknown[];

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('requires the effective WORKER role', () => {
    expect(Reflect.getMetadata('roles', TaskApplicationsController)).toEqual(['WORKER']);
  });

  it('takes the applicant from the authenticated request user', async () => {
    const applicationService = {
      submitApplication: vi.fn().mockResolvedValue({ id: 'application-id' }),
    };
    const controller = new TaskApplicationsController(applicationService as never);
    const request = {
      user: {
        userId: 'worker-id',
        email: 'worker@example.com',
        roles: ['WORKER'] as const,
      },
    };
    const body = { proposedPrice: 50 };

    await controller.submitApplication(request, 'task-id', body as never);

    expect(applicationService.submitApplication).toHaveBeenCalledWith(
      request.user,
      'task-id',
      body,
    );
  });
});
