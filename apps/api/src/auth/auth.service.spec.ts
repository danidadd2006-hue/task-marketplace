import { UnauthorizedException } from '@nestjs/common';
import { describe, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), first: vi.fn(), userFirst: vi.fn(), tokenCreate: vi.fn(), execute: vi.fn(), update: vi.fn(), where: vi.fn(), build: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({ db: { transaction: mocks.transaction } }));
import { AuthService } from './auth.service.js';

const source = { id: 'source-id', userId: 'user-id', tokenHash: 'hash', expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null };
const user = { id: 'user-id', email: 'user@example.com', status: 'ACTIVE' };

describe('AuthService.refresh', () => {
  const jwt = { signAsync: vi.fn().mockResolvedValue('access-token') };
  const service = new AuthService(jwt as never);

  beforeEach(() => {
    vi.resetAllMocks();
    jwt.signAsync.mockResolvedValue('access-token');
    mocks.first.mockResolvedValue(source);
    mocks.userFirst.mockResolvedValue(user);
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.where.mockReturnValue({ where: mocks.where, build: mocks.build });
    mocks.build.mockReturnValue({});
    mocks.update.mockReturnValue({ where: mocks.where });
    mocks.transaction.mockImplementation(async (callback) => callback({
      orm: { public: { RefreshToken: { where: vi.fn(() => ({ first: mocks.first })), create: mocks.tokenCreate }, User: { where: vi.fn(() => ({ first: mocks.userFirst })) } } },
      sql: { public: { refreshToken: { update: mocks.update } } }, execute: mocks.execute,
    }));
  });

  it('revokes the source and creates one replacement within a transaction', async () => {
    const result = await service.refresh('source-token');
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.tokenCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: user.id, revokedAt: null }));
    expect(result.accessToken).toBe('access-token');
  });

  it('rejects a reused source token when conditional revocation affects no row', async () => {
    mocks.execute.mockResolvedValueOnce({ affectedRows: 0 });
    await expect(service.refresh('source-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['revoked', { ...source, revokedAt: '2026-01-01T00:00:00.000Z' }],
    ['expired', { ...source, expiresAt: '2000-01-01T00:00:00.000Z' }],
  ])('rejects a %s source token without creating a replacement', async (_name, token) => {
    mocks.first.mockResolvedValueOnce(token);
    await expect(service.refresh('source-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-ACTIVE user during refresh', async () => {
    mocks.userFirst.mockResolvedValueOnce({ ...user, status: 'SUSPENDED' });
    await expect(service.refresh('source-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
  });

  it('rolls back when replacement creation fails', async () => {
    mocks.tokenCreate.mockRejectedValueOnce(new Error('insert failed'));
    await expect(service.refresh('source-token')).rejects.toThrow('insert failed');
  });
});

describe('AuthService.register and login', () => {
  const jwt = { signAsync: vi.fn().mockResolvedValue('access-token') };
  const service = new AuthService(jwt as never);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(service, 'hashPassword').mockResolvedValue('hashed-password');
    vi.spyOn(service, 'verifyPassword').mockResolvedValue(true);
    jwt.signAsync.mockResolvedValue('access-token');
    mocks.userFirst.mockResolvedValue({ ...user, passwordHash: 'hash' });
    mocks.transaction.mockImplementation(async (callback) => callback({
      orm: { public: {
        User: { create: vi.fn().mockResolvedValue({ id: 'new-user', email: 'new@example.com' }) },
        UserRoleAssignment: { create: mocks.tokenCreate },
        RefreshToken: { create: mocks.tokenCreate },
      } },
    }));
  });

  it('registers new users with an initial CLIENT role assignment', async () => {
    await service.register('new@example.com', 'password');
    expect(mocks.tokenCreate).toHaveBeenCalledWith({
      userId: 'new-user', role: 'CLIENT', assignedBy: 'new-user',
    });
  });

  it.each(['SUSPENDED', 'BANNED', 'DELETED'])('rejects %s users at login before password verification', async (status) => {
    mocks.userFirst.mockResolvedValue({ ...user, passwordHash: 'hash', status });
    await expect(service.login('user@example.com', 'password')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.verifyPassword).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('allows an ACTIVE user to log in', async () => {
    const result = await service.login('user@example.com', 'password');
    expect(result.user).toEqual({ id: user.id, email: user.email });
    expect(jwt.signAsync).toHaveBeenCalled();
  });
});
