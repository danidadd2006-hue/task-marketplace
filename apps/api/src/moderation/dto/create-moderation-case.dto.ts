import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const MODERATION_TARGET_TYPES = ['USER', 'TASK', 'MESSAGE', 'REVIEW'] as const;
export type ModerationTargetType = (typeof MODERATION_TARGET_TYPES)[number];

export class CreateModerationCaseDto {
  @IsIn(MODERATION_TARGET_TYPES)
  subjectType!: ModerationTargetType;

  @IsString()
  @IsNotEmpty()
  subjectId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;
}
