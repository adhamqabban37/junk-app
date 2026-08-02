import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../database/entities';
import { ListVehiclesDto } from './dto/list-vehicles.dto';
import { VehiclesService } from './vehicles.service';

@UseGuards(RolesGuard)
@Roles(UserRole.MANAGER, UserRole.OWNER)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListVehiclesDto) {
    return this.vehiclesService.list(
      user.tenantId,
      query.crushStatus,
      query.page,
      query.pageSize,
    );
  }

  @Get(':id')
  detail(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.detail(user.tenantId, id);
  }
}
