import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the human-corrected condition off `ai_analyses` and onto `parts`.
 *
 * Until now a manager's correction was written *onto the AiAnalysis row
 * itself* so that Inventory, the Review Queue and the CSV export showed the
 * corrected value. That worked for display, but it meant the row no longer
 * recorded what the model actually predicted: correct a field twice and the
 * intermediate prediction was gone, and every corrected row's
 * `grade`/`damage_codes`/`confidence` were a human's answer wearing the
 * model's name.
 *
 * That matters more here than in most projects. `human_corrections` joins
 * back to `ai_analyses` for the model version and the confidence at
 * prediction time, so a mutated analysis row silently corrupts the training
 * context of every correction attached to it -- the exact dataset CLAUDE.md
 * rule 6 exists to protect.
 *
 * After this migration `ai_analyses` is append-only (see the entity's class
 * comment) and these columns carry the human's answer. Readers resolve the
 * two per field via effectiveCondition() (parts/effective-condition.ts).
 *
 * Deliberately nullable rather than backfilled: NULL means "no human has
 * ruled on this field", which is genuinely different from a human setting a
 * grade that happens to equal the AI's. Existing corrected rows keep their
 * mutated values on ai_analyses -- this migration does not attempt to
 * un-mix them, because the pre-correction value is only recoverable for
 * fields that were actually corrected (via human_corrections.original_value)
 * and guessing at the rest would fabricate history. Corrections made from
 * here on are clean.
 */
export class AddPartFinalCondition1786320000000 implements MigrationInterface {
  name = 'AddPartFinalCondition1786320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "parts"
        ADD COLUMN "final_grade" "ai_grade",
        ADD COLUMN "final_damage_codes" text[],
        ADD COLUMN "final_confidence" numeric(5,4),
        ADD COLUMN "condition_set_by_user_id" uuid REFERENCES "users"("id"),
        ADD COLUMN "condition_set_at" timestamptz
    `);

    // Which prompt produced a prediction is part of its provenance: the
    // rubric has already been rewritten once (2026-08-08), so two rows with
    // the same model_version can come from materially different
    // instructions. Nullable because every existing row predates the field
    // and no honest value can be backfilled.
    await queryRunner.query(
      `ALTER TABLE "ai_analyses" ADD COLUMN "prompt_version" varchar(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_analyses" DROP COLUMN "prompt_version"`,
    );
    await queryRunner.query(`
      ALTER TABLE "parts"
        DROP COLUMN "condition_set_at",
        DROP COLUMN "condition_set_by_user_id",
        DROP COLUMN "final_confidence",
        DROP COLUMN "final_damage_codes",
        DROP COLUMN "final_grade"
    `);
  }
}
