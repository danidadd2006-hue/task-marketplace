import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum ReviewTypeDto {
  CLIENT_TO_WORKER = 'CLIENT_TO_WORKER',
  WORKER_TO_CLIENT = 'WORKER_TO_CLIENT',
}

export class CreateReviewDto {
  @IsEnum(ReviewTypeDto)
  type!: ReviewTypeDto;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  communicationRating!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  reliabilityRating!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  qualityRating!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  professionalismRating!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
