import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReviewController } from './review.controller.js';

describe('ReviewController', () => {
  it('requires JWT authentication', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ReviewController) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('derives the reviewer from the authenticated request user', async () => {
    const reviewService = { createReview: vi.fn().mockResolvedValue({ id: 'review-id' }) };
    const controller = new ReviewController(reviewService as never);
    const request = { user: { userId: 'authenticated-user', email: 'user@example.com', roles: ['CLIENT'] as const } };
    const dto = {
      type: 'CLIENT_TO_WORKER',
      rating: 5,
      communicationRating: 5,
      reliabilityRating: 4,
      qualityRating: 5,
      professionalismRating: 5,
      comment: 'Great work',
    };

    await controller.create(request, 'contract-id', dto as never);

    expect(reviewService.createReview).toHaveBeenCalledWith(request.user, 'contract-id', dto);
  });
});
