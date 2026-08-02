import { Controller, Get, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../database/entities';
import { AnalyticsService } from './analytics.service';

@UseGuards(RolesGuard)
@Roles(UserRole.MANAGER, UserRole.OWNER)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  summary(@CurrentUser() user: JwtPayload) {
    return this.analyticsService.summary(user.tenantId);
  }
}
