import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CorrectionsService } from './corrections.service';
import { RecordCorrectionDto } from './dto/record-correction.dto';

@Controller('ai-analyses')
export class CorrectionsController {
  constructor(private readonly correctionsService: CorrectionsService) {}

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.OWNER)
  @Post(':aiAnalysisId/corrections')
  async recordCorrection(
    @Param('aiAnalysisId', ParseUUIDPipe) aiAnalysisId: string,
    @Body() dto: RecordCorrectionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const correction = await this.correctionsService.recordCorrection(
      user.tenantId,
      aiAnalysisId,
      user.sub,
      dto.field,
      dto.correctedValue,
    );
    return { id: correction.id };
  }
}
