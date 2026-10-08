import { IsString } from 'class-validator';

export class CreateTokenPurchaseDto {
  @IsString()
  packageId!: string;
}
