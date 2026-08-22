import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../database/entities';
import { AssignVehiclePhotosDto } from './dto/assign-vehicle-photos.dto';
import { ListVehiclesDto } from './dto/list-vehicles.dto';
import { VehicleIntakeDto } from './dto/vehicle-intake.dto';
import { VehiclesService } from './vehicles.service';

@UseGuards(RolesGuard)
@Roles(UserRole.MANAGER, UserRole.OWNER)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  // Overrides the class-level MANAGER/OWNER-only restriction (RolesGuard
  // reads handler metadata before class metadata) -- this is the mobile
  // worker's own sync endpoint, same "any authenticated role" shape as
  // PartsController.uploadImage.
  @Roles(UserRole.WORKER, UserRole.MANAGER, UserRole.OWNER)
  @Post('intake')
  @UseInterceptors(AnyFilesInterceptor({ storage: memoryStorage() }))
  intake(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VehicleIntakeDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.vehiclesService.intake(user.tenantId, dto, files ?? []);
  }

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

  @Get(':id/photos')
  listPhotos(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.listPhotos(user.tenantId, id);
  }

  @Get(':id/photos/:photoId/file')
  async photoFile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.vehiclesService.getPhotoFile(
      user.tenantId,
      id,
      photoId,
    );
    res.set({ 'Content-Type': file.contentType });
    return new StreamableFile(file.buffer);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/photos/assign')
  assign(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignVehiclePhotosDto,
  ) {
    return this.vehiclesService.assignPhotos(
      user.tenantId,
      id,
      dto.photoIds,
      dto.taxonomyId,
    );
  }
}
