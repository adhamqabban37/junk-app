import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantSettings1785628595594 implements MigrationInterface {
  name = 'AddTenantSettings1785628595594';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants"
      ADD COLUMN "settings" jsonb NOT NULL DEFAULT '{"aiConfidenceThreshold": 0.7}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "settings"`);
  }
}
