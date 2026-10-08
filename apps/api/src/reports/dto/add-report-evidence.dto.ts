import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ReportEvidenceReferenceTypeDto {
  TASK_ATTACHMENT = 'TaskAttachment',
  MESSAGE_ATTACHMENT = 'MessageAttachment',
}

export class AddReportEvidenceDto {
  @IsEnum(ReportEvidenceReferenceTypeDto)
  referenceType!: ReportEvidenceReferenceTypeDto;

  @IsString()
  referenceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
