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

    const storedToken = await db.orm.public.RefreshToken
      .where({ tokenHash })
      .first();

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revokedAt) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (new Date(storedToken.expiresAt) <= new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const user = await db.orm.public.User
      .where({ id: storedToken.userId })
      .first();

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const newAccessToken = await this.createAccessToken(user);
    const newRefreshToken = await this.createRefreshToken(user.id);

    await db.orm.public.RefreshToken
      .where({ id: storedToken.id })
      .update({
        revokedAt: new Date().toISOString(),
      });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }
}