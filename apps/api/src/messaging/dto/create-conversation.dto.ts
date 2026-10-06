import { IsOptional, IsUUID } from 'class-validator';

export class CreateConversationDto {
  @IsUUID()
  taskId!: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsUUID()
  participantUserId?: string;
}
