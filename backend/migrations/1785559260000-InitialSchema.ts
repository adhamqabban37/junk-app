import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1785559260000 implements MigrationInterface {
  name = "InitialSchema1785559260000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('worker', 'manager', 'owner')`);
    await queryRunner.query(
      `CREATE TYPE "crush_status" AS ENUM ('active', 'stripped', 'crushed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "vehicle_image_angle" AS ENUM ('front', 'rear', 'left', 'right')`,
    );
    await queryRunner.query(
      `CREATE TYPE "part_status" AS ENUM ('pending_ai', 'pending_review', 'needs_manual_grading', 'approved', 'listed', 'sold')`,
    );
    await queryRunner.query(`CREATE TYPE "ai_grade" AS ENUM ('A', 'B', 'C')`);
    await queryRunner.query(
      `CREATE TYPE "ai_analysis_status" AS ENUM ('pending', 'complete', 'failed')`,
    );
    await queryRunner.query(`CREATE TYPE "embedding_type" AS ENUM ('image', 'text')`);
    await queryRunner.query(
      `CREATE TYPE "listing_marketplace" AS ENUM ('csv_export', 'ebay', 'shopify', 'car_part')`,
    );
    await queryRunner.query(
      `CREATE TYPE "listing_status" AS ENUM ('draft', 'exported', 'synced')`,
    );

    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "email" varchar(255),
        "password_hash" varchar(255),
        "pin_hash" varchar(255),
        "role" "user_role" NOT NULL,
        "name" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_users_tenant_id" ON "users" ("tenant_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_tenant_email" ON "users" ("tenant_id", "email") WHERE "email" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "vehicles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "vin" varchar(17) NOT NULL,
        "make" varchar(100),
        "model" varchar(100),
        "year" int,
        "trim" varchar(100),
        "decoded_raw" jsonb,
        "crush_status" "crush_status" NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_vehicles_tenant_id" ON "vehicles" ("tenant_id")`);

    await queryRunner.query(`
      CREATE TABLE "vehicle_images" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
        "angle" "vehicle_image_angle" NOT NULL,
        "url" varchar(2048) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_vehicle_images_tenant_id" ON "vehicle_images" ("tenant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "part_taxonomies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "category" varchar(100) NOT NULL,
        "is_quick_pick" boolean NOT NULL DEFAULT false
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "parts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
        "taxonomy_id" uuid NOT NULL REFERENCES "part_taxonomies"("id"),
        "status" "part_status" NOT NULL DEFAULT 'pending_ai',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_parts_tenant_id" ON "parts" ("tenant_id")`);

    await queryRunner.query(`
      CREATE TABLE "part_images" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "part_id" uuid NOT NULL REFERENCES "parts"("id") ON DELETE CASCADE,
        "url" varchar(2048) NOT NULL,
        "quality_flags" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_part_images_tenant_id" ON "part_images" ("tenant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "ai_analyses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "part_id" uuid NOT NULL REFERENCES "parts"("id") ON DELETE CASCADE,
        "part_image_id" uuid NOT NULL REFERENCES "part_images"("id") ON DELETE CASCADE,
        "model_version" varchar(100) NOT NULL,
        "raw_json" jsonb,
        "grade" "ai_grade",
        "damage_codes" text[] NOT NULL DEFAULT '{}',
        "confidence" numeric(5,4),
        "status" "ai_analysis_status" NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ai_analyses_tenant_id" ON "ai_analyses" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ai_analyses_image_model" ON "ai_analyses" ("part_image_id", "model_version")`,
    );

    await queryRunner.query(`
      CREATE TABLE "human_corrections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "ai_analysis_id" uuid NOT NULL REFERENCES "ai_analyses"("id") ON DELETE CASCADE,
        "field" varchar(100) NOT NULL,
        "original_value" text,
        "corrected_value" text NOT NULL,
        "corrected_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_human_corrections_tenant_id" ON "human_corrections" ("tenant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "embeddings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "part_id" uuid REFERENCES "parts"("id") ON DELETE CASCADE,
        "part_image_id" uuid REFERENCES "part_images"("id") ON DELETE CASCADE,
        "type" "embedding_type" NOT NULL,
        "vector" vector(768),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_embeddings_tenant_id" ON "embeddings" ("tenant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "pricing_history" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "part_id" uuid NOT NULL REFERENCES "parts"("id") ON DELETE CASCADE,
        "source" varchar(100) NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_pricing_history_tenant_id" ON "pricing_history" ("tenant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "listings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "part_id" uuid NOT NULL REFERENCES "parts"("id") ON DELETE CASCADE,
        "marketplace" "listing_marketplace" NOT NULL,
        "external_id" varchar(255),
        "status" "listing_status" NOT NULL DEFAULT 'draft',
        "listed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_listings_tenant_id" ON "listings" ("tenant_id")`);

    // Row-Level Security: every tenant-scoped table gets FORCE ROW LEVEL
    // SECURITY (so even the table-owning app role is subject to it, not just
    // other roles) plus a policy comparing tenant_id against the session
    // variable set per-request/transaction (see tenant-context.ts). The
    // `true` second arg to current_setting means "return NULL if unset"
    // rather than erroring, so a connection with no tenant context set sees
    // zero rows (default-deny) instead of leaking or crashing.
    const tenantScopedTables = [
      "users",
      "vehicles",
      "vehicle_images",
      "parts",
      "part_images",
      "ai_analyses",
      "human_corrections",
      "embeddings",
      "pricing_history",
      "listings",
    ];
    for (const table of tenantScopedTables) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation" ON "${table}"
        USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
      `);
    }
    // part_taxonomies is shared reference data across all tenants — no RLS.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      "listings",
      "pricing_history",
      "embeddings",
      "human_corrections",
      "ai_analyses",
      "part_images",
      "parts",
      "part_taxonomies",
      "vehicle_images",
      "vehicles",
      "users",
      "tenants",
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }

    const enums = [
      "listing_status",
      "listing_marketplace",
      "embedding_type",
      "ai_analysis_status",
      "ai_grade",
      "part_status",
      "vehicle_image_angle",
      "crush_status",
      "user_role",
    ];
    for (const e of enums) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${e}"`);
    }
  }
}
