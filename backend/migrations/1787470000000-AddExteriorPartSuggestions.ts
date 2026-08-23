import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExteriorPartSuggestions1787470000000
  implements MigrationInterface
{
  name = 'AddExteriorPartSuggestions1787470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "part_taxonomies"
      ADD COLUMN "is_exterior_visual" boolean NOT NULL DEFAULT false
    `);

    // Nullable, SET NULL on delete: a photo's AI suggestion is a hint, not
    // a hard dependency -- if a taxonomy entry is ever removed, photos that
    // referenced it should just lose the suggestion, not be blocked/cascaded.
    await queryRunner.query(`
      ALTER TABLE "vehicle_photos"
      ADD COLUMN "suggested_taxonomy_id" uuid REFERENCES "part_taxonomies"("id") ON DELETE SET NULL,
      ADD COLUMN "suggested_confidence" numeric(5,4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicle_photos"
      DROP COLUMN "suggested_taxonomy_id",
      DROP COLUMN "suggested_confidence"
    `);
    await queryRunner.query(`
      ALTER TABLE "part_taxonomies" DROP COLUMN "is_exterior_visual"
    `);
  }
}
