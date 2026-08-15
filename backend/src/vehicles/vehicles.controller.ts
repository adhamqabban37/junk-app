import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AnyFilesInterceptor,
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { sniffImageMime } from '../ai/image-type';
import { UserRole } from '../database/entities';
import { ListVehiclesDto } from './dto/list-vehicles.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehiclesService } from './vehicles.service';

/**
 * Same bounds as POST /ai/detect-parts: a walkaround is 4-8 photos, and the
 * cap is what stops a stuck client billing a hundred Gemini calls in one
 * request.
 */
const MAX_SCAN_IMAGES = 12;
const MAX_SCAN_IMAGE_BYTES = 12 * 1024 * 1024;

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

  // Adds another exterior angle to a vehicle that has already been synced.
  // Open to any authenticated role, same as POST /parts/:partId/images: the
  // whole point is letting the attendant who is standing at the car re-shoot
  // a dark or missed angle days after intake. Exterior photos are not
  // AI-analyzed (only part photos are), so nothing is enqueued here.
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async addImage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, string>,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const image = await this.vehiclesService.addImage(
      user.tenantId,
      id,
      body.angle,
      file,
    );
    return { id: image.id, angle: image.angle, url: image.url };
  }

  @Get(':id/images/:imageId/file')
  async getImageFile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType } = await this.vehiclesService.getImageFile(
      user.tenantId,
      id,
      imageId,
    );
    // Sent directly rather than returned: Nest would JSON-serialize a
    // Buffer return value instead of writing raw bytes.
    res.set('Content-Type', contentType).send(buffer);
  }

  // Readable by any authenticated role -- workers need to find a previously
  // intaken vehicle to add photos to. RLS still scopes every query to the
  // caller's own tenant.
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

  // Manager/owner only: acquisition cost is commercially sensitive, and a
  // worker on the yard floor has no reason to be editing what a car cost.
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Patch(':id')
  updateDetails(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateVehicleDto,
  ) {
    return this.vehiclesService.updateDetails(user.tenantId, id, body);
  }

  /**
   * Multi-part AI scan of a vehicle that already exists: identify every
   * resellable part visible in the photos, grade each, and file them.
   *
   * Accepts either uploaded `files`, or `useExistingImages=true` to re-run
   * over the walkaround photos already stored on the vehicle -- those are
   * never AI-analysed on upload, so for most vehicles this is the first
   * time anything has looked at them.
   *
   * Manager/owner only: it writes inventory. Synchronous rather than queued,
   * the same deliberate exception to CLAUDE.md rule 4 that
   * POST /ai/detect-parts already makes -- the human is sitting there
   * waiting for the result, and a fire-and-forget job with no feedback is
   * worse for them than a 20-40s request. MAX_SCAN_IMAGES bounds it.
   */
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Post(':id/scan')
  @UseInterceptors(
    FilesInterceptor('files', MAX_SCAN_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SCAN_IMAGE_BYTES },
    }),
  )
  scan(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, string> | undefined,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    // `body` is genuinely undefined for a request with no multipart body at
    // all -- reading through it unguarded turned an obvious 400 into a 500.
    const useExisting = body?.useExistingImages === 'true';
    const uploaded = files ?? [];

    if (!useExisting && uploaded.length === 0) {
      throw new BadRequestException(
        'Upload at least one photo, or set useExistingImages=true',
      );
    }
    // Magic bytes, not the declared Content-Type -- see sniffImageMime().
    // This is also what stops a non-image ever reaching (and billing) Gemini.
    const nonImage = uploaded.find((f) => sniffImageMime(f.buffer) === null);
    if (nonImage) {
      throw new BadRequestException(
        `Not a supported image: ${nonImage.originalname || 'file'}`,
      );
    }

    return this.vehiclesService.scan(user.tenantId, id, uploaded, useExisting);
  }

  // "This vehicle was added by mistake." Manager/owner only -- deliberately
  // NOT open to every authenticated role like the read and photo endpoints
  // above, because this is irreversible and takes the vehicle's parts, its
  // photos, their AI grades and the human corrections on them with it. See
  // VehiclesService.remove() for the full blast radius.
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.remove(user.tenantId, id);
  }
}
