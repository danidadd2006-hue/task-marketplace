import { IsHexadecimal, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyChallengeDto {
  @IsString()
  @IsNotEmpty()
  @IsHexadecimal()
  @Length(64, 64)
  challenge!: string;
}
