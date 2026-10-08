import { IsIn, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  RISK_SOURCE_DOMAINS,
  RISK_SUBJECT_TYPES,
  type RiskSourceDomain,
  type RiskSubjectType,
} from '../risk.constants.js';

export class CreateRiskSignalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  signalType!: string;

  @IsIn(RISK_SUBJECT_TYPES)
  subjectType!: RiskSubjectType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subjectId!: string;

  @IsIn(RISK_SOURCE_DOMAINS)
  sourceDomain!: RiskSourceDomain;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  sourceReference!: string;

  @IsOptional()
  @IsISO8601()
  observedAt?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  deduplicationKey!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
