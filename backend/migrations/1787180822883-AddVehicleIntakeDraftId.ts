import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVehicleIntakeDraftId1787180822883
  implements MigrationInterface
{
  name = 'AddVehicleIntakeDraftId1787180822883';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicles" ADD COLUMN "intake_draft_id" varchar(255)
    `);
    // Partial unique index (NULLs excluded) so /vehicles/intake can dedupe a
    // retried sync (same draftId) without a matching unique constraint
    // blocking every pre-existing/seeded vehicle, which has no draft id.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_vehicles_tenant_intake_draft"
      ON "vehicles" ("tenant_id", "intake_draft_id")
      WHERE "intake_draft_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "uq_vehicles_tenant_intake_draft"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" DROP COLUMN "intake_draft_id"`,
    );
  }
}
