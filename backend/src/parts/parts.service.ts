import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  AI_ANALYSIS_QUEUE,
  AiAnalysisJobData,
} from '../ai/ai-analysis.processor';
import { Part } from '../database/entities/part.entity';
import { PartImage } from '../database/entities/part-image.entity';
import { withTenantContext } from '../database/tenant-context';
import { LocalFileStorage } from '../storage/local-file-storage';

@Injectable()
export class PartsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: LocalFileStorage,
    @InjectQueue(AI_ANALYSIS_QUEUE)
    private readonly aiQueue: Queue<AiAnalysisJobData>,
  ) {}

  async addImage(
    tenantId: string,
    partId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<PartImage> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const part = await manager
        .getRepository(Part)
        .findOne({ where: { id: partId } });
      if (!part) {
        throw new NotFoundException('Part not found');
      }

      const partImageId = randomUUID();
      const extension = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const relativePath = await this.storage.save(
        `${tenantId}/${partId}/${partImageId}.${extension}`,
        file.buffer,
      );

      const partImage = await manager.getRepository(PartImage).save(
        manager.getRepository(PartImage).create({
          id: partImageId,
          tenantId,
          partId,
          url: relativePath,
          qualityFlags: null,
        }),
      );

      // Non-blocking per CLAUDE.md rule 4: the upload request returns as
      // soon as the image is stored, grading happens asynchronously.
      // Conservative retry budget -- see AiAnalysisProcessor's concurrency
      // comment re: Gemini's exact rate limit not being pinned down yet.
      await this.aiQueue.add(
        'analyze',
        { tenantId, partImageId: partImage.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );

      return partImage;
    });
  }
}
