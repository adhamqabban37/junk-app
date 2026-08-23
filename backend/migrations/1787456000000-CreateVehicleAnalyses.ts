import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVehicleAnalyses1787456000000 implements MigrationInterface {
  name = 'CreateVehicleAnalyses1787456000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Reuses the existing "ai_grade"/"ai_analysis_status" enum types
    // (InitialSchema) -- same value sets, no need for new Postgres types.
    await queryRunner.query(`
      CREATE TABLE "vehicle_analyses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
        "model_version" varchar(100) NOT NULL,
        "raw_json" jsonb,
        "grade" "ai_grade",
        "damage_codes" text[] NOT NULL DEFAULT '{}',
        "confidence" numeric(5,4),
        "photo_count" int NOT NULL,
        "status" "ai_analysis_status" NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vehicle_analyses_tenant_id" ON "vehicle_analyses" ("tenant_id")`,
    );
    // No uniqueness constraint here (unlike ai_analyses' per-image
    // uniqueness) -- a new row is deliberately written every time the
    // vehicle's photo set changes; "latest by created_at" is the current
    // grade. This index just makes that latest-row lookup fast.
    await queryRunner.query(
      `CREATE INDEX "idx_vehicle_analyses_vehicle_created" ON "vehicle_analyses" ("vehicle_id", "created_at" DESC)`,
    );

    await queryRunner.query(
      `ALTER TABLE "vehicle_analyses" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicle_analyses" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON "vehicle_analyses"
      USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicle_analyses" CASCADE`);
  }
}
