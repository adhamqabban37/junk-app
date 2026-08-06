import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../database/entities';
import { ListVehiclesDto } from './dto/list-vehicles.dto';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  // Open to any authenticated role (workers sync intake drafts from the
  // mobile app), same pattern as PartsController's image upload endpoint.
  @Post('intake')
  @UseInterceptors(AnyFilesInterceptor({ storage: memoryStorage() }))
  intake(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, string>,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.vehiclesService.intake(user.tenantId, body, files ?? []);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListVehiclesDto) {
    return this.vehiclesService.list(
      user.tenantId,
      query.crushStatus,
      query.page,
      query.pageSize,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Get(':id')
  detail(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.detail(user.tenantId, id);
  }
}
