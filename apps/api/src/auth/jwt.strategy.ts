import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { db } from '../prisma/db.js';
import type { AuthenticatedUser } from './authenticated-user.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env['JWT_ACCESS_SECRET']!,
    });
  }

  async validate(payload: { sub: string; email: string }): Promise<AuthenticatedUser> {
    const user = await db.orm.public.User.where({ id: payload.sub }).first();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is not active');
    }
    const assignments = await db.orm.public.UserRoleAssignment.where({ userId: user.id }).all();
    return {
      userId: user.id,
      email: user.email,
      roles: assignments.map((assignment) => assignment.role),
    };
  }
}
