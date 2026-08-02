import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../database/entities';
import { TenantSettings } from '../database/entities/tenant.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@UseGuards(RolesGuard)
@Roles(UserRole.MANAGER, UserRole.OWNER)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(@CurrentUser() user: JwtPayload): Promise<TenantSettings> {
    return this.settingsService.get(user.tenantId);
  }

  @Put()
  update(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSettingsDto,
  ): Promise<TenantSettings> {
    return this.settingsService.update(user.tenantId, {
      aiConfidenceThreshold: dto.aiConfidenceThreshold,
    });
  }
}
