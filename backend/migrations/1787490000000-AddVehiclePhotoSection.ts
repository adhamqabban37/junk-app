import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVehiclePhotoSection1787490000000
  implements MigrationInterface
{
  name = 'AddVehiclePhotoSection1787490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // "driver_side"/"passenger_side" rather than "left"/"right" -- avoids
    // the real-world ambiguity of which side "left" means depending on
    // whether you're facing the vehicle or standing behind it. Deliberately
    // not reusing the existing (unused, dead) vehicle_image_angle enum
    // (front/rear/left/right only, tied to the deleted Part-First intake
    // flow's rigid "exactly 4 required angles" shape) -- this is a
    // different, optional, batch-level concept.
    await queryRunner.query(`
      CREATE TYPE "vehicle_photo_section" AS ENUM (
        'front', 'rear', 'driver_side', 'passenger_side', 'interior', 'undercarriage'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "vehicle_photos"
      ADD COLUMN "section" "vehicle_photo_section"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vehicle_photos" DROP COLUMN "section"`,
    );
    await queryRunner.query(`DROP TYPE "vehicle_photo_section"`);
  }
}
