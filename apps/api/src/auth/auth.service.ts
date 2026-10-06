import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { db } from '../prisma/db.js';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  async verifyPassword(
    password: string,
    passwordHash: string,
  ): Promise<boolean> {
    return argon2.verify(passwordHash, password);
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async createAccessToken(user: { id: string; email: string }) {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });
  }

  async register(email: string, password: string) {
    const passwordHash = await this.hashPassword(password);
    return db.transaction(async (tx) => {
      const user = await tx.orm.public.User.create({ email, passwordHash });
      await tx.orm.public.UserRoleAssignment.create({ userId: user.id, role: 'CLIENT', assignedBy: user.id });
      return { id: user.id, email: user.email };
    });
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const refreshToken = randomBytes(64).toString('hex');
    const tokenHash = this.hashRefreshToken(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.orm.public.RefreshToken.create({
      userId,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    });

    return refreshToken;
  }

  async login(email: string, password: string) {
    const user = await db.orm.public.User
      .where({ email })
      .first();

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('User account is not active');

    const passwordValid = await this.verifyPassword(
      password,
      user.passwordHash,
    );

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.createAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
      },
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    return db.transaction(async (tx) => {
      const storedToken = await tx.orm.public.RefreshToken.where({ tokenHash }).first();
      if (!storedToken) throw new UnauthorizedException('Invalid refresh token');
      if (storedToken.revokedAt) throw new UnauthorizedException('Refresh token has been revoked');
      if (new Date(storedToken.expiresAt) <= new Date()) throw new UnauthorizedException('Refresh token has expired');

      const user = await tx.orm.public.User.where({ id: storedToken.userId }).first();
      if (!user) throw new UnauthorizedException('User not found');
      if (user.status !== 'ACTIVE') throw new UnauthorizedException('User account is not active');

      const revokedAt = new Date().toISOString();
      const revokePlan = tx.sql.public.refreshToken
        .update({ revokedAt })
        .where((fields, functions) => functions.eq(fields.id, storedToken.id))
        .where((fields, functions) => functions.eq(fields.revokedAt, null))
        .build();
      const revoked = await tx.execute(revokePlan);
      if (revoked.affectedRows !== 1) throw new UnauthorizedException('Refresh token has been revoked');

      const newRefreshToken = randomBytes(64).toString('hex');
      const newTokenHash = this.hashRefreshToken(newRefreshToken);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      await tx.orm.public.RefreshToken.create({ userId: user.id, tokenHash: newTokenHash, expiresAt: expiresAt.toISOString(), revokedAt: null });
      const accessToken = await this.createAccessToken(user);
      return { accessToken, refreshToken: newRefreshToken };
    });
  }
}
