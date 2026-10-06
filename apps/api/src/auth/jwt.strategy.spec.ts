import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFirst: vi.fn(),
  roleAssignmentsAll: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        User: { where: vi.fn(() => ({ first: mocks.userFirst })) },
        UserRoleAssignment: { where: vi.fn(() => ({ all: mocks.roleAssignmentsAll })) },
      },
    },
  },
}));

import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    vi.resetAllMocks();
    strategy = new JwtStrategy();
  });

  it('loads user roles from UserRoleAssignment records', async () => {
    const user = { id: 'user-id', email: 'user@example.com', status: 'ACTIVE' };
    const roles = [
      { id: 'role-1', userId: 'user-id', role: 'CLIENT' },
      { id: 'role-2', userId: 'user-id', role: 'WORKER' },
    ];

    mocks.userFirst.mockResolvedValue(user);
    mocks.roleAssignmentsAll.mockResolvedValue(roles);

    const result = await strategy.validate({ sub: 'user-id', email: 'user@example.com' });

    expect(result.roles).toEqual(['CLIENT', 'WORKER']);
  });

  it('uses database roles rather than role data supplied in the JWT payload', async () => {
    const user = { id: 'user-id', email: 'user@example.com', status: 'ACTIVE' };
    mocks.userFirst.mockResolvedValue(user);
    mocks.roleAssignmentsAll.mockResolvedValue([{ id: 'role-1', userId: 'user-id', role: 'WORKER' }]);

    const result = await strategy.validate({
      sub: 'user-id',
      email: 'user@example.com',
      roles: ['ADMIN'],
    } as never);

    expect(result.roles).toEqual(['WORKER']);
  });

  it('preserves multiple role assignments (CLIENT + WORKER)', async () => {
    const user = { id: 'user-id', email: 'user@example.com', status: 'ACTIVE' };
    const roles = [
      { id: 'role-1', userId: 'user-id', role: 'CLIENT' },
      { id: 'role-2', userId: 'user-id', role: 'WORKER' },
    ];

    mocks.userFirst.mockResolvedValue(user);
    mocks.roleAssignmentsAll.mockResolvedValue(roles);

    const result = await strategy.validate({ sub: 'user-id', email: 'user@example.com' });

    expect(result).toEqual({
      userId: 'user-id',
      email: 'user@example.com',
      roles: ['CLIENT', 'WORKER'],
    });
  });

  it('rejects non-ACTIVE users with ForbiddenException', async () => {
    const user = { id: 'user-id', email: 'user@example.com', status: 'SUSPENDED' };

    mocks.userFirst.mockResolvedValue(user);

    await expect(strategy.validate({ sub: 'user-id', email: 'user@example.com' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects BANNED users', async () => {
    const user = { id: 'user-id', email: 'user@example.com', status: 'BANNED' };

    mocks.userFirst.mockResolvedValue(user);

    await expect(strategy.validate({ sub: 'user-id', email: 'user@example.com' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects DELETED users', async () => {
    const user = { id: 'user-id', email: 'user@example.com', status: 'DELETED' };

    mocks.userFirst.mockResolvedValue(user);

    await expect(strategy.validate({ sub: 'user-id', email: 'user@example.com' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects missing users with UnauthorizedException', async () => {
    mocks.userFirst.mockResolvedValue(null);

    await expect(strategy.validate({ sub: 'nonexistent', email: 'nope@example.com' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns AuthenticatedUser with all required fields', async () => {
    const user = { id: 'user-id', email: 'user@example.com', status: 'ACTIVE' };
    const roles = [{ id: 'role-1', userId: 'user-id', role: 'CLIENT' }];

    mocks.userFirst.mockResolvedValue(user);
    mocks.roleAssignmentsAll.mockResolvedValue(roles);

    const result = await strategy.validate({ sub: 'user-id', email: 'user@example.com' });

    expect(result).toHaveProperty('userId');
    expect(result).toHaveProperty('email');
    expect(result).toHaveProperty('roles');
    expect(Array.isArray(result.roles)).toBe(true);
  });

  it('handles empty role assignments (no roles assigned)', async () => {
    const user = { id: 'user-id', email: 'user@example.com', status: 'ACTIVE' };

    mocks.userFirst.mockResolvedValue(user);
    mocks.roleAssignmentsAll.mockResolvedValue([]);

    const result = await strategy.validate({ sub: 'user-id', email: 'user@example.com' });

    expect(result.roles).toEqual([]);
  });
});
