import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TokensController } from './tokens.controller.js';
import { TokensService } from './tokens.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
