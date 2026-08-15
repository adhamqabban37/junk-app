import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'D' to the ai_grade enum.
 *
 * The grading scale was A/B/C, where C absorbed everything from "a dent" to
 * "shattered". The yard's actual rubric distinguishes those: C is damage
 * beyond cosmetic but still a usable part, D is severe enough that it
 * changes what the part is worth. Collapsing both into C was losing the
 * distinction that matters most for pricing.
 *
 * Purely additive -- no existing row changes, and every historical A/B/C
 * grade stays valid.
 *
 * `ALTER TYPE ... ADD VALUE` is allowed inside a transaction on PostgreSQL
 * 12+ as long as the new value is not *used* in the same transaction, which
 * it isn't here. IF NOT EXISTS makes a re-run harmless.
 */
export class AddGradeD1786230000000 implements MigrationInterface {
  name = 'AddGradeD1786230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "ai_grade" ADD VALUE IF NOT EXISTS 'D'`,
    );
  }

  /**
   * Postgres cannot drop a value from an enum, so the type has to be
   * rebuilt. This deliberately does NOT rewrite existing 'D' rows to
   * something else: the cast below fails loudly if any exist, which is the
   * correct outcome. Silently downgrading real D-graded inventory to C
   * would be data loss disguised as a rollback -- re-grade those parts
   * first if you genuinely need to revert.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_analyses" ALTER COLUMN "grade" TYPE text USING "grade"::text`,
    );
    await queryRunner.query(`DROP TYPE "ai_grade"`);
    await queryRunner.query(
      `CREATE TYPE "ai_grade" AS ENUM ('A', 'B', 'C')`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_analyses" ALTER COLUMN "grade" TYPE "ai_grade" USING "grade"::"ai_grade"`,
    );
  }
}
