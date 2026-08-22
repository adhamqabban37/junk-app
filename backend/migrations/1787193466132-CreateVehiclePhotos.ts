import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVehiclePhotos1787193466132 implements MigrationInterface {
  name = 'CreateVehiclePhotos1787193466132';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vehicle_photos" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
        "url" varchar(2048) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vehicle_photos_tenant_id" ON "vehicle_photos" ("tenant_id")`,
    );

    // Same tenant-isolation RLS shape as every other tenant-scoped table --
    // see InitialSchema's tenantScopedTables loop for the full rationale.
    await queryRunner.query(
      `ALTER TABLE "vehicle_photos" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicle_photos" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON "vehicle_photos"
      USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicle_photos" CASCADE`);
  }
}
