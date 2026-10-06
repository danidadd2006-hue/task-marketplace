import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { RoleAssignmentService } from './role-assignment.service.js';
import { RoleManagementController } from './role-management.controller.js';
import { RolesGuard } from './roles.guard.js';

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
  controllers: [AuthController, RoleManagementController],
  providers: [AuthService, JwtStrategy, RoleAssignmentService, RolesGuard],
  exports: [
    AuthService,
    JwtModule,
    PassportModule,
    RolesGuard,
  ],
})
export class AuthModule {}
