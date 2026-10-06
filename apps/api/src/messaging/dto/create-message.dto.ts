import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateMessageAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalFilename?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  mimeType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  size!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  checksum!: string;
}

export class CreateMessageLocationDto {
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  accuracy?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class CreateMessageDto {
  @IsIn(['TEXT', 'IMAGE', 'FILE', 'VOICE', 'LOCATION'])
  type!: 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE' | 'LOCATION';

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateMessageAttachmentDto)
  attachments?: CreateMessageAttachmentDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateMessageLocationDto)
  location?: CreateMessageLocationDto;
}
