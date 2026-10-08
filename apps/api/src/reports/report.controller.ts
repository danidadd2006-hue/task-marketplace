import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AddReportEvidenceDto } from './dto/add-report-evidence.dto.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import { ReportService } from './report.service.js';

@Controller('api/v1/reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post()
  create(@Req() request: { user: AuthenticatedUser }, @Body() dto: CreateReportDto) {
    return this.reportService.createReport(request.user, dto);
  }

  @Get(':reportId')
  getMine(@Req() request: { user: AuthenticatedUser }, @Param('reportId') reportId: string) {
    return this.reportService.getMyReport(request.user, reportId);
  }

  @Post(':reportId/evidence')
  addEvidence(
    @Req() request: { user: AuthenticatedUser },
    @Param('reportId') reportId: string,
    @Body() dto: AddReportEvidenceDto,
  ) {
    return this.reportService.addEvidence(request.user, reportId, dto);
  }
}
