import { describe, expect, it } from 'vitest';

import { AuthController } from './auth.controller.js';

describe('AuthController.getMe', () => {
  const service = {} as any;
  const controller = new AuthController(service);

  it('returns the authenticated user contract without sensitive fields', () => {
    const result = controller.getMe({
      user: {
        userId: 'user-id',
        email: 'user@example.com',
        roles: ['CLIENT', 'WORKER'],
        status: 'ACTIVE',
      },
    });

    expect(result).toEqual({
      userId: 'user-id',
      email: 'user@example.com',
      roles: ['CLIENT', 'WORKER'],
      status: 'ACTIVE',
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).not.toHaveProperty('secret');
  });

  it('preserves an authoritative ADMIN role when supplied by JwtStrategy', () => {
    const result = controller.getMe({
      user: {
        userId: 'admin-id',
        email: 'admin@example.com',
        roles: ['CLIENT', 'ADMIN'],
        status: 'ACTIVE',
      },
    });

    expect(result.roles).toEqual(['CLIENT', 'ADMIN']);
  });

  it('does not manufacture ADMIN for a non-admin authenticated user', () => {
    const result = controller.getMe({
      user: {
        userId: 'client-id',
        email: 'client@example.com',
        roles: ['CLIENT'],
        status: 'ACTIVE',
      },
    });

    expect(result.roles).toEqual(['CLIENT']);
    expect(result.roles).not.toContain('ADMIN');
  });
});
