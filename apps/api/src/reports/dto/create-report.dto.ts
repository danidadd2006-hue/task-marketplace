import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export enum ReportTargetTypeDto {
  USER = 'USER',
  TASK = 'TASK',
  MESSAGE = 'MESSAGE',
  REVIEW = 'REVIEW',
}

export enum ReportCategoryDto {
  CONTENT = 'CONTENT',
  CONDUCT = 'CONDUCT',
  SAFETY = 'SAFETY',
  TRANSACTION = 'TRANSACTION',
  PRIVACY = 'PRIVACY',
  AUTHENTICITY = 'AUTHENTICITY',
  OTHER = 'OTHER',
}

export enum ReportReasonDto {
  INAPPROPRIATE_CONTENT = 'INAPPROPRIATE_CONTENT',
  HARASSMENT = 'HARASSMENT',
  SPAM = 'SPAM',
  FRAUD_OR_DECEPTION = 'FRAUD_OR_DECEPTION',
  PRIVACY_VIOLATION = 'PRIVACY_VIOLATION',
  SAFETY_CONCERN = 'SAFETY_CONCERN',
  MISREPRESENTATION = 'MISREPRESENTATION',
  OTHER = 'OTHER',
}

export class CreateReportDto {
  @IsEnum(ReportTargetTypeDto)
  targetType!: ReportTargetTypeDto;

  @IsString()
  targetId!: string;

  @IsEnum(ReportCategoryDto)
  category!: ReportCategoryDto;

  @IsEnum(ReportReasonDto)
  reason!: ReportReasonDto;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;
}
