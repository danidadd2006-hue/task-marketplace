import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() data: RegisterDto) {
    const passwordHash = await this.authService.hashPassword(data.password);

    const user = await db.orm.public.User.create({
      email: data.email,
      passwordHash,
    });

    return {
      id: user.id,
      email: user.email,
    };
  }

  @Post('login')
  async login(@Body() data: LoginDto) {
  return this.authService.login(data.email, data.password);
 }

  @Post('refresh')
  async refresh(@Body() data: RefreshDto) {
  return this.authService.refresh(data.refreshToken);
 }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() request: { user: { userId: string; email: string } }) {
    return request.user;
  }
}