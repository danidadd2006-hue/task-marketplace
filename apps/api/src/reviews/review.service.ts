import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db, type Tx } from '../prisma/db.js';
import { CreateReviewDto, ReviewTypeDto } from './dto/create-review.dto.js';

const RATING_MIN = 1;
const RATING_MAX = 5;

type ReviewType = 'CLIENT_TO_WORKER' | 'WORKER_TO_CLIENT';

interface ReviewProjection {
  id: string;
  contractId: string;
  reviewerId: string;
  revieweeId: string;
  type: ReviewType;
  rating: number;
  communicationRating: number;
  reliabilityRating: number;
  qualityRating: number;
  professionalismRating: number;
  comment: string | null;
  createdAt: string;
}

@Injectable()
export class ReviewService {
  async createReview(
    authenticatedUser: AuthenticatedUser,
    contractId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewProjection> {
    this.validateRatings(dto);

    let created: ReviewProjection;
    try {
      created = await db.transaction(async (tx) => {
        const contract = await tx.orm.public.Contract.where({ id: contractId }).first();
        if (!contract) throw new NotFoundException('Contract not found');

        const task = await tx.orm.public.Task.where({ id: contract.taskId }).first();
        if (!task) throw new NotFoundException('Contract task not found');
        if (task.id !== contract.taskId) throw new BadRequestException('Contract is not associated with the selected task');
        if (task.status !== 'COMPLETED' || contract.status !== 'COMPLETED') {
          throw new BadRequestException('Reviews require a completed task and contract');
        }

        const party = this.resolveReviewParty(authenticatedUser.userId, task.clientId, contract.workerId);
        if (party.revieweeId === authenticatedUser.userId) {
          throw new ForbiddenException('You cannot review yourself');
        }
        if (dto.type !== party.expectedType) {
          throw new BadRequestException('Review type does not match the authenticated contract party');
        }

        const review = await tx.orm.public.Review.create({
          contractId: contract.id,
          reviewerId: authenticatedUser.userId,
          revieweeId: party.revieweeId,
          type: dto.type,
          rating: dto.rating,
          communicationRating: dto.communicationRating,
          reliabilityRating: dto.reliabilityRating,
          qualityRating: dto.qualityRating,
          professionalismRating: dto.professionalismRating,
          comment: dto.comment ?? null,
        });

        await tx.orm.public.AuditLog.create({
          userId: authenticatedUser.userId,
          action: 'CREATE',
          entityType: 'Review',
          entityId: review.id,
          details: `Review created for contract ${contract.id} as ${dto.type}`,
        });

        await this.recomputeProfileAggregate(tx, party.revieweeId);
        return this.projectReview(review as ReviewProjection);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('A review of this type already exists for this contract');
      }
      throw error;
    }

    return created;
  }

  private resolveReviewParty(
    userId: string,
    clientId: string,
    workerId: string,
  ): { expectedType: ReviewType; revieweeId: string } {
    if (clientId === userId) {
      return { expectedType: 'CLIENT_TO_WORKER', revieweeId: workerId };
    }
    if (workerId === userId) {
      return { expectedType: 'WORKER_TO_CLIENT', revieweeId: clientId };
    }
    throw new ForbiddenException('You are not a party to this contract');
  }

  private validateRatings(dto: CreateReviewDto) {
    const ratings = [
      ['rating', dto.rating],
      ['communicationRating', dto.communicationRating],
      ['reliabilityRating', dto.reliabilityRating],
      ['qualityRating', dto.qualityRating],
      ['professionalismRating', dto.professionalismRating],
    ] as const;

    for (const [field, value] of ratings) {
      if (!Number.isInteger(value) || value < RATING_MIN || value > RATING_MAX) {
        throw new BadRequestException(`${field} must be an integer from ${RATING_MIN} to ${RATING_MAX}`);
      }
    }
  }

  private async recomputeProfileAggregate(tx: Tx, revieweeId: string) {
    const profile = await tx.orm.public.Profile.where({ userId: revieweeId }).first();
    if (!profile) return;

    const reviews = await tx.orm.public.Review.where({ revieweeId }).all();
    const totalReviews = reviews.length;
    const averageRating = totalReviews === 0
      ? null
      : (reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews).toFixed(4);

    await tx.orm.public.Profile.where({ userId: revieweeId }).update({
      averageRating,
      totalReviews,
    });
  }

  private projectReview(review: ReviewProjection): ReviewProjection {
    return {
      id: review.id,
      contractId: review.contractId,
      reviewerId: review.reviewerId,
      revieweeId: review.revieweeId,
      type: review.type,
      rating: review.rating,
      communicationRating: review.communicationRating,
      reliabilityRating: review.reliabilityRating,
      qualityRating: review.qualityRating,
      professionalismRating: review.professionalismRating,
      comment: review.comment,
      createdAt: review.createdAt,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: unknown; message?: unknown };
    return candidate.code === 'P2002'
      || candidate.code === '23505'
      || (typeof candidate.message === 'string' && /unique constraint|duplicate key/i.test(candidate.message));
  }
}
