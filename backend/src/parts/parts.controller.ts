import {
  BadRequestException,
  Body,
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
  StreamableFile,
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
import { MergePartsDto } from './dto/merge-parts.dto';
import { SetManualGradeDto } from './dto/set-manual-grade.dto';
import { SetPartPriceDto } from './dto/set-part-price.dto';
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

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListPartsDto) {
    return this.partsService.list(
      user.tenantId,
      query.status,
      query.page,
      query.pageSize,
      query.vehicleId,
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
  @Get(':id/images/:imageId/file')
  async imageFile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.partsService.getImageFile(
      user.tenantId,
      id,
      imageId,
    );
    res.set({ 'Content-Type': file.contentType });
    return new StreamableFile(file.buffer);
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

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @Post(':id/manual-grade')
  async setManualGrade(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetManualGradeDto,
  ) {
    await this.partsService.recordManualGrade(user.tenantId, id, body.grade);
    return { status: 'graded', grade: body.grade };
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @Post(':id/regrade')
  async regrade(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.partsService.regrade(user.tenantId, id);
    return { status: 'regrading' };
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @Post(':id/merge')
  async merge(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MergePartsDto,
  ) {
    await this.partsService.merge(user.tenantId, id, body.sourcePartIds);
    return this.partsService.detail(user.tenantId, id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @Post(':id/price')
  async setPrice(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPartPriceDto,
  ) {
    await this.partsService.setPrice(user.tenantId, id, body.price);
    return { status: 'priced', price: body.price };
  }
}
