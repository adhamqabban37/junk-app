import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAraPartGrading1787510000000 implements MigrationInterface {
  name = 'AddAraPartGrading1787510000000';

  /**
   * ARA/Car-Part.com-style A/B/C/X part grading (see
   * backend/src/ai/grading.service.ts). Purely additive: a new enum value,
   * two new nullable columns, and one new taxonomy flag defaulting to
   * false -- every existing row keeps its exact current grade/display
   * with no rewrite, and only sheet-metal-flagged parts ever populate the
   * two new ai_analyses columns going forward.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres requires ALTER TYPE ... ADD VALUE to run outside the value's
    // own transaction before it can be used in a query -- fine here since
    // nothing in this same migration reads or writes 'X' data.
    await queryRunner.query(
      `ALTER TYPE "ai_grade" ADD VALUE IF NOT EXISTS 'X'`,
    );

    await queryRunner.query(`
      ALTER TABLE "ai_analyses"
      ADD COLUMN "damage_units" numeric(6,2),
      ADD COLUMN "ara_damage_codes" jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "part_taxonomies"
      ADD COLUMN "is_sheet_metal" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "part_taxonomies" DROP COLUMN "is_sheet_metal"`,
    );
    await queryRunner.query(`
      ALTER TABLE "ai_analyses"
      DROP COLUMN "damage_units",
      DROP COLUMN "ara_damage_codes"
    `);
    // Postgres has no DROP VALUE for enums -- 'X' stays a valid (if
    // unused-by-the-app-after-rollback) ai_grade value. Harmless no-op,
    // same as every other additive-enum-value migration pattern.
  }
}
