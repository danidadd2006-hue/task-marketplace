import { Type } from 'class-transformer';
import { IsInt, IsIn, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class PublicTaskFeedQueryDto {
  @IsOptional()
  @IsIn(['PHYSICAL', 'VIRTUAL'])
  type?: 'PHYSICAL' | 'VIRTUAL';

  @IsOptional()
  @IsIn(['SHORT_TERM', 'LONG_TERM'])
  duration?: 'SHORT_TERM' | 'LONG_TERM';

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}
