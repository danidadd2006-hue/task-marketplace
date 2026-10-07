import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { VerificationAdminController, VerificationController } from './verification.controller.js';

describe('VerificationController', () => {
  it('requires JWT authentication for user verification routes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, VerificationController) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('derives self-service verification from the authenticated user', async () => {
    const service = { createVerification: vi.fn().mockResolvedValue({ id: 'verification-1' }) };
    const controller = new VerificationController(service as never);
    const request = { user: { userId: 'user-1', email: 'user@example.com', roles: ['CLIENT'] as const } };

    await controller.create(request, { type: 'IDENTITY' } as never);

    expect(service.createVerification).toHaveBeenCalledWith(request.user, { type: 'IDENTITY' });
  });
});

describe('VerificationAdminController', () => {
  it('requires JWT and ADMIN role authorization', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, VerificationAdminController) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('uses the authenticated admin as the decision actor', async () => {
    const service = { decideAsAdmin: vi.fn().mockResolvedValue({ id: 'verification-1' }) };
    const controller = new VerificationAdminController(service as never);
    const request = { user: { userId: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] as const } };

    await controller.decide(request, 'verification-1', { status: 'VERIFIED', reason: 'approved' } as never);

    expect(service.decideAsAdmin).toHaveBeenCalledWith(
      request.user,
      'verification-1',
      { status: 'VERIFIED', reason: 'approved' },
    );
  });
});
