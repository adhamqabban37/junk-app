import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backs the idempotency guard on POST /vehicles/intake: the mobile app's
 * sync retries a `sync_failed` draft, so a request that succeeded
 * server-side but whose response was lost must not create a duplicate
 * vehicle+parts on retry. Nullable because vehicles created any other way
 * (there are none yet, but the column shouldn't force one) have no draft.
 * Partial unique index (not a column-level UNIQUE) so multiple vehicles can
 * each have a NULL value without colliding.
 */
export class AddVehicleIntakeDraftId1785816446099
  implements MigrationInterface
{
  name = 'AddVehicleIntakeDraftId1785816446099';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicles"
      ADD COLUMN "intake_draft_id" varchar(64)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_vehicles_tenant_intake_draft_id"
      ON "vehicles" ("tenant_id", "intake_draft_id")
      WHERE "intake_draft_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_vehicles_tenant_intake_draft_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" DROP COLUMN "intake_draft_id"`,
    );
  }
}
