import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../database/entities';
import { ListPartsDto } from './dto/list-parts.dto';
import { PartsService } from './parts.service';

@Controller('parts')
export class PartsController {
  constructor(private readonly partsService: PartsService) {}

  // Open to any authenticated role (workers upload during intake, Phase 3).
  @Post(':partId/images')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadImage(
    @Param('partId', ParseUUIDPipe) partId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const partImage = await this.partsService.addImage(
      user.tenantId,
      partId,
      file,
    );
    return { id: partImage.id, url: partImage.url };
  }

  // Manager/owner only, same as detail()/list() -- this is the Inventory
  // and Review Queue UI's image viewer, not part of the worker intake path.
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Get(':partId/images/:imageId/file')
  async getImageFile(
    @CurrentUser() user: JwtPayload,
    @Param('partId', ParseUUIDPipe) partId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType } = await this.partsService.getImageFile(
      user.tenantId,
      partId,
      imageId,
    );
    // No passthrough: Nest's default handling would JSON-serialize the
    // Buffer return value instead of sending raw bytes, so the response
    // must be sent directly here.
    res.set('Content-Type', contentType).send(buffer);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListPartsDto) {
    return this.partsService.list(
      user.tenantId,
      query.status,
      query.page,
      query.pageSize,
    );
  }

  // Declared before ':id' -- Nest matches routes in registration order, and
  // 'export.csv' would otherwise fall into the :id/ParseUUIDPipe handler
  // and 400 as an invalid UUID.
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="inventory-export.csv"')
  @Get('export.csv')
  exportCsv(@CurrentUser() user: JwtPayload): Promise<string> {
    return this.partsService.exportCsv(user.tenantId);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Get(':id')
  detail(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.partsService.detail(user.tenantId, id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  async approve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.partsService.approve(user.tenantId, id);
    return { status: 'approved' };
  }
}
