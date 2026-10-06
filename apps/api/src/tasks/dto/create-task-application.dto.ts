import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateTaskApplicationAttachmentDto {
  @IsUrl({ require_tld: false })
  @MaxLength(2_048)
  fileUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fileSize?: number;
}

export class CreateTaskApplicationDto {
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  proposedPrice!: number;

  @IsOptional()
  @IsDateString()
  estimatedCompletionAt?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  message?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  qualifications?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  questions?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskApplicationAttachmentDto)
  attachments?: CreateTaskApplicationAttachmentDto[];
}
