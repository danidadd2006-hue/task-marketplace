import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFirst: vi.fn(),
  assignmentFirst: vi.fn(),
  assignmentAll: vi.fn(),
  actorRoleAll: vi.fn(),
  assignmentCreate: vi.fn(),
  assignmentDelete: vi.fn(),
  auditCreate: vi.fn(),
  walletFirst: vi.fn(),
  walletCreate: vi.fn(),
  tokenCreate: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: { transaction: mocks.transaction },
}));

import { RoleAssignmentService } from './role-assignment.service.js';

function tx() {
  return {
    orm: { public: {
      User: { where: vi.fn(() => ({ first: mocks.userFirst })) },
      UserRoleAssignment: {
        where: vi.fn((query) => query?.userId === 'admin-id'
          ? { all: mocks.actorRoleAll }
          : { first: mocks.assignmentFirst, all: mocks.assignmentAll, delete: mocks.assignmentDelete }),
        create: mocks.assignmentCreate,
      },
      AuditLog: { create: mocks.auditCreate },
      TokenWallet: { where: vi.fn(() => ({ first: mocks.walletFirst })), create: mocks.walletCreate },
      TokenTransaction: { create: mocks.tokenCreate },
    } },
  } as any;
}

describe('RoleAssignmentService — Phase 6 Step 6.7', () => {
  const service = new RoleAssignmentService();
  const adminId = 'admin-id';
  const targetId = 'target-id';

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.userFirst.mockImplementation(async (query?: any) => query?.id === adminId
      ? { id: adminId, status: 'ACTIVE' }
      : { id: targetId, status: 'ACTIVE' });
    mocks.assignmentFirst.mockResolvedValue(undefined);
    mocks.actorRoleAll.mockResolvedValue([{ role: 'ADMIN' }]);
    mocks.assignmentAll.mockResolvedValue([{ id: 'client-assignment', role: 'CLIENT' }]);
    mocks.assignmentCreate.mockResolvedValue({ id: 'assignment-id', userId: targetId, role: 'ADMIN', assignedBy: adminId });
    mocks.assignmentDelete.mockResolvedValue(1);
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
    mocks.walletFirst.mockResolvedValue({ id: 'wallet-id', userId: targetId, balance: 100 });
    mocks.walletCreate.mockResolvedValue({ id: 'wallet-id', userId: targetId, balance: 100 });
    mocks.tokenCreate.mockResolvedValue({ id: 'token-id' });
  });

  it('enforces ADMIN authorisation at the service boundary', async () => {
    mocks.actorRoleAll.mockResolvedValue([{ role: 'CLIENT' }]);
    await expect(service.assign(adminId, targetId, 'WORKER')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(adminId, targetId, 'WORKER')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an authorised administrator to grant ADMIN without self-escalation', async () => {
    await service.assign(adminId, targetId, 'ADMIN');
    expect(mocks.assignmentCreate).toHaveBeenCalledWith({
      userId: targetId,
      role: 'ADMIN',
      assignedBy: adminId,
    });
  });

  it('supports CLIENT and WORKER role coexistence and preserves the worker token grant path', async () => {
    mocks.assignmentCreate
      .mockResolvedValueOnce({ id: 'client-role', userId: targetId, role: 'CLIENT', assignedBy: adminId })
      .mockResolvedValueOnce({ id: 'worker-role', userId: targetId, role: 'WORKER', assignedBy: adminId });
    mocks.walletFirst.mockResolvedValueOnce(undefined);

    await service.assign(adminId, targetId, 'CLIENT');
    await service.assign(adminId, targetId, 'WORKER');

    expect(mocks.assignmentCreate).toHaveBeenNthCalledWith(1, { userId: targetId, role: 'CLIENT', assignedBy: adminId });
    expect(mocks.assignmentCreate).toHaveBeenNthCalledWith(2, { userId: targetId, role: 'WORKER', assignedBy: adminId });
    expect(mocks.walletCreate).toHaveBeenCalledWith({ userId: targetId, balance: 100 });
    expect(mocks.tokenCreate).toHaveBeenCalledWith(expect.objectContaining({ type: 'GRANT', amount: 100 }));
  });

  it('rejects self-assignment and self-removal', async () => {
    await expect(service.assign(adminId, adminId, 'ADMIN')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.remove(adminId, adminId, 'ADMIN')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing targets and duplicate assignments', async () => {
    mocks.userFirst.mockResolvedValueOnce({ id: adminId, status: 'ACTIVE' }).mockResolvedValueOnce(undefined);
    await expect(service.assign(adminId, 'missing', 'WORKER')).rejects.toBeInstanceOf(NotFoundException);

    mocks.userFirst.mockImplementation(async (query?: any) => query?.id === adminId
      ? { id: adminId, status: 'ACTIVE' }
      : { id: targetId, status: 'ACTIVE' });
    mocks.assignmentFirst.mockResolvedValue({ id: 'existing', role: 'WORKER' });
    await expect(service.assign(adminId, targetId, 'WORKER')).rejects.toBeInstanceOf(ConflictException);
  });

  it('removes roles transactionally and records an administrative audit event', async () => {
    mocks.assignmentAll.mockResolvedValue([
      { id: 'client-role', role: 'CLIENT' },
      { id: 'worker-role', role: 'WORKER' },
    ]);

    await service.remove(adminId, targetId, 'WORKER');

    expect(mocks.assignmentDelete).toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: adminId,
      action: 'ADMIN_ACTION',
      entityType: 'UserRoleAssignment',
      entityId: 'worker-role',
    }));
  });

  it('rejects removing the final role', async () => {
    mocks.assignmentAll.mockResolvedValue([{ id: 'only-role', role: 'CLIENT' }]);
    await expect(service.remove(adminId, targetId, 'CLIENT')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid roles', async () => {
    await expect(service.assign(adminId, targetId, 'ROOT' as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
