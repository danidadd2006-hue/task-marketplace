import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewService } from './review.service.js';

@Controller('api/v1/contracts')
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post(':contractId/reviews')
  create(
    @Req() request: { user: AuthenticatedUser },
    @Param('contractId') contractId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewService.createReview(request.user, contractId, dto);
  }
}
