import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db, type Tx } from '../prisma/db.js';
import { LocalVerificationChallengeProvider, LocalVerificationProvider, type VerificationChallengeProvider, type VerificationProvider } from './verification.providers.js';
import { CAPABILITY_TO_TYPE, type VerificationCapability, type VerificationType } from './verification.types.js';
import { CreateVerificationDto } from './dto/create-verification.dto.js';
import { AddVerificationEvidenceDto } from './dto/evidence.dto.js';
import { AdminVerificationDecisionDto, RevokeVerificationDto } from './dto/admin-decision.dto.js';

const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const VERIFIED_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
type ChallengeType = 'EMAIL' | 'PHONE';

@Injectable()
export class VerificationService {
  private readonly provider: VerificationProvider = new LocalVerificationProvider();
  private readonly challengeProvider: VerificationChallengeProvider = new LocalVerificationChallengeProvider();

  async createVerification(user: AuthenticatedUser, dto: CreateVerificationDto) {
    const type = dto.type;
    const result = await db.transaction(async (tx) => {
      const subject = await tx.orm.public.User.where({ id: user.userId }).first();
      this.assertActive(subject);

      const existing = await tx.orm.public.Verification.where({ activeKey: this.activeKey(user.userId, type) }).first();
      if (existing) {
        await this.expireIfNeeded(tx, existing);
        const current = await tx.orm.public.Verification.where({ id: existing.id }).first();
        if (current && current.status !== 'EXPIRED' && current.status !== 'REJECTED') {
          if (type === 'EMAIL' || type === 'PHONE') return { verification: current, challenge: null };
          throw new ConflictException('An active verification already exists for this type');
        }
      }

      const provider = await this.provider.createVerification({ userId: user.userId, type });
      const verification = await tx.orm.public.Verification.create({
        userId: user.userId,
        type,
        status: 'PENDING',
        provider: this.provider.name,
        providerRef: provider.providerRef ?? null,
        verifiedAt: null,
        expiresAt: null,
        reviewedAt: null,
        reviewedById: null,
        decisionReason: null,
        revokedAt: null,
        revokedById: null,
        revocationReason: null,
        activeKey: this.activeKey(user.userId, type),
        notes: null,
      });

      await tx.orm.public.VerificationHistory.create({
        verificationId: verification.id,
        fromStatus: null,
        toStatus: 'PENDING',
        actorId: user.userId,
        reason: 'Verification initiated',
      });

      await tx.orm.public.AuditLog.create({
        userId: user.userId,
        action: 'CREATE',
        entityType: 'Verification',
        entityId: verification.id,
        details: `Verification initiated: ${type}`,
        ipAddress: null,
        userAgent: null,
      });

      return { verification, challenge: null };
    }).catch((error) => {
      if (this.isUniqueViolation(error)) throw new ConflictException('An active verification already exists for this type');
      throw error;
    });

    if ((type === 'EMAIL' || type === 'PHONE') && result.verification.status === 'PENDING') {
      return this.issueChallenge(user, result.verification.id, type);
    }

    return this.projectUserVerification(result.verification);
  }

  async issueChallenge(user: AuthenticatedUser, verificationId: string, type: ChallengeType) {
    const verification = await db.orm.public.Verification.where({ id: verificationId }).first();
    if (!verification) throw new NotFoundException('Verification not found');
    if (verification.userId !== user.userId) throw new ForbiddenException('Verification does not belong to the authenticated user');
    if (verification.type !== type) throw new BadRequestException('Challenge type does not match verification type');
    if (verification.status !== 'PENDING') throw new BadRequestException('Verification is not awaiting challenge confirmation');

    const subject = await db.orm.public.User.where({ id: user.userId }).first();
    this.assertActive(subject);
    if (type === 'PHONE' && !subject?.phone) throw new BadRequestException('A phone number is required for phone verification');

    const challenge = await this.challengeProvider.issueChallenge({ userId: user.userId, type });
    const challengeHash = this.hashChallenge(challenge);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

    let createdChallengeId: string | undefined;
    await db.transaction(async (tx) => {
      const current = await tx.orm.public.Verification.where({ id: verificationId }).first();
      if (!current || current.status !== 'PENDING') throw new BadRequestException('Verification is not awaiting challenge confirmation');

      const oldChallenges = await tx.orm.public.VerificationChallenge.where({ verificationId, type }).all();
      for (const old of oldChallenges) {
        if (!old.usedAt && new Date(old.expiresAt) > new Date()) {
          await tx.orm.public.VerificationChallenge.where({ id: old.id }).update({ expiresAt: new Date().toISOString() });
        }
      }

      const created = await tx.orm.public.VerificationChallenge.create({
        verificationId,
        type,
        challengeHash,
        expiresAt,
        usedAt: null,
      });

      createdChallengeId = created.id;
      await tx.orm.public.AuditLog.create({
        userId: user.userId,
        action: 'CREATE',
        entityType: 'VerificationChallenge',
        entityId: created.id,
        details: `Verification challenge created: ${type}`,
        ipAddress: null,
        userAgent: null,
      });
    });

    await this.challengeProvider.deliverChallenge({ userId: user.userId, type, challenge });

    return {
      verificationId,
      type,
      challengeId: createdChallengeId!,
      expiresAt,
    };
  }

  async verifyChallenge(user: AuthenticatedUser, verificationId: string, type: ChallengeType, rawChallenge: string) {
    const result = await db.transaction(async (tx) => {
      const subject = await tx.orm.public.User.where({ id: user.userId }).first();
      this.assertActive(subject);

      const verification = await tx.orm.public.Verification.where({ id: verificationId }).first();
      if (!verification) throw new NotFoundException('Verification not found');
      if (verification.userId !== user.userId) throw new ForbiddenException('Verification does not belong to the authenticated user');
      if (verification.type !== type) throw new BadRequestException('Challenge type does not match verification type');

      const verificationState = await this.expireIfNeeded(tx, verification);
      if (verificationState?.status === 'EXPIRED') throw new BadRequestException('Verification has expired');
      if (verification.status !== 'PENDING') throw new BadRequestException('Verification is not awaiting challenge confirmation');

      const challenges = await tx.orm.public.VerificationChallenge.where({ verificationId, type }).all();
      const challenge = challenges
        .filter((item) => !item.usedAt)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      if (!challenge) throw new BadRequestException('No active verification challenge exists');
      if (new Date(challenge.expiresAt) <= new Date()) throw new BadRequestException('Verification challenge has expired');

      const expected = Buffer.from(challenge.challengeHash, 'hex');
      const supplied = Buffer.from(this.hashChallenge(rawChallenge), 'hex');
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        throw new ForbiddenException('Invalid verification challenge');
      }

      const consumedAt = new Date().toISOString();
      const consumePlan = tx.sql.public.verificationChallenge
        .update({ usedAt: consumedAt })
        .where((fields, functions) => functions.eq(fields.id, challenge.id))
        .where((fields, functions) => functions.eq(fields.usedAt, null))
        .build();
      const consumed = await tx.execute(consumePlan);
      if (consumed.affectedRows !== 1) throw new ConflictException('Verification challenge has already been used');

      const expiresAt = new Date(Date.now() + VERIFIED_TTL_MS).toISOString();
      const updated = await tx.orm.public.Verification.where({ id: verification.id }).update({
        status: 'VERIFIED',
        verifiedAt: consumedAt,
        expiresAt,
        activeKey: this.activeKey(user.userId, type),
      });

      await tx.orm.public.VerificationHistory.create({
        verificationId: verification.id,
        fromStatus: 'PENDING',
        toStatus: 'VERIFIED',
        actorId: user.userId,
        reason: 'Challenge verified',
      });

      await tx.orm.public.AuditLog.create({
        userId: user.userId,
        action: 'VERIFY',
        entityType: 'Verification',
        entityId: verification.id,
        details: `Verification challenge accepted: ${type}`,
        ipAddress: null,
        userAgent: null,
      });

      await this.syncAccountVerificationFlag(tx, user.userId, type, true);
      return updated;
    });

    return this.projectUserVerification(result);
  }

  async addEvidence(user: AuthenticatedUser, verificationId: string, dto: AddVerificationEvidenceDto) {
    if (!dto.storageRef) throw new BadRequestException('A private storage reference is required');

    const verification = await db.orm.public.Verification.where({ id: verificationId }).first();
    if (!verification) throw new NotFoundException('Verification not found');
    if (verification.userId !== user.userId) throw new ForbiddenException('Verification does not belong to the authenticated user');
    if (verification.status !== 'PENDING') throw new BadRequestException('Evidence may only be added to pending verification');

    const subject = await db.orm.public.User.where({ id: user.userId }).first();
    this.assertActive(subject);

    const evidence = await db.orm.public.VerificationEvidence.create({
      verificationId,
      storageRef: dto.storageRef,
      checksum: dto.checksum ?? null,
      mimeType: dto.mimeType ?? null,
      sizeBytes: dto.sizeBytes == null ? null : BigInt(dto.sizeBytes),
      originalName: dto.originalName ?? null,
    });

    await db.orm.public.AuditLog.create({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'VerificationEvidence',
      entityId: evidence.id,
      details: 'Private verification evidence reference added',
      ipAddress: null,
      userAgent: null,
    });

    return { id: evidence.id, verificationId, createdAt: evidence.createdAt };
  }

  async decideAsAdmin(admin: AuthenticatedUser, verificationId: string, dto: AdminVerificationDecisionDto) {
    const result = await db.transaction(async (tx) => {
      const verification = await tx.orm.public.Verification.where({ id: verificationId }).first();
      if (!verification) throw new NotFoundException('Verification not found');
      if (verification.status !== 'PENDING') throw new BadRequestException('Only pending verifications can be decided');

      const now = new Date().toISOString();
      let expiresAt: string | null = null;
      if (dto.status === 'VERIFIED') {
        expiresAt = dto.expiresAt ?? new Date(Date.now() + VERIFIED_TTL_MS).toISOString();
        if (new Date(expiresAt) <= new Date()) throw new BadRequestException('Verification expiry must be in the future');
      }

      const updated = await tx.orm.public.Verification.where({ id: verification.id }).update({
        status: dto.status,
        verifiedAt: dto.status === 'VERIFIED' ? now : null,
        expiresAt,
        reviewedAt: now,
        reviewedById: admin.userId,
        decisionReason: dto.reason ?? null,
        activeKey: dto.status === 'VERIFIED' ? this.activeKey(verification.userId, verification.type) : null,
      });

      await tx.orm.public.VerificationHistory.create({
        verificationId: verification.id,
        fromStatus: 'PENDING',
        toStatus: dto.status,
        actorId: admin.userId,
        reason: dto.reason ?? null,
      });

      await tx.orm.public.AuditLog.create({
        userId: admin.userId,
        action: 'ADMIN_ACTION',
        entityType: 'Verification',
        entityId: verification.id,
        details: `Verification administratively ${dto.status.toLowerCase()}`,
        ipAddress: null,
        userAgent: null,
      });

      await this.syncAccountVerificationFlag(tx, verification.userId, verification.type, dto.status === 'VERIFIED');
      return updated;
    });

    return this.projectUserVerification(result);
  }

  async revokeAsAdmin(admin: AuthenticatedUser, verificationId: string, dto: RevokeVerificationDto) {
    const result = await db.transaction(async (tx) => {
      const verification = await tx.orm.public.Verification.where({ id: verificationId }).first();
      if (!verification) throw new NotFoundException('Verification not found');
      if (verification.status !== 'VERIFIED') throw new BadRequestException('Only verified verifications can be revoked');

      const now = new Date().toISOString();
      const updated = await tx.orm.public.Verification.where({ id: verification.id }).update({
        status: 'EXPIRED',
        revokedAt: now,
        revokedById: admin.userId,
        revocationReason: dto.reason,
        activeKey: null,
      });

      await tx.orm.public.VerificationHistory.create({
        verificationId: verification.id,
        fromStatus: 'VERIFIED',
        toStatus: 'EXPIRED',
        actorId: admin.userId,
        reason: `Revoked: ${dto.reason}`,
      });

      await tx.orm.public.AuditLog.create({
        userId: admin.userId,
        action: 'ADMIN_ACTION',
        entityType: 'Verification',
        entityId: verification.id,
        details: 'Verification revoked',
        ipAddress: null,
        userAgent: null,
      });

      await this.syncAccountVerificationFlag(tx, verification.userId, verification.type, false);
      return updated;
    });

    return this.projectUserVerification(result);
  }

  async getMyVerifications(user: AuthenticatedUser) {
    const subject = await db.orm.public.User.where({ id: user.userId }).first();
    this.assertActive(subject);

    const rows = await db.orm.public.Verification.where({ userId: user.userId }).all();
    for (const row of rows) await this.expireVerification(row.id);
    const refreshed = await db.orm.public.Verification.where({ userId: user.userId }).all();
    return refreshed.map((row) => this.projectUserVerification(row));
  }

  async listPendingAsAdmin() {
    const rows = await db.orm.public.Verification.where({ status: 'PENDING' }).all();
    return Promise.all(rows.map(async (row) => {
      const evidence = await db.orm.public.VerificationEvidence.where({ verificationId: row.id }).all();
      return {
        id: row.id,
        userId: row.userId,
        type: row.type,
        status: row.status,
        provider: row.provider,
        providerRef: row.providerRef,
        createdAt: row.createdAt,
        evidence: evidence.map((item) => ({
          id: item.id,
          storageRef: item.storageRef,
          checksum: item.checksum,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          originalName: item.originalName,
          createdAt: item.createdAt,
        })),
      };
    }));
  }

  async hasCapability(userId: string, capability: VerificationCapability): Promise<boolean> {
    const user = await db.orm.public.User.where({ id: userId }).first();
    if (!user || user.status !== 'ACTIVE') return false;

    const type = CAPABILITY_TO_TYPE[capability];
    const verification = await db.orm.public.Verification.where({ activeKey: this.activeKey(userId, type) }).first();
    if (!verification || verification.status !== 'VERIFIED') return false;
    if (verification.expiresAt && new Date(verification.expiresAt) <= new Date()) {
      await this.expireVerification(verification.id);
      return false;
    }
    return true;
  }

  async assertCapability(userId: string, capability: VerificationCapability) {
    if (!(await this.hasCapability(userId, capability))) {
      throw new ForbiddenException(`Verification capability required: ${capability}`);
    }
  }

  private async expireVerification(verificationId: string) {
    return db.transaction(async (tx) => {
      const verification = await tx.orm.public.Verification.where({ id: verificationId }).first();
      if (!verification || !verification.expiresAt || new Date(verification.expiresAt) > new Date()) return verification;
      return this.expireIfNeeded(tx, verification);
    });
  }

  private async expireIfNeeded(tx: Tx, verification: any) {
    if ((verification.status !== 'PENDING' && verification.status !== 'VERIFIED') || !verification.expiresAt) return verification;
    if (new Date(verification.expiresAt) > new Date()) return verification;

    const updated = await tx.orm.public.Verification.where({ id: verification.id }).update({
      status: 'EXPIRED',
      activeKey: null,
    });

    await tx.orm.public.VerificationHistory.create({
      verificationId: verification.id,
      fromStatus: verification.status,
      toStatus: 'EXPIRED',
      actorId: null,
      reason: 'Verification expired',
    });

    await tx.orm.public.AuditLog.create({
      userId: null,
      action: 'VERIFY',
      entityType: 'Verification',
      entityId: verification.id,
      details: 'Verification expired',
      ipAddress: null,
      userAgent: null,
    });

    await this.syncAccountVerificationFlag(tx, verification.userId, verification.type, false);
    return updated;
  }

  private async syncAccountVerificationFlag(tx: Tx, userId: string, type: VerificationType, verified: boolean) {
    if (type === 'EMAIL') {
      await tx.orm.public.User.where({ id: userId }).update({ emailVerified: verified });
    }
    if (type === 'PHONE') {
      await tx.orm.public.User.where({ id: userId }).update({ phoneVerified: verified });
    }
  }

  private assertActive(user: any) {
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('User account is not active');
  }

  private activeKey(userId: string, type: VerificationType) {
    return `${userId}:${type}`;
  }

  private hashChallenge(challenge: string) {
    return createHash('sha256').update(challenge).digest('hex');
  }

  private projectUserVerification(row: any) {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      verifiedAt: row.verifiedAt,
      expiresAt: row.expiresAt,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private isUniqueViolation(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: unknown; message?: unknown };
    return candidate.code === 'P2002' || candidate.code === '23505' || (typeof candidate.message === 'string' && /unique constraint|duplicate key/i.test(candidate.message));
  }
}
