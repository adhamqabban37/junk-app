import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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
}
