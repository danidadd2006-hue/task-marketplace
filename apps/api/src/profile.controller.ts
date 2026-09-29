import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { ProfileService } from './profile.service.js';

@Controller('api/v1/profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getProfile(
    @Req() request: { user: { userId: string } },
  ) {
    return this.profileService.getProfile(request.user.userId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createProfile(
    @Req() request: { user: { userId: string } },
    @Body()
    body: {
      type: 'INDIVIDUAL' | 'BUSINESS';
      displayName: string;
      bio?: string;
      profilePhotoUrl?: string;
      websiteUrl?: string;
      yearsExperience?: number;
    },
  ) {
    return this.profileService.createProfile(
      request.user.userId,
      body,
    );
  }

  @Put()
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Req() request: { user: { userId: string } },
    @Body()
    body: {
      type?: 'INDIVIDUAL' | 'BUSINESS';
      displayName?: string;
      bio?: string;
      profilePhotoUrl?: string;
      websiteUrl?: string;
      yearsExperience?: number;
    },
  ) {
    return this.profileService.updateProfile(
      request.user.userId,
      body,
    );
  }
}