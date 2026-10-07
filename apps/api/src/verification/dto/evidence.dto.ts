import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AddVerificationEvidenceDto {
  @IsString()
  @IsOptional()
  storageRef?: string;

  @IsString()
  @IsOptional()
  checksum?: string;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  @IsOptional()
  sizeBytes?: number;

  @IsString()
  @IsOptional()
  originalName?: string;
}
