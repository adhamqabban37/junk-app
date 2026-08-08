import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DetectPartsService } from './detect-parts.service';
import { sniffImageMime } from './image-type';

/**
 * Upper bound on one batch. A yard walkaround is 4-8 photos; this leaves
 * headroom without letting a stuck client bill a hundred Gemini calls in a
 * single request.
 */
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

@Controller('ai')
export class DetectPartsController {
  constructor(private readonly detectParts: DetectPartsService) {}

  /**
   * Open to any authenticated role: this is the worker's bulk intake path,
   * same access level as POST /parts/:partId/images. It is deliberately
   * NOT tenant-scoped in its body -- it reads only shared reference data
   * (part_taxonomies) and writes nothing, so there is no tenant-owned row
   * for it to leak.
   */
  @Post('detect-parts')
  @UseInterceptors(
    FilesInterceptor('files', MAX_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  async detect(@UploadedFiles() files: Express.Multer.File[] | undefined) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }
    // Validated by magic bytes, not the declared Content-Type -- see
    // sniffImageMime() for why the header is not trustworthy in either
    // direction. This is also what keeps a non-image from ever reaching
    // (and billing) Gemini.
    const nonImage = files.find((f) => sniffImageMime(f.buffer) === null);
    if (nonImage) {
      throw new BadRequestException(
        `Not a supported image: ${nonImage.originalname || 'file'}`,
      );
    }
    return this.detectParts.detect(files);
  }
}
