import { MigrationInterface, QueryRunner } from 'typeorm';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where each tenant's stock numbers begin. See the note in up(). */
const FIRST_STOCK_NUMBER = 1000;

/**
 * Gives a vehicle the identity and acquisition facts a yard actually runs
 * on: a human-readable stock number, an odometer reading, what it cost, and
 * where it is parked.
 *
 * Why now, rather than with the rest of the commercial fields: every value
 * here can only be captured when the car arrives. A yard that runs three
 * months without acquisition cost has three months of permanently
 * uncomputable margin, and mileage is the input that decides a mechanical
 * part's grade -- a photograph of an alternator cannot tell you. Neither is
 * reconstructable after the fact.
 *
 * Stock numbers are issued from a per-tenant counter on `tenants` rather
 * than a Postgres sequence, because sequences are global objects and this
 * needs one series per tenant. The counter is bumped in the same
 * transaction that inserts the vehicle, which takes a row lock on the
 * tenant and serializes concurrent intakes for that tenant only. Intake is
 * nowhere near frequent enough for that to matter, and the alternative
 * (MAX(stock_number)+1) races.
 *
 * **The starting value is a one-way door** (see F2 in the architecture
 * plan): once a number is printed on a label or quoted to a buyer it is
 * permanent. 1000 is a plain, conventional starting point. Changing it is a
 * single UPDATE *today* and effectively impossible once a customer has
 * issued numbers.
 */
export class AddVehicleIdentityAndAcquisition1786330000000
  implements MigrationInterface
{
  name = 'AddVehicleIdentityAndAcquisition1786330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD COLUMN "next_stock_number" int NOT NULL DEFAULT ${FIRST_STOCK_NUMBER}`,
    );

    await queryRunner.query(`
      ALTER TABLE "vehicles"
        ADD COLUMN "stock_number" varchar(32),
        ADD COLUMN "odometer_miles" int,
        ADD COLUMN "acquisition_cost" numeric(10,2),
        ADD COLUMN "acquisition_source" varchar(100),
        ADD COLUMN "acquisition_date" date,
        ADD COLUMN "location_code" varchar(64)
    `);

    // Partial, so the many pre-existing rows this migration is about to
    // number don't collide on NULL and so a future import can stage rows
    // without one.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_vehicles_tenant_stock_number"
        ON "vehicles" ("tenant_id", "stock_number")
        WHERE "stock_number" IS NOT NULL
    `);

    // ---------------------------------------------------------------
    // Backfill. This is the first migration in the project to run DML
    // against an RLS-protected table, and it is worth reading before
    // writing another one.
    //
    // Every tenant-scoped table has FORCE ROW LEVEL SECURITY, which applies
    // to the table OWNER too -- not just to other roles. Migrations run as
    // junkyard_app with no `app.tenant_id` set, and the policy's
    // NULLIF(current_setting(...), '') resolves to NULL, so the table looks
    // EMPTY. A plain `UPDATE vehicles SET ...` here would report success and
    // change zero rows.
    //
    // The fix is to set the tenant context per tenant and update that
    // tenant's rows, exactly as the application does. Deliberately NOT
    // `DISABLE ROW LEVEL SECURITY` around the backfill: that would work, but
    // it normalizes switching tenant isolation off inside a migration, and
    // the next person to copy this pattern might not switch it back on.
    // ---------------------------------------------------------------
    const tenants = (await queryRunner.query(
      `SELECT "id" FROM "tenants"`,
    )) as { id: string }[];

    for (const { id } of tenants) {
      // These ids come from gen_random_uuid() in our own table, but this is
      // string-interpolated into a SET statement (which cannot take bind
      // parameters), so it is validated the same way tenant-context.ts does.
      if (!UUID_PATTERN.test(id)) {
        throw new Error(`Refusing to set tenant context for non-UUID id: ${id}`);
      }
      await queryRunner.query(`SET LOCAL app.tenant_id = '${id}'`);

      // Oldest vehicle gets the lowest number, so the series reads
      // chronologically rather than by however Postgres happened to store
      // the rows.
      await queryRunner.query(
        `
        UPDATE "vehicles" v
        SET "stock_number" = sub.n::text
        FROM (
          SELECT "id",
                 ($2::int + ROW_NUMBER() OVER (ORDER BY "created_at", "id") - 1) AS n
          FROM "vehicles"
          WHERE "tenant_id" = $1
        ) sub
        WHERE v."id" = sub."id"
        `,
        [id, FIRST_STOCK_NUMBER],
      );

      await queryRunner.query(
        `
        UPDATE "tenants"
        SET "next_stock_number" = COALESCE((
          SELECT MAX("stock_number"::int) + 1
          FROM "vehicles"
          WHERE "tenant_id" = $1 AND "stock_number" ~ '^[0-9]+$'
        ), $2::int)
        WHERE "id" = $1
        `,
        [id, FIRST_STOCK_NUMBER],
      );
    }

    // Leave no tenant context bound to this connection. SET LOCAL would end
    // with the transaction anyway; being explicit means a future migration
    // appended below this one cannot silently inherit the last tenant's
    // context and quietly operate on one tenant's rows.
    await queryRunner.query(`SET LOCAL app.tenant_id = ''`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_vehicles_tenant_stock_number"`,
    );
    await queryRunner.query(`
      ALTER TABLE "vehicles"
        DROP COLUMN "location_code",
        DROP COLUMN "acquisition_date",
        DROP COLUMN "acquisition_source",
        DROP COLUMN "acquisition_cost",
        DROP COLUMN "odometer_miles",
        DROP COLUMN "stock_number"
    `);
    await queryRunner.query(
      `ALTER TABLE "tenants" DROP COLUMN "next_stock_number"`,
    );
  }
}
