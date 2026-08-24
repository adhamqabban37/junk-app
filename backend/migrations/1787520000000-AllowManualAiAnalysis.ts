import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowManualAiAnalysis1787520000000
  implements MigrationInterface
{
  name = 'AllowManualAiAnalysis1787520000000';

  /**
   * Lets a manually-added, photo-less Part (e.g. an alternator inside the
   * engine no picture ever shows -- PartsService.createManualInTransaction())
   * actually be graded and approved: today every grade lives on an
   * ai_analyses row, and part_image_id was NOT NULL, so there was no way
   * to attach one to a Part with zero PartImages. Purely additive -- every
   * existing row already has a real part_image_id and is unaffected; only
   * a new manually-entered grade (modelVersion: 'manual') will ever have
   * a null one.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_analyses" ALTER COLUMN "part_image_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any manual (null part_image_id) rows created since up() would violate
    // the constraint being restored -- clear them out first rather than
    // leaving the down migration to fail on real data.
    await queryRunner.query(
      `DELETE FROM "ai_analyses" WHERE "part_image_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_analyses" ALTER COLUMN "part_image_id" SET NOT NULL`,
    );
  }
}
