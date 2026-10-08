import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerationStatusDto {
  @IsIn(['IN_REVIEW', 'RESOLVED', 'CLOSED'])
  status!: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;
}

export class ModerationAssignmentDto {
  @IsString()
  @IsNotEmpty()
  assigneeId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;
}

export class ModerationNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;
}

export class ModerationDecisionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  outcome!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ReportResolutionDto {
  @IsIn(['RESOLVED', 'DISMISSED'])
  status!: 'RESOLVED' | 'DISMISSED';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resolutionCode?: string;
}
