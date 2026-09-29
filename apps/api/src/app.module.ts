import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ProfileService } from './profile.service.js';
import { ProfileController } from './profile.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class AppModule {}