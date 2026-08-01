import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../database/entities';
import { AuthService } from './auth.service';
import type { JwtPayload } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { LoginManagerDto } from './dto/login-manager.dto';
import { LoginPinDto } from './dto/login-pin.dto';
import { RolesGuard } from './guards/roles.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('tenants/:tenantId/workers')
  listWorkers(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.authService.listWorkersForTenant(tenantId);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login/pin')
  async loginPin(@Body() dto: LoginPinDto) {
    const accessToken = await this.authService.loginWithPin(
      dto.tenantId,
      dto.userId,
      dto.pin,
    );
    return { accessToken };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login/manager')
  async loginManager(@Body() dto: LoginManagerDto) {
    const accessToken = await this.authService.loginWithPassword(
      dto.tenantId,
      dto.email,
      dto.password,
    );
    return { accessToken };
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Get('workers')
  myTenantWorkers(@CurrentUser() user: JwtPayload) {
    return this.authService.listWorkersForTenant(user.tenantId);
  }
}
