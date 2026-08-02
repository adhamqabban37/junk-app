import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
