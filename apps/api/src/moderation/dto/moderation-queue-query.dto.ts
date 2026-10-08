import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const MODERATION_CASE_TYPES = ['REPORT', 'DISPUTE', 'MODERATION'] as const;
const MODERATION_CASE_STATUSES = ['OPEN', 'ASSIGNED', 'IN_REVIEW'] as const;

export class ModerationQueueQueryDto {
  @IsOptional()
  @IsIn(MODERATION_CASE_TYPES)
  type?: (typeof MODERATION_CASE_TYPES)[number];

  @IsOptional()
  @IsIn(MODERATION_CASE_STATUSES)
  status?: (typeof MODERATION_CASE_STATUSES)[number];

  @IsOptional()
  @IsIn(['USER', 'TASK', 'MESSAGE', 'REVIEW', 'CONTRACT'])
  subjectType?: 'USER' | 'TASK' | 'MESSAGE' | 'REVIEW' | 'CONTRACT';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
