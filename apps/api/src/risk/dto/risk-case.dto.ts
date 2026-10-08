import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RISK_DECISION_OUTCOMES } from '../risk.constants.js';

export class RiskQueueQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'ASSIGNED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'])
  status?: 'OPEN' | 'ASSIGNED' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED';

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  signalType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subjectType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  assignedToId?: string;

  @IsOptional()
  @IsISO8601()
  observedFrom?: string;

  @IsOptional()
  @IsISO8601()
  observedTo?: string;

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

export class OpenRiskCaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;
}

export class RiskAssignmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  assigneeId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;
}

export class RiskEvidenceDto {
  @IsIn(['ATTACHMENT', 'MESSAGE', 'TASK', 'CONTRACT', 'PAYMENT', 'REVIEW', 'VERIFICATION', 'MEDIA', 'OTHER'])
  evidenceType!: 'ATTACHMENT' | 'MESSAGE' | 'TASK' | 'CONTRACT' | 'PAYMENT' | 'REVIEW' | 'VERIFICATION' | 'MEDIA' | 'OTHER';

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  referenceType!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  referenceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}

export class RiskNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;
}

export class RiskStatusDto {
  @IsIn(['IN_REVIEW', 'RESOLVED', 'DISMISSED'])
  status!: 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resolutionCode?: string;
}

export class RiskDecisionDto {
  @IsIn(RISK_DECISION_OUTCOMES)
  outcome!: typeof RISK_DECISION_OUTCOMES[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class RiskEnforcementDto {
  @IsIn(['ACCOUNT_STATUS', 'MODERATION_CASE'])
  actionType!: 'ACCOUNT_STATUS' | 'MODERATION_CASE';

  @IsOptional()
  @IsIn(['SUSPENDED', 'BANNED', 'DELETED', 'ACTIVE'])
  accountStatus?: 'SUSPENDED' | 'BANNED' | 'DELETED' | 'ACTIVE';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;
}
