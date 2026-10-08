import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFirst: vi.fn(),
  userWhere: vi.fn(),
  userUpdate: vi.fn(),
  tokenUpdate: vi.fn(),
  roleAll: vi.fn(),
  caseCreate: vi.fn(),
  historyCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: { transaction: mocks.transaction },
}));

import { AccountService } from './account.service.js';

const admin = { userId: 'admin-id', email: 'admin@example.com', roles: ['ADMIN'] as const };

function tx() {
  return {
    orm: { public: {
      User: { where: mocks.userWhere },
      UserRoleAssignment: { where: vi.fn(() => ({ all: mocks.roleAll })) },
      RefreshToken: { where: vi.fn(() => ({ update: mocks.tokenUpdate })) },
      TrustCase: { create: mocks.caseCreate },
      TrustCaseHistory: { create: mocks.historyCreate },
      AuditLog: { create: mocks.auditCreate },
    } },
  } as any;
}

describe('AccountService — Phase 6 Step 6.7', () => {
  const trustSafety = { createCaseInTransaction: mocks.caseCreate };
  const service = new AccountService({ createCaseInTransaction: mocks.caseCreate } as any);
  let targetUser: any;

  beforeEach(() => {
    vi.resetAllMocks();
    targetUser = { id: 'user-id', status: 'ACTIVE' };
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.userWhere.mockImplementation((query?: any) => ({
      first: vi.fn(async () => query?.id === admin.userId ? { id: admin.userId, status: 'ACTIVE' } : targetUser),
      update: mocks.userUpdate,
    }));
    mocks.userFirst.mockImplementation(async (query?: any) => query?.id === admin.userId
      ? { id: admin.userId, status: 'ACTIVE' }
      : targetUser);
    mocks.roleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.userUpdate.mockResolvedValue(1);
    mocks.tokenUpdate.mockResolvedValue(1);
    mocks.caseCreate.mockResolvedValue({ id: 'case-id' });
    mocks.historyCreate.mockResolvedValue({ id: 'history-id', createdAt: '2026-10-08T00:00:00.000Z' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    void trustSafety;
  });

  it('requires a live ADMIN actor at the service boundary', async () => {
    mocks.roleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.changeStatus(admin, 'user-id', 'SUSPENDED', 'Policy breach')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('suspends an ACTIVE account, revokes refresh tokens and records case history', async () => {
    const result = await service.changeStatus(admin, 'user-id', 'SUSPENDED', 'Repeated policy violations');

    expect(result).toMatchObject({
      userId: 'user-id',
      previousStatus: 'ACTIVE',
      status: 'SUSPENDED',
      caseId: 'case-id',
    });
    expect(mocks.caseCreate).toHaveBeenCalledWith(expect.anything(), admin, expect.objectContaining({
      type: 'MODERATION',
      subjectType: 'USER',
      subjectId: 'user-id',
    }));
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUSPENDED' }));
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(expect.objectContaining({ revokedAt: expect.any(String) }));
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ACTION_APPLIED',
      reason: 'Repeated policy violations',
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-id',
      action: 'ADMIN_ACTION',
      entityType: 'User',
      entityId: 'user-id',
    }));
  });

  it('bans an ACTIVE account with the authenticated actor and explicit reason', async () => {
    await service.changeStatus(admin, 'user-id', 'BANNED', 'Severe marketplace abuse');
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'BANNED' }));
    expect(JSON.stringify(mocks.auditCreate.mock.calls[0][0])).toContain('Severe marketplace abuse');
  });

  it('deletes only an ACTIVE account and preserves irreversible DELETED semantics', async () => {
    await service.changeStatus(admin, 'user-id', 'DELETED', 'Account deletion enforcement');
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'DELETED' }));

    targetUser = { id: 'user-id', status: 'DELETED' };
    await expect(service.changeStatus(admin, 'user-id', 'ACTIVE', 'Attempted restoration'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('restores a suspended account without unrevoking historical refresh tokens', async () => {
    targetUser = { id: 'user-id', status: 'SUSPENDED' };

    const result = await service.changeStatus(admin, 'user-id', 'ACTIVE', 'Successful appeal review');

    expect(result).toMatchObject({ previousStatus: 'SUSPENDED', status: 'ACTIVE' });
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Successful appeal review' }));
  });

  it('restores a banned account through the same controlled path', async () => {
    targetUser = { id: 'user-id', status: 'BANNED' };
    await expect(service.changeStatus(admin, 'user-id', 'ACTIVE', 'Ban reversal after review')).resolves.toMatchObject({
      previousStatus: 'BANNED',
      status: 'ACTIVE',
    });
  });

  it('rejects self-enforcement and missing targets', async () => {
    await expect(service.changeStatus({ ...admin, userId: 'user-id' }, 'user-id', 'SUSPENDED', 'Reason'))
      .rejects.toBeInstanceOf(BadRequestException);

    targetUser = undefined;
    await expect(service.changeStatus(admin, 'missing', 'SUSPENDED', 'Reason'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects illegal lifecycle changes and empty reasons', async () => {
    await expect(service.changeStatus(admin, 'user-id', 'SUSPENDED', '   '))
      .rejects.toBeInstanceOf(BadRequestException);

    targetUser = { id: 'user-id', status: 'BANNED' };
    await expect(service.changeStatus(admin, 'user-id', 'SUSPENDED', 'Reason'))
      .rejects.toBeInstanceOf(BadRequestException);

    targetUser = { id: 'user-id', status: 'ACTIVE' };
    await expect(service.changeStatus(admin, 'user-id', 'ACTIVE', 'Reason'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('maintains transaction integrity when refresh-token revocation fails', async () => {
    mocks.tokenUpdate.mockRejectedValue(new Error('token revoke failed'));
    await expect(service.changeStatus(admin, 'user-id', 'SUSPENDED', 'Policy breach'))
      .rejects.toThrow('token revoke failed');
  });
});
