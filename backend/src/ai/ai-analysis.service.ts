import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  AiAnalysis,
  AiAnalysisStatus,
  AiGrade,
} from '../database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../database/entities/part.entity';
import { PartImage } from '../database/entities/part-image.entity';
import { withTenantContext } from '../database/tenant-context';
import { LocalFileStorage } from '../storage/local-file-storage';
import { GeminiService, PART_GRADING_PROMPT_VERSION } from './gemini.service';

@Injectable()
export class AiAnalysisService {
  private readonly modelVersion: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly gemini: GeminiService,
    private readonly storage: LocalFileStorage,
    config: ConfigService,
  ) {
    this.modelVersion =
      config.get<string>('GEMINI_MODEL') ?? 'gemini-flash-latest';
  }

  /**
   * Idempotent: a BullMQ retry for the same (part_image_id, model_version)
   * that already succeeded skips calling Gemini again entirely (cost, not
   * just correctness) and never writes a second row -- the unique index on
   * ai_analyses already guarantees that at the DB level, but checking first
   * avoids a wasted API call on top of it.
   */
  async analyzePartImage(tenantId: string, partImageId: string): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const analysisRepo = manager.getRepository(AiAnalysis);
      const already = await analysisRepo.findOne({
        where: {
          partImageId,
          modelVersion: this.modelVersion,
          status: AiAnalysisStatus.COMPLETE,
        },
      });
      if (already) {
        return;
      }

      const partImage = await manager
        .getRepository(PartImage)
        .findOneOrFail({ where: { id: partImageId } });
      const imageBuffer = await this.storage.read(partImage.url);
      const analysis = await this.gemini.analyzePartImage(
        imageBuffer,
        'image/jpeg',
      );

      await analysisRepo.upsert(
        {
          tenantId,
          partId: partImage.partId,
          partImageId,
          modelVersion: this.modelVersion,
          promptVersion: PART_GRADING_PROMPT_VERSION,
          rawJson: analysis,
          grade: analysis.grade as AiGrade,
          damageCodes: analysis.damage_codes,
          confidence: analysis.confidence,
          status: AiAnalysisStatus.COMPLETE,
        },
        ['partImageId', 'modelVersion'],
      );

      await manager
        .getRepository(Part)
        .update(
          { id: partImage.partId },
          { status: PartStatus.PENDING_REVIEW },
        );
    });
  }

  /**
   * Called once a BullMQ job's retry budget is fully exhausted (see
   * AiAnalysisProcessor's onFailed handler) -- a yard worker's shift must
   * never block on Gemini availability, so the Part becomes gradable by a
   * human instead of the job silently stalling.
   */
  async handleExhaustedRetries(
    tenantId: string,
    partImageId: string,
  ): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const analysisRepo = manager.getRepository(AiAnalysis);
      const alreadyComplete = await analysisRepo.findOne({
        where: {
          partImageId,
          modelVersion: this.modelVersion,
          status: AiAnalysisStatus.COMPLETE,
        },
      });
      if (alreadyComplete) {
        // A later retry succeeded before this (necessarily earlier) failure
        // was handled -- never downgrade a completed analysis back to failed.
        return;
      }

      // findOne, not findOneOrFail: by the time a job's retries are spent
      // the image can legitimately be gone (its part, or its whole tenant,
      // was deleted while the job was in flight). There is nothing left to
      // escalate to manual grading, and throwing here propagates out of
      // onFailed -- a fire-and-forget BullMQ event handler -- which means an
      // unhandled rejection that kills the entire API process. That is not
      // hypothetical: it took the dev server down, and it is the real cause
      // behind the "BullMQ teardown flake" that has been failing e2e runs
      // (a suite deletes its tenant in afterAll while one of its jobs is
      // still retrying on the shared Redis queue).
      const partImage = await manager
        .getRepository(PartImage)
        .findOne({ where: { id: partImageId } });
      if (!partImage) {
        return;
      }

      await analysisRepo.upsert(
        {
          tenantId,
          partId: partImage.partId,
          partImageId,
          modelVersion: this.modelVersion,
          rawJson: null,
          grade: null,
          damageCodes: [],
          confidence: null,
          status: AiAnalysisStatus.FAILED,
        },
        ['partImageId', 'modelVersion'],
      );

      await manager
        .getRepository(Part)
        .update(
          { id: partImage.partId },
          { status: PartStatus.NEEDS_MANUAL_GRADING },
        );
    });
  }
}
