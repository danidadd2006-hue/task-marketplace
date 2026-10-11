import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { WorkerApplicationsController } from './worker-applications.controller.js';

describe('WorkerApplicationsController', () => {
  it('requires JWT authentication and effective-role authorization', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, WorkerApplicationsController) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata('roles', WorkerApplicationsController)).toEqual(['WORKER']);
  });

  it('exposes GET /me and derives worker identity from the authenticated request', async () => {
    const historyService = { listOwnApplications: vi.fn().mockResolvedValue({ items: [] }) };
    const controller = new WorkerApplicationsController(historyService as never);
    const request = {
      user: { userId: 'authenticated-worker', email: 'worker@example.com', roles: ['WORKER'] as const },
    };
    const query = { page: 2, pageSize: 10 };

    await controller.listOwnApplications(request, query);

    expect(Reflect.getMetadata(PATH_METADATA, WorkerApplicationsController.prototype.listOwnApplications)).toBe('me');
    expect(Reflect.getMetadata(METHOD_METADATA, WorkerApplicationsController.prototype.listOwnApplications)).toBe(RequestMethod.GET);
    expect(historyService.listOwnApplications).toHaveBeenCalledWith(request.user, query);
    expect(historyService.listOwnApplications).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'attacker-worker' }),
      query,
    );
  });
});
