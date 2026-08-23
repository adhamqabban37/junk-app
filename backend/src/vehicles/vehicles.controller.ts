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
import { AddVehiclePhotosDto } from './dto/add-vehicle-photos.dto';
import { AssignVehiclePhotosDto } from './dto/assign-vehicle-photos.dto';
import { CreateManualPartDto } from './dto/create-manual-part.dto';
import { ListVehiclesDto } from './dto/list-vehicles.dto';
import { VehicleIntakeDto } from './dto/vehicle-intake.dto';
import { VehiclesService } from './vehicles.service';

// Any authenticated role can reach a worker-facing route below (mirrors
// PartsController.uploadImage's shape) -- these override the class-level
// MANAGER/OWNER-only restriction (RolesGuard reads handler metadata before
// class metadata). Kept as a named constant since it's now used on several
// handlers, not just `intake`.
const ANY_ROLE = [UserRole.WORKER, UserRole.MANAGER, UserRole.OWNER];

@UseGuards(RolesGuard)
@Roles(UserRole.MANAGER, UserRole.OWNER)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Roles(...ANY_ROLE)
  @Post('intake')
  @UseInterceptors(AnyFilesInterceptor({ storage: memoryStorage() }))
  intake(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VehicleIntakeDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.vehiclesService.intake(
      user.tenantId,
      user.sub,
      dto,
      files ?? [],
    );
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

  // The mobile home screen's "Your vehicles" list -- must be registered
  // before the `:id` route below, or Nest would match the literal path
  // "mine" as an `id` param instead.
  @Roles(...ANY_ROLE)
  @Get('mine')
  mine(@CurrentUser() user: JwtPayload, @Query() query: ListVehiclesDto) {
    return this.vehiclesService.mine(
      user.tenantId,
      user.sub,
      query.page,
      query.pageSize,
    );
  }

  @Roles(...ANY_ROLE)
  @Get(':id')
  detail(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.detail(user.tenantId, id);
  }

  @Roles(...ANY_ROLE)
  @Get(':id/photos')
  listPhotos(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.listPhotos(user.tenantId, id);
  }

  // Lets a worker attach more raw photos to a vehicle they already sent,
  // any time afterward, rather than only ever at initial intake.
  @Roles(...ANY_ROLE)
  @Post(':id/photos')
  @UseInterceptors(AnyFilesInterceptor({ storage: memoryStorage() }))
  addPhotos(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddVehiclePhotosDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.vehiclesService.addPhotos(
      user.tenantId,
      id,
      files ?? [],
      dto.section,
    );
  }

  @Roles(...ANY_ROLE)
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

  // Manager/owner only (class-level default) -- lets a manager add a part
  // the yard knows it has but that has no photo at all, e.g. an alternator
  // still inside an unphotographed engine bay.
  @HttpCode(HttpStatus.OK)
  @Post(':id/parts')
  createManualPart(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateManualPartDto,
  ) {
    return this.vehiclesService.createManualPart(
      user.tenantId,
      id,
      dto.taxonomyId,
    );
  }
}
