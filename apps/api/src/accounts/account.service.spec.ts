import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFirst: vi.fn(),
  userUpdate: vi.fn(),
  tokenUpdate: vi.fn(),
  transaction: vi.fn(),
  where: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: { transaction: mocks.transaction },
}));

import { AccountService } from './account.service.js';

describe('AccountService.changeStatus', () => {
  const service = new AccountService();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('successfully transitions ACTIVE user to SUSPENDED and revokes active tokens', async () => {
    const user = { id: 'user-id', status: 'ACTIVE' };
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({
        orm: { public: {
          User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(user), update: mocks.userUpdate })) },
          RefreshToken: { where: vi.fn(() => ({ update: mocks.tokenUpdate })) },
        } },
      }),
    );
    await service.changeStatus('user-id', 'SUSPENDED');
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.userUpdate).toHaveBeenCalledWith({ status: 'SUSPENDED' });
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(expect.objectContaining({ revokedAt: expect.any(String) }));
  });

  it('successfully transitions ACTIVE user to BANNED', async () => {
    const user = { id: 'user-id', status: 'ACTIVE' };
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({ orm: { public: {
        User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(user), update: mocks.userUpdate })) },
        RefreshToken: { where: vi.fn(() => ({ update: mocks.tokenUpdate })) },
      } } }),
    );
    await service.changeStatus('user-id', 'BANNED');
    expect(mocks.userUpdate).toHaveBeenCalledWith({ status: 'BANNED' });
  });

  it('successfully transitions ACTIVE user to DELETED', async () => {
    const user = { id: 'user-id', status: 'ACTIVE' };
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({ orm: { public: {
        User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(user), update: mocks.userUpdate })) },
        RefreshToken: { where: vi.fn(() => ({ update: mocks.tokenUpdate })) },
      } } }),
    );
    await service.changeStatus('user-id', 'DELETED');
    expect(mocks.userUpdate).toHaveBeenCalledWith({ status: 'DELETED' });
  });

  it('revokes only active (non-revoked) refresh tokens during status change', async () => {
    const user = { id: 'user-id', status: 'ACTIVE' };
    const whereChain = vi.fn(() => ({ update: mocks.tokenUpdate }));
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({ orm: { public: {
        User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(user), update: mocks.userUpdate })) },
        RefreshToken: { where: whereChain },
      } } }),
    );
    await service.changeStatus('user-id', 'SUSPENDED');
    expect(whereChain).toHaveBeenCalledWith({ userId: 'user-id', revokedAt: null });
    expect(mocks.tokenUpdate).toHaveBeenCalled();
  });

  it('rejects status change when user is already non-ACTIVE', async () => {
    const user = { id: 'user-id', status: 'SUSPENDED' };
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({ orm: { public: {
        User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(user) })) },
      } } }),
    );
    await expect(service.changeStatus('user-id', 'BANNED')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects status change when user does not exist', async () => {
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({ orm: { public: {
        User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(undefined) })) },
      } } }),
    );
    await expect(service.changeStatus('nonexistent-user', 'SUSPENDED')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maintains transactional integrity: if token update fails, status change rolls back', async () => {
    const user = { id: 'user-id', status: 'ACTIVE' };
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({ orm: { public: {
        User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(user), update: mocks.userUpdate })) },
        RefreshToken: { where: vi.fn(() => ({ update: vi.fn().mockRejectedValue(new Error('token update failed')) })) },
      } } }),
    );
    await expect(service.changeStatus('user-id', 'SUSPENDED')).rejects.toThrow('token update failed');
  });

  it('uses a transaction when changing status and revoking tokens', async () => {
    const user = { id: 'user-id', status: 'ACTIVE' };
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({ orm: { public: {
        User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(user), update: mocks.userUpdate })) },
        RefreshToken: { where: vi.fn(() => ({ update: mocks.tokenUpdate })) },
      } } }),
    );
    await service.changeStatus('user-id', 'SUSPENDED');
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
