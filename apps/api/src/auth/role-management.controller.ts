import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { AuthenticatedUser, UserRole } from './authenticated-user.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';
import { RoleAssignmentService } from './role-assignment.service.js';

class RoleDto { @IsIn(['CLIENT', 'WORKER', 'ADMIN']) role!: UserRole; }

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class RoleManagementController {
  constructor(private readonly roles: RoleAssignmentService) {}
  @Post(':userId/roles') assign(@Req() req: { user: AuthenticatedUser }, @Param('userId') userId: string, @Body() dto: RoleDto) { return this.roles.assign(req.user.userId, userId, dto.role); }
  @Delete(':userId/roles/:role') remove(@Req() req: { user: AuthenticatedUser }, @Param('userId') userId: string, @Param('role') role: UserRole) { return this.roles.remove(req.user.userId, userId, role); }
}
