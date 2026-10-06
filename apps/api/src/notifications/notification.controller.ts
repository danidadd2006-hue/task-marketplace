import { BadRequestException, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { NotificationService } from './notification.service.js';

@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  list(@Req() request: { user: AuthenticatedUser }, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const parsedPage = page === undefined ? 1 : Number(page);
    const parsedPageSize = pageSize === undefined ? 50 : Number(pageSize);
    if (!Number.isInteger(parsedPage) || !Number.isInteger(parsedPageSize)) {
      throw new BadRequestException('page and pageSize must be integers');
    }
    return this.notificationService.listForUser(request.user, parsedPage, parsedPageSize);
  }

  @Get('preferences/eligibility')
  preferenceEligibility(@Req() request: { user: AuthenticatedUser }, @Query('type') type?: string) {
    if (!type) throw new BadRequestException('type is required');
    return this.notificationService.getPreferenceEligibility(request.user.userId, type);
  }

  @Get(':notificationId')
  get(@Req() request: { user: AuthenticatedUser }, @Param('notificationId') notificationId: string) {
    return this.notificationService.getForUser(request.user, notificationId);
  }

  @Patch(':notificationId/read')
  markRead(@Req() request: { user: AuthenticatedUser }, @Param('notificationId') notificationId: string) {
    return this.notificationService.markRead(request.user, notificationId);
  }
}