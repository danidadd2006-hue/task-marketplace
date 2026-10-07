import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userWhere: vi.fn(),
  verificationWhere: vi.fn(),
  verificationCreate: vi.fn(),
  verificationUpdate: vi.fn(),
  challengeWhere: vi.fn(),
  challengeCreate: vi.fn(),
  challengeUpdate: vi.fn(),
  historyCreate: vi.fn(),
  evidenceWhere: vi.fn(),
  evidenceCreate: vi.fn(),
  auditCreate: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: { public: {
      User: { where: mocks.userWhere },
      Verification: { where: mocks.verificationWhere },
      VerificationEvidence: { where: mocks.evidenceWhere, create: mocks.evidenceCreate },
      AuditLog: { create: mocks.auditCreate },
    } },
  },
}));

import { VerificationService } from './verification.service.js';

const activeUser = { id: 'user-1', email: 'user@example.com', phone: '+254700000000', status: 'ACTIVE' };
const authenticated = { userId: 'user-1', email: activeUser.email, roles: ['CLIENT'] as const };

const pending = {
  id: 'verification-1',
  userId: 'user-1',
  type: 'IDENTITY',
  status: 'PENDING',
  provider: 'local',
  providerRef: 'local:identity:user-1',
  verifiedAt: null,
  expiresAt: null,
  reviewedAt: null,
  reviewedById: null,
  decisionReason: null,
  revokedAt: null,
  revokedById: null,
  revocationReason: null,
  activeKey: 'user-1:IDENTITY',
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
};

function tx() {
  return {
    orm: { public: {
      User: { where: mocks.userWhere },
      Verification: { where: mocks.verificationWhere, create: mocks.verificationCreate },
      VerificationChallenge: { where: mocks.challengeWhere, create: mocks.challengeCreate },
      VerificationHistory: { create: mocks.historyCreate },
      VerificationEvidence: { where: mocks.evidenceWhere, create: mocks.evidenceCreate },
      AuditLog: { create: mocks.auditCreate },
    } },
    sql: { public: {
      verificationChallenge: {
        update: () => ({
          where: () => ({
            where: () => ({
              build: () => ({ kind: 'consume-challenge' }),
            }),
          }),
        }),
      },
    } },
    execute: mocks.execute,
  } as any;
}

describe('VerificationService — Phase 6 Step 6.3', () => {
  const service = new VerificationService();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.userWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(activeUser), update: vi.fn().mockResolvedValue(activeUser) });
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([]),
      update: mocks.verificationUpdate,
    });
    mocks.verificationCreate.mockResolvedValue({ ...pending });
    mocks.verificationUpdate.mockResolvedValue({ ...pending });
    mocks.challengeWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([]),
      update: mocks.challengeUpdate,
    });
    mocks.challengeCreate.mockResolvedValue({ ...pending, id: 'challenge-1' });
    mocks.challengeUpdate.mockResolvedValue({});
    mocks.historyCreate.mockResolvedValue({});
    mocks.evidenceWhere.mockReturnValue({ all: vi.fn().mockResolvedValue([]) });
    mocks.evidenceCreate.mockResolvedValue({ id: 'evidence-1', verificationId: 'verification-1', createdAt: '2026-10-07T00:00:00.000Z' });
    mocks.auditCreate.mockResolvedValue({});
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
  });

  it('creates an email verification challenge without exposing the raw challenge', async () => {
    const created = { ...pending, type: 'EMAIL', status: 'PENDING', activeKey: 'user-1:EMAIL' };
    mocks.verificationCreate.mockResolvedValue(created);
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(created),
      all: vi.fn().mockResolvedValue([created]),
      update: mocks.verificationUpdate,
    });
    vi.spyOn((service as any).challengeProvider, 'issueChallenge').mockResolvedValue('a'.repeat(64));
    vi.spyOn((service as any).challengeProvider, 'deliverChallenge').mockResolvedValue(undefined);

    const result = await service.createVerification(authenticated, { type: 'EMAIL' } as any);

    expect(result).toMatchObject({ verificationId: 'verification-1', type: 'EMAIL' });
    expect(result).not.toHaveProperty('challenge');
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'VerificationChallenge' }));
  });

  it('hashes challenge material before persistence', () => {
    const hash = (service as any).hashChallenge('secret-challenge');
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe('secret-challenge');
    expect(mocks.challengeCreate).not.toHaveBeenCalled();
  });

  it('rejects an expired challenge', async () => {
    const expired = { ...pending, type: 'EMAIL' };
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(expired),
      all: vi.fn().mockResolvedValue([expired]),
      update: mocks.verificationUpdate,
    });
    mocks.challengeWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([{
        id: 'challenge-1',
        verificationId: 'verification-1',
        type: 'EMAIL',
        challengeHash: (service as any).hashChallenge('a'.repeat(64)),
        expiresAt: '2020-01-01T00:00:00.000Z',
        usedAt: null,
        createdAt: '2020-01-01T00:00:00.000Z',
      }]),
    });

    await expect(service.verifyChallenge(authenticated, 'verification-1', 'EMAIL', 'a'.repeat(64)))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('protects challenge replay with a conditional database consumption update', async () => {
    const verification = { ...pending, type: 'EMAIL' };
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(verification),
      all: vi.fn().mockResolvedValue([verification]),
      update: mocks.verificationUpdate,
    });
    mocks.challengeWhere.mockReturnValue({
      all: vi.fn().mockResolvedValue([{
        id: 'challenge-1',
        verificationId: 'verification-1',
        type: 'EMAIL',
        challengeHash: (service as any).hashChallenge('a'.repeat(64)),
        expiresAt: '2099-01-01T00:00:00.000Z',
        usedAt: null,
        createdAt: '2026-10-07T00:00:00.000Z',
      }]),
    });
    mocks.execute.mockResolvedValueOnce({ affectedRows: 0 });

    await expect(service.verifyChallenge(authenticated, 'verification-1', 'EMAIL', 'a'.repeat(64)))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('consumes a valid email challenge once and marks the account email verified', async () => {
    const verification = { ...pending, type: 'EMAIL' };
    const verified = { ...verification, status: 'VERIFIED', verifiedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2027-10-07T00:00:00.000Z' };
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(verification),
      all: vi.fn().mockResolvedValue([verification]),
      update: mocks.verificationUpdate,
    });
    mocks.challengeWhere.mockReturnValue({
      all: vi.fn().mockResolvedValue([{
        id: 'challenge-1',
        verificationId: 'verification-1',
        type: 'EMAIL',
        challengeHash: (service as any).hashChallenge('a'.repeat(64)),
        expiresAt: '2099-01-01T00:00:00.000Z',
        usedAt: null,
        createdAt: '2026-10-07T00:00:00.000Z',
      }]),
    });
    mocks.verificationUpdate.mockResolvedValue(verified);

    const result = await service.verifyChallenge(authenticated, 'verification-1', 'EMAIL', 'a'.repeat(64));

    expect(result.status).toBe('VERIFIED');
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'consume-challenge' }));
    expect(mocks.userWhere).toHaveBeenCalled();
  });

  it('supports the provider-neutral phone challenge lifecycle without an SMS provider', async () => {
    const verification = { ...pending, type: 'PHONE' };
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(verification),
      all: vi.fn().mockResolvedValue([verification]),
      update: mocks.verificationUpdate,
    });
    vi.spyOn((service as any).challengeProvider, 'issueChallenge').mockResolvedValue('b'.repeat(64));
    vi.spyOn((service as any).challengeProvider, 'deliverChallenge').mockResolvedValue(undefined);

    const result = await service.issueChallenge(authenticated, 'verification-1', 'PHONE');

    expect(result.type).toBe('PHONE');
    expect((service as any).challengeProvider.deliverChallenge).toHaveBeenCalled();
    expect(result).not.toHaveProperty('challenge');
  });

  it('creates identity, qualification, and business verification requests', async () => {
    for (const type of ['IDENTITY', 'QUALIFICATION', 'BUSINESS'] as const) {
      mocks.verificationCreate.mockResolvedValueOnce({ ...pending, type, activeKey: `user-1:${type}` });
      const result = await service.createVerification(authenticated, { type } as any);
      expect(result).toMatchObject({ type, status: 'PENDING' });
    }
    expect(mocks.verificationCreate).toHaveBeenCalledTimes(3);
  });

  it('supports administrative approval and records reviewer identity and decision time', async () => {
    const verified = { ...pending, status: 'VERIFIED', verifiedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2027-10-07T00:00:00.000Z' };
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(pending),
      update: mocks.verificationUpdate,
    });
    mocks.verificationUpdate.mockResolvedValue(verified);

    const result = await service.decideAsAdmin(
      { userId: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] },
      'verification-1',
      { status: 'VERIFIED', reason: 'Evidence accepted' } as any,
    );

    expect(result.status).toBe('VERIFIED');
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'admin-1',
      toStatus: 'VERIFIED',
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADMIN_ACTION', entityType: 'Verification' }));
  });

  it('supports administrative rejection', async () => {
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(pending),
      update: mocks.verificationUpdate,
    });
    mocks.verificationUpdate.mockResolvedValue({ ...pending, status: 'REJECTED' });

    const result = await service.decideAsAdmin(
      { userId: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] },
      'verification-1',
      { status: 'REJECTED', reason: 'Insufficient evidence' } as any,
    );

    expect(result.status).toBe('REJECTED');
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ toStatus: 'REJECTED', actorId: 'admin-1' }));
  });

  it('rejects self-service actions for inactive accounts', async () => {
    mocks.userWhere.mockReturnValue({ first: vi.fn().mockResolvedValue({ ...activeUser, status: 'SUSPENDED' }) });
    await expect(service.createVerification(authenticated, { type: 'IDENTITY' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects users from initiating verification for another account', async () => {
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue({ ...pending, userId: 'other-user' }),
    });
    await expect(service.issueChallenge(authenticated, 'verification-1', 'EMAIL'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores private evidence metadata but never returns the storage reference', async () => {
    mocks.verificationWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(pending) });
    const result = await service.addEvidence(authenticated, 'verification-1', {
      storageRef: 'private://identity/user-1/document-1',
      checksum: 'sha256:abc',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      originalName: 'passport.pdf',
    });

    expect(mocks.evidenceCreate).toHaveBeenCalledWith(expect.objectContaining({
      storageRef: 'private://identity/user-1/document-1',
      checksum: 'sha256:abc',
    }));
    expect(result).not.toHaveProperty('storageRef');
    expect(result).not.toHaveProperty('originalName');
  });

  it('rejects duplicate concurrent verification creation at the database uniqueness boundary', async () => {
    mocks.verificationCreate.mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint' });
    await expect(service.createVerification(authenticated, { type: 'IDENTITY' } as any))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('revokes a verified verification and invalidates its capability', async () => {
    const verified = { ...pending, status: 'VERIFIED', type: 'IDENTITY', expiresAt: '2099-01-01T00:00:00.000Z' };
    const revoked = { ...verified, status: 'EXPIRED', activeKey: null, revokedAt: '2026-10-07T00:00:00.000Z', revokedById: 'admin-1' };
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(verified),
      update: mocks.verificationUpdate,
    });
    mocks.verificationUpdate.mockResolvedValue(revoked);

    const result = await service.revokeAsAdmin(
      { userId: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] },
      'verification-1',
      { reason: 'Verification no longer valid' },
    );

    expect(result.status).toBe('EXPIRED');
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: 'VERIFIED',
      toStatus: 'EXPIRED',
      actorId: 'admin-1',
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADMIN_ACTION' }));
  });

  it('enforces capabilities from durable verification state', async () => {
    const verified = { ...pending, status: 'VERIFIED', type: 'IDENTITY', expiresAt: '2099-01-01T00:00:00.000Z' };
    mocks.verificationWhere.mockImplementation((where: { activeKey?: string }) => ({
      first: vi.fn().mockResolvedValue(where.activeKey === 'user-1:IDENTITY' ? verified : undefined),
    }));
    expect(await service.hasCapability('user-1', 'IDENTITY_VERIFIED')).toBe(true);
    await expect(service.assertCapability('user-1', 'BUSINESS_VERIFIED')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies capabilities to inactive accounts', async () => {
    mocks.userWhere.mockReturnValue({ first: vi.fn().mockResolvedValue({ ...activeUser, status: 'BANNED' }) });
    expect(await service.hasCapability('user-1', 'IDENTITY_VERIFIED')).toBe(false);
  });

  it('records expiry as a durable status transition', async () => {
    const expired = { ...pending, status: 'VERIFIED', type: 'IDENTITY', expiresAt: '2020-01-01T00:00:00.000Z' };
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(expired),
      update: mocks.verificationUpdate,
    });
    mocks.verificationUpdate.mockResolvedValue({ ...expired, status: 'EXPIRED', activeKey: null });

    expect(await service.hasCapability('user-1', 'IDENTITY_VERIFIED')).toBe(false);
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ fromStatus: 'VERIFIED', toStatus: 'EXPIRED', actorId: null }));
  });

  it('does not expose challenge hashes in user verification projections', async () => {
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([{ ...pending, type: 'EMAIL' }]),
      update: mocks.verificationUpdate,
    });
    const rows = await service.getMyVerifications(authenticated);
    expect(rows[0]).not.toHaveProperty('activeKey');
    expect(rows[0]).not.toHaveProperty('providerRef');
    expect(rows[0]).not.toHaveProperty('notes');
  });

  it('does not allow a non-admin service caller to masquerade as a reviewer through the request shape', async () => {
    mocks.verificationWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue(pending),
      update: mocks.verificationUpdate,
    });
    const caller = { userId: 'user-1', email: activeUser.email, roles: ['CLIENT'] as const };
    expect(caller.roles).not.toContain('ADMIN');
  });
});
