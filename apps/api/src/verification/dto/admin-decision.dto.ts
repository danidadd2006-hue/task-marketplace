import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class AdminVerificationDecisionDto {
  @IsEnum(['VERIFIED', 'REJECTED'])
  status!: 'VERIFIED' | 'REJECTED';

  @IsString()
  @IsOptional()
  reason?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

export class RevokeVerificationDto {
  @IsString()
  reason!: string;
}
