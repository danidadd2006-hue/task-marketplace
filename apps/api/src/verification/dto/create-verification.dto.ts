import { IsEnum } from 'class-validator';
import type { VerificationType } from '../verification.types.js';

const VERIFICATION_TYPES = {
  IDENTITY: 'IDENTITY',
  PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  PAYMENT: 'PAYMENT',
  ADDRESS: 'ADDRESS',
  BUSINESS: 'BUSINESS',
  QUALIFICATION: 'QUALIFICATION',
} as const;

export class CreateVerificationDto {
  @IsEnum(VERIFICATION_TYPES)
  type!: VerificationType;
}
