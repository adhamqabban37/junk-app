import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeduplicatePartTaxonomyNames1787500000000
  implements MigrationInterface
{
  name = 'DeduplicatePartTaxonomyNames1787500000000';

  /**
   * part_taxonomies.name was never actually unique -- every read site that
   * matches Gemini's free-text suggested_part against a taxonomy row
   * (ai-analysis.service.ts's taxonomyIdByName map, this suite's own e2e
   * fixtures) has always assumed one row per name. Real duplicate-named
   * rows piled up in this dev database from repeated e2e runs and manual
   * exploratory taxonomy creation (confirmed live: "Fender" existed 17
   * times, some referenced by real Parts on a real demo tenant) -- with
   * duplicates present, taxonomyIdByName silently collapses to whichever
   * same-named row it iterates last, which doesn't necessarily match the
   * row any given caller already holds a reference to. This merges every
   * duplicate-name group onto one canonical row (the lowest id) and adds a
   * real UNIQUE constraint so it can't happen again.
   *
   * parts and vehicle_photo_suggestions both have FORCE ROW LEVEL SECURITY
   * (tenant_id = current_setting('app.tenant_id')), and the migration
   * connection (the app role) is not exempt from it -- remapping their
   * taxonomy_id FKs has to happen tenant-by-tenant with app.tenant_id set
   * per iteration, the same SET LOCAL pattern withTenantContext() uses at
   * runtime, rather than one blanket cross-tenant statement.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        t RECORD;
      BEGIN
        CREATE TEMP TABLE _taxonomy_dup_map ON COMMIT DROP AS
        SELECT pt.id AS dup_id, c.canonical_id
        FROM part_taxonomies pt
        JOIN (
          SELECT name, MIN(id::text)::uuid AS canonical_id
          FROM part_taxonomies
          GROUP BY name
          HAVING COUNT(*) > 1
        ) c ON c.name = pt.name
        WHERE pt.id <> c.canonical_id;

        -- Can't discover "which tenants are affected" by querying parts/
        -- vehicle_photo_suggestions directly -- FORCE ROW LEVEL SECURITY
        -- means that SELECT would itself see zero rows before app.tenant_id
        -- is ever set. Loop over every real tenant instead (tenants has no
        -- RLS); a tenant with no matching rows just no-ops.
        FOR t IN SELECT id AS tenant_id FROM tenants
        LOOP
          PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

          UPDATE parts
          SET taxonomy_id = dm.canonical_id
          FROM _taxonomy_dup_map dm
          WHERE parts.taxonomy_id = dm.dup_id
            AND parts.tenant_id = t.tenant_id;

          -- Drop any duplicate-taxonomy suggestion row that would collide
          -- with an existing (photo, canonical taxonomy) suggestion once
          -- remapped -- the unique index on that pair would otherwise
          -- reject the UPDATE right after it.
          DELETE FROM vehicle_photo_suggestions vps
          USING _taxonomy_dup_map dm
          WHERE vps.taxonomy_id = dm.dup_id
            AND vps.tenant_id = t.tenant_id
            AND EXISTS (
              SELECT 1 FROM vehicle_photo_suggestions vps2
              WHERE vps2.vehicle_photo_id = vps.vehicle_photo_id
                AND vps2.taxonomy_id = dm.canonical_id
            );

          UPDATE vehicle_photo_suggestions vps
          SET taxonomy_id = dm.canonical_id
          FROM _taxonomy_dup_map dm
          WHERE vps.taxonomy_id = dm.dup_id
            AND vps.tenant_id = t.tenant_id;
        END LOOP;
      END $$;
    `);

    // part_taxonomies itself has no RLS -- safe to delete directly.
    await queryRunner.query(`
      DELETE FROM part_taxonomies pt
      USING (
        SELECT pt2.id AS dup_id
        FROM part_taxonomies pt2
        JOIN (
          SELECT name, MIN(id::text)::uuid AS canonical_id
          FROM part_taxonomies
          GROUP BY name
          HAVING COUNT(*) > 1
        ) c ON c.name = pt2.name
        WHERE pt2.id <> c.canonical_id
      ) dm
      WHERE pt.id = dm.dup_id
    `);

    await queryRunner.query(
      `ALTER TABLE "part_taxonomies" ADD CONSTRAINT "uq_part_taxonomies_name" UNIQUE ("name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "part_taxonomies" DROP CONSTRAINT "uq_part_taxonomies_name"`,
    );
    // The merge itself (which rows were duplicates, which FKs pointed at
    // which) is not reversible -- this is a one-way data cleanup, same as
    // any other dedup migration.
  }
}
