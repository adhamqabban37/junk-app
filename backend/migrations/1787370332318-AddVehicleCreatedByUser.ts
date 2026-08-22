import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVehicleCreatedByUser1787370332318
  implements MigrationInterface
{
  name = 'AddVehicleCreatedByUser1787370332318';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable + ON DELETE SET NULL: a worker user being removed later must
    // never cascade-delete the vehicles they intook -- that data outlives
    // the account. Seeded/pre-existing vehicles (and any future non-worker
    // creation path) simply have no creator on record.
    await queryRunner.query(`
      ALTER TABLE "vehicles"
      ADD COLUMN "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vehicles_created_by_user_id" ON "vehicles" ("created_by_user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_vehicles_created_by_user_id"`);
    await queryRunner.query(
      `ALTER TABLE "vehicles" DROP COLUMN "created_by_user_id"`,
    );
  }
}
