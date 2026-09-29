import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [
    PassportModule.register({}),
    JwtModule.register({
      secret: process.env['JWT_ACCESS_SECRET'],
      signOptions: {
        expiresIn: '15m',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [
    AuthService,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule {}