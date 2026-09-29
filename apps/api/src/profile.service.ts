import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from './prisma/db.js';

@Injectable()
export class ProfileService {
  async getProfile(userId: string) {
    const profile = await db.orm.public.Profile
      .where({ userId })
      .first();

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return profile;
  }

  async createProfile(
    userId: string,
    data: {
      type: 'INDIVIDUAL' | 'BUSINESS';
      displayName: string;
      bio?: string;
      profilePhotoUrl?: string;
      websiteUrl?: string;
      yearsExperience?: number;
    },
  ) {
    return db.orm.public.Profile.create({
      userId,
      type: data.type,
      displayName: data.displayName,
      bio: data.bio ?? null,
      profilePhotoUrl: data.profilePhotoUrl ?? null,
      websiteUrl: data.websiteUrl ?? null,
      yearsExperience: data.yearsExperience ?? null,
    });
  }

  async updateProfile(
    userId: string,
    data: {
      type?: 'INDIVIDUAL' | 'BUSINESS';
      displayName?: string;
      bio?: string;
      profilePhotoUrl?: string;
      websiteUrl?: string;
      yearsExperience?: number;
    },
  ) {
    const profile = await db.orm.public.Profile
      .where({ userId })
      .first();

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return db.orm.public.Profile
      .where({ userId })
      .update({
        type: data.type ?? profile.type,
        displayName: data.displayName ?? profile.displayName,
        bio: data.bio ?? profile.bio,
        profilePhotoUrl:
          data.profilePhotoUrl ?? profile.profilePhotoUrl,
        websiteUrl:
          data.websiteUrl ?? profile.websiteUrl,
        yearsExperience:
          data.yearsExperience ?? profile.yearsExperience,
      });
  }
}