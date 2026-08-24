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
import { PartTaxonomy } from '../database/entities/part-taxonomy.entity';
import { Tenant } from '../database/entities/tenant.entity';
import { VehicleAnalysis } from '../database/entities/vehicle-analysis.entity';
import { VehiclePhotoSuggestion } from '../database/entities/vehicle-photo-suggestion.entity';
import { VehiclePhoto } from '../database/entities/vehicle-photo.entity';
import { withTenantContext } from '../database/tenant-context';
import { GRADE_SEVERITY, PartsService } from '../parts/parts.service';
import {
  LocalFileStorage,
  mimetypeFromExtension,
} from '../storage/local-file-storage';
import { GeminiService } from './gemini.service';
import type { GeminiVehicleAnalysis } from './gemini-response.schema';
import { GradingService, type AraDamageInstance } from './grading.service';

@Injectable()
export class AiAnalysisService {
  private readonly modelVersion: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly gemini: GeminiService,
    private readonly storage: LocalFileStorage,
    private readonly partsService: PartsService,
    private readonly grading: GradingService,
    config: ConfigService,
  ) {
    this.modelVersion =
      config.get<string>('GEMINI_MODEL') ?? 'gemini-flash-latest';
  }

  /**
   * Idempotent by default: a BullMQ retry for the same (part_image_id,
   * model_version) that already succeeded skips calling Gemini again
   * entirely (cost, not just correctness) and never writes a second row --
   * the unique index on ai_analyses already guarantees that at the DB
   * level, but checking first avoids a wasted API call on top of it.
   * `force: true` (the Review Queue's "Re-grade" action) deliberately
   * bypasses that check and re-calls Gemini even when a COMPLETE analysis
   * already exists, upserting onto the same row.
   */
  async analyzePartImage(
    tenantId: string,
    partImageId: string,
    force = false,
  ): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const analysisRepo = manager.getRepository(AiAnalysis);
      if (!force) {
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
      }

      const partImage = await manager
        .getRepository(PartImage)
        .findOneOrFail({ where: { id: partImageId } });
      const imageBuffer = await this.storage.read(partImage.url);

      // Sheet-metal parts (fender, door, hood, quarter panel, bumper
      // cover, etc. -- see part-taxonomy.entity.ts's isSheetMetal) get
      // ARA-style damage-unit grading instead of Gemini's own holistic
      // A/B/C judgment: Gemini only detects/itemizes damage here,
      // GradingService is the sole place that turns that into a grade.
      // Everything else keeps today's exact original behavior.
      const part = await manager
        .getRepository(Part)
        .findOneOrFail({ where: { id: partImage.partId } });
      const taxonomy = await manager
        .getRepository(PartTaxonomy)
        .findOne({ where: { id: part.taxonomyId } });

      let grade: AiGrade;
      let damageCodes: string[];
      let confidence: number;
      let rawJson: object;
      let damageUnits: number | null = null;
      let araDamageCodes: AraDamageInstance[] | null = null;

      if (taxonomy?.isSheetMetal) {
        const detection = await this.gemini.analyzeSheetMetalDamage(
          imageBuffer,
          'image/jpeg',
          taxonomy.name,
        );
        const instances: AraDamageInstance[] = detection.damage.map((d) => ({
          location: d.location,
          damageType: d.damage_type,
          severity: d.severity,
          units: this.grading.unitsFor(d.damage_type, d.severity),
        }));
        const graded = this.grading.gradeSheetMetalPart(
          instances,
          detection.assessable,
        );
        grade = graded.grade;
        damageUnits = graded.damageUnits;
        araDamageCodes = instances;
        damageCodes = this.grading.formatDamageCodes(instances);
        confidence = detection.confidence;
        rawJson = detection;
      } else {
        const analysis = await this.gemini.analyzePartImage(
          imageBuffer,
          'image/jpeg',
        );
        grade = analysis.grade as AiGrade;
        damageCodes = analysis.damage_codes;
        confidence = analysis.confidence;
        rawJson = analysis;
      }

      await analysisRepo.upsert(
        {
          tenantId,
          partId: partImage.partId,
          partImageId,
          modelVersion: this.modelVersion,
          rawJson,
          grade,
          damageCodes,
          confidence,
          damageUnits,
          araDamageCodes,
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

      // findOne, not findOneOrFail: this runs inside AiAnalysisProcessor's
      // onFailed event handler, which BullMQ does not wrap in a try/catch --
      // an uncaught error here crashes the entire Node process, not just
      // this one job. Confirmed live: an orphaned job (its PartImage never
      // actually committed, e.g. a dev-server killed mid-transaction) threw
      // EntityNotFoundError here and took the whole server down on every
      // subsequent restart until the stale job was purged from Redis. A
      // missing PartImage means there's nothing left to mark
      // needs-manual-grading -- log and stop, don't crash the server over it.
      const partImage = await manager
        .getRepository(PartImage)
        .findOne({ where: { id: partImageId } });
      if (!partImage) {
        console.error(
          `[AiAnalysisService] handleExhaustedRetries: PartImage ${partImageId} no longer exists, skipping`,
        );
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

  /**
   * Grades a whole vehicle from whatever VehiclePhotos currently exist on
   * it -- 1 photo is enough, this never blocks waiting for more. Always
   * writes a new row rather than upserting: unlike per-part AiAnalysis,
   * the input set (which photos exist) can grow between calls, so each
   * result is a real snapshot, not a duplicate of the same input.
   *
   * Photos are bucketed by their optional `section` tag (front/rear/driver
   * side/etc, or one untagged bucket for photos with no tag) and sent to
   * Gemini as separate calls, one per bucket, instead of one call across
   * the whole gallery. Two reasons: (1) "which photos show the same
   * physical part" is a much more tractable question inside a small,
   * naturally-clustered batch than across a large unordered one, and (2)
   * it lets Gemini's own group_id grouping (see gemini.service.ts's
   * prompt) actually work -- entries sharing a group_id within one
   * bucket's response get merged into a single Part with multiple
   * PartImages, rather than each photo spawning its own Part for the same
   * physical part. The overall vehicle grade/damage codes are then this
   * service's own aggregation across every bucket's result, using the
   * same "worst grade wins, union the damage codes" rule PartsService
   * already uses for a Part with multiple photos (see GRADE_SEVERITY) --
   * deliberately consistent rather than reinventing a second rule.
   */
  async analyzeVehicle(tenantId: string, vehicleId: string): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const photos = await manager
        .getRepository(VehiclePhoto)
        .find({ where: { vehicleId }, order: { createdAt: 'ASC' } });
      if (photos.length === 0) {
        // Nothing to grade yet (e.g. a race with assignPhotos() consuming
        // the last unassigned photo between enqueue and processing) --
        // not an error, just nothing to do.
        return;
      }

      const exteriorTaxonomies = await manager
        .getRepository(PartTaxonomy)
        .find({ where: { isExteriorVisual: true } });
      const taxonomyIdByName = new Map(
        exteriorTaxonomies.map((t): [string, string] => [t.name, t.id]),
      );
      const candidateNames = exteriorTaxonomies.map((t) => t.name);

      const tenant = await manager
        .getRepository(Tenant)
        .findOneOrFail({ where: { id: tenantId } });
      const confidenceThreshold = tenant.settings.aiConfidenceThreshold;

      const buckets = new Map<string, VehiclePhoto[]>();
      for (const photo of photos) {
        const key = photo.section ?? 'untagged';
        const list = buckets.get(key) ?? [];
        list.push(photo);
        buckets.set(key, list);
      }

      const suggestionRepo = manager.getRepository(VehiclePhotoSuggestion);
      const bucketResults: Record<string, GeminiVehicleAnalysis> = {};
      const allDamageCodes = new Set<string>();
      let controlling: { key: string; result: GeminiVehicleAnalysis } | null =
        null;

      for (const [key, bucketPhotos] of buckets) {
        const bucketImages = await Promise.all(
          bucketPhotos.map(async (photo) => {
            const extension = photo.url.split('.').pop() ?? '';
            return {
              buffer: await this.storage.read(photo.url),
              mimeType: mimetypeFromExtension(extension),
            };
          }),
        );

        const result = await this.gemini.analyzeVehiclePhotos(
          bucketImages,
          candidateNames,
        );
        bucketResults[key] = result;
        for (const code of result.damage_codes) allDamageCodes.add(code);
        if (
          !controlling ||
          GRADE_SEVERITY[result.grade as AiGrade] >
            GRADE_SEVERITY[controlling.result.grade as AiGrade]
        ) {
          controlling = { key, result };
        }

        // Group this bucket's suggestions by (Gemini's group_id, part
        // name) -- entries sharing both are the same physical part
        // instance, per this bucket's own response only (group_id numbers
        // mean nothing across separate buckets/calls). The name is
        // included defensively in the key in case a response ever groups
        // two different part names under one id despite the prompt.
        const byGroup = new Map<
          string,
          {
            photo: VehiclePhoto;
            image: (typeof bucketImages)[number];
            confidence: number;
          }[]
        >();
        for (const suggestion of result.photo_suggestions) {
          const photo = bucketPhotos[suggestion.photo_index];
          if (!photo) continue; // Gemini returned an out-of-range index -- ignore rather than crash.
          if (!suggestion.suggested_part) continue; // Defensive -- the prompt no longer asks for null entries, but never trust that blindly.
          const taxonomyId = taxonomyIdByName.get(suggestion.suggested_part);
          if (!taxonomyId) continue; // Untrusted free-text name that didn't match a real candidate.

          const existing = await suggestionRepo.findOne({
            where: { vehiclePhotoId: photo.id, taxonomyId },
          });
          if (existing) {
            // Already seen this exact (photo, part) pairing on an earlier
            // run -- refresh the confidence, but never re-create a Part
            // just because it was suggested again (already handled,
            // either as a real Part or a still-below-threshold hint the
            // manager can still assign manually). This also means a
            // group with a mix of new and already-seen photos only
            // groups the new ones together -- the already-seen photo's
            // own Part/hint, from whichever earlier run produced it, is
            // left exactly as it was.
            await suggestionRepo.update(
              { id: existing.id },
              { confidence: suggestion.confidence },
            );
            continue;
          }

          await suggestionRepo.save(
            suggestionRepo.create({
              tenantId,
              vehiclePhotoId: photo.id,
              taxonomyId,
              confidence: suggestion.confidence,
            }),
          );

          if (suggestion.confidence < confidenceThreshold) continue;
          const groupKey = `${suggestion.group_id}:${taxonomyId}`;
          const group = byGroup.get(groupKey) ?? [];
          group.push({
            photo,
            image: bucketImages[suggestion.photo_index],
            confidence: suggestion.confidence,
          });
          byGroup.set(groupKey, group);
        }

        for (const [groupKey, group] of byGroup) {
          if (group.length === 0) continue;
          const taxonomyId = groupKey.split(':')[1];
          const part = await manager.getRepository(Part).save(
            manager.getRepository(Part).create({
              tenantId,
              vehicleId,
              taxonomyId,
              status: PartStatus.PENDING_AI,
            }),
          );
          // Every photo in the group becomes its own PartImage on the
          // same Part -- reuses the already-read bytes instead of
          // re-reading from storage. addImageInTransaction enqueues the
          // normal per-image grading job for each one; PartsService's own
          // aggregation (worst grade wins, union damage codes) already
          // combines them into the Part's displayed grade once graded --
          // no new grading call needed here.
          for (const { image } of group) {
            await this.partsService.addImageInTransaction(
              manager,
              tenantId,
              part.id,
              { buffer: image.buffer, mimetype: image.mimeType },
            );
          }
        }
      }

      // controlling is guaranteed non-null: buckets is never empty (built
      // from photos, and we already returned above if photos was empty).
      await manager.getRepository(VehicleAnalysis).save(
        manager.getRepository(VehicleAnalysis).create({
          tenantId,
          vehicleId,
          modelVersion: this.modelVersion,
          rawJson: { buckets: bucketResults },
          grade: controlling!.result.grade as AiGrade,
          damageCodes: [...allDamageCodes],
          confidence: controlling!.result.confidence,
          photoCount: photos.length,
          status: AiAnalysisStatus.COMPLETE,
        }),
      );
    });
  }

  /**
   * Called once a vehicle-analysis BullMQ job's retry budget is fully
   * exhausted -- mirrors handleExhaustedRetries(), but for the whole-vehicle
   * pipeline. Writes a FAILED row so the dashboard can show "grading
   * failed" instead of silently showing nothing.
   */
  async handleVehicleAnalysisExhaustedRetries(
    tenantId: string,
    vehicleId: string,
  ): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const photoCount = await manager
        .getRepository(VehiclePhoto)
        .count({ where: { vehicleId } });

      await manager.getRepository(VehicleAnalysis).save(
        manager.getRepository(VehicleAnalysis).create({
          tenantId,
          vehicleId,
          modelVersion: this.modelVersion,
          rawJson: null,
          grade: null,
          damageCodes: [],
          confidence: null,
          photoCount,
          status: AiAnalysisStatus.FAILED,
        }),
      );
    });
  }
}
