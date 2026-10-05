import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ userUpdate: vi.fn(), tokenUpdate: vi.fn(), transaction: vi.fn() }));
vi.mock('../prisma/db.js', () => ({ db: { transaction: mocks.transaction } }));
import { AccountService } from './account.service.js';
describe('AccountService.changeStatus', () => {
  const service = new AccountService();
  beforeEach(() => vi.resetAllMocks());
  const setup = (status = 'ACTIVE') => {
    const userWhere = vi.fn(() => ({ first: vi.fn().mockResolvedValue({ id: 'user-id', status }), update: mocks.userUpdate }));
    const tokenWhere = vi.fn(() => ({ update: mocks.tokenUpdate }));
    mocks.transaction.mockImplementationOnce(async (callback) => callback({ orm: { public: { User: { where: userWhere }, RefreshToken: { where: tokenWhere } } } }));
    return { tokenWhere };
  };
  it.each(['SUSPENDED', 'BANNED', 'DELETED'])('transitions ACTIVE user to %s and revokes active refresh tokens', async (status) => {
    const { tokenWhere } = setup();
    await service.changeStatus('user-id', status as 'SUSPENDED' | 'BANNED' | 'DELETED');
    expect(mocks.userUpdate).toHaveBeenCalledWith({ status });
    expect(tokenWhere).toHaveBeenCalledWith({ userId: 'user-id', revokedAt: null });
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(expect.objectContaining({ revokedAt: expect.any(String) }));
  });
  it('uses one transaction for status and token revocation', async () => { setup(); await service.changeStatus('user-id', 'SUSPENDED'); expect(mocks.transaction).toHaveBeenCalledOnce(); });
  it('rejects a non-existent user', async () => {
    mocks.transaction.mockImplementationOnce(async (callback) => callback({ orm: { public: { User: { where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(undefined) })) } } } }));
    await expect(service.changeStatus('missing', 'SUSPENDED')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects a user that is already non-ACTIVE', async () => { setup('SUSPENDED'); await expect(service.changeStatus('user-id', 'BANNED')).rejects.toBeInstanceOf(BadRequestException); expect(mocks.userUpdate).not.toHaveBeenCalled(); });
});