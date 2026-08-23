import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVehiclePhotoSuggestions1787480000000
  implements MigrationInterface
{
  name = 'CreateVehiclePhotoSuggestions1787480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Replaces vehicle_photos.suggested_taxonomy_id/suggested_confidence --
    // a single photo can show more than one part (headlight + bumper +
    // fender in one frame), so a single-column hint can't hold it. One row
    // per (photo, distinct suggested part) pair instead.
    await queryRunner.query(`
      CREATE TABLE "vehicle_photo_suggestions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "vehicle_photo_id" uuid NOT NULL REFERENCES "vehicle_photos"("id") ON DELETE CASCADE,
        "taxonomy_id" uuid NOT NULL REFERENCES "part_taxonomies"("id") ON DELETE CASCADE,
        "confidence" numeric(5,4) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vehicle_photo_suggestions_tenant_id" ON "vehicle_photo_suggestions" ("tenant_id")`,
    );
    // The dedup key: re-suggesting the same part for the same photo on a
    // later analysis run updates confidence via this constraint rather than
    // creating a duplicate row -- and "does a row already exist" is also
    // the auto-create idempotency gate (see AiAnalysisService.analyzeVehicle).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_vehicle_photo_suggestions_photo_taxonomy" ON "vehicle_photo_suggestions" ("vehicle_photo_id", "taxonomy_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "vehicle_photo_suggestions" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicle_photo_suggestions" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON "vehicle_photo_suggestions"
      USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    `);

    await queryRunner.query(`
      ALTER TABLE "vehicle_photos"
      DROP COLUMN "suggested_taxonomy_id",
      DROP COLUMN "suggested_confidence"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicle_photos"
      ADD COLUMN "suggested_taxonomy_id" uuid REFERENCES "part_taxonomies"("id") ON DELETE SET NULL,
      ADD COLUMN "suggested_confidence" numeric(5,4)
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "vehicle_photo_suggestions" CASCADE`,
    );
  }
}
