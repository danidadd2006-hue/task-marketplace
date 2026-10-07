import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SpendTokensDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
