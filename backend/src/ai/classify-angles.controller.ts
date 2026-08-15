import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClassifyAnglesService } from './classify-angles.service';
import { sniffImageMime } from './image-type';

/**
 * Higher than detect-parts' 12. This is the step where a worker drops in
 * their whole camera roll for the vehicle, so the realistic upper bound is
 * "how many photos did they take walking round the car" rather than "how
 * many scenes are worth analyzing". Still capped, so a stuck client cannot
 * bill an unbounded number of Gemini calls in one request.
 */
const MAX_IMAGES = 24;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

@Controller('ai')
export class ClassifyAnglesController {
  constructor(private readonly classifyAngles: ClassifyAnglesService) {}

  /**
   * Open to any authenticated role, same as POST /ai/detect-parts: this is
   * the worker's intake path. It reads nothing tenant-owned and writes
   * nothing at all, so there is no tenant data for it to leak.
   */
  @Post('classify-vehicle-photos')
  @UseInterceptors(
    FilesInterceptor('files', MAX_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  async classify(@UploadedFiles() files: Express.Multer.File[] | undefined) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }
    // Validated by magic bytes rather than the declared Content-Type, which
    // is untrustworthy in both directions -- often application/octet-stream
    // for a perfectly good photo, and when wrong it makes Gemini reject the
    // call. This is also what stops a non-image ever reaching (and billing)
    // Gemini.
    const nonImage = files.find((f) => sniffImageMime(f.buffer) === null);
    if (nonImage) {
      throw new BadRequestException(
        `Not a supported image: ${nonImage.originalname || 'file'}`,
      );
    }
    return this.classifyAngles.classify(files);
  }
}
