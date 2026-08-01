import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";
import { ENTITIES } from "../src/database/entities.list";
import { Tenant } from "../src/database/entities/tenant.entity";
import { Vehicle, CrushStatus } from "../src/database/entities/vehicle.entity";
import { withTenantContext } from "../src/database/tenant-context";

/**
 * Verifies Postgres RLS actually isolates tenants for SELECT, INSERT, and
 * UPDATE — not just SELECT (BUILD_PLAN Phase 1 planning-gate finding).
 * Runs against the real dev Postgres (docker-compose), not a mock, since
 * RLS is a database-level guarantee that can't be meaningfully unit-tested.
 */
describe("RLS tenant isolation", () => {
  let dataSource: DataSource;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let vehicleA: Vehicle;
  let vehicleB: Vehicle;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: "postgres",
      url:
        process.env.DATABASE_URL ??
        "postgres://junkyard:junkyard_dev@localhost:5432/junkyard_dev",
      entities: ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const tenantRepo = dataSource.getRepository(Tenant);
    tenantA = await tenantRepo.save(
      tenantRepo.create({ name: `RLS Test Tenant A ${Date.now()}` }),
    );
    tenantB = await tenantRepo.save(
      tenantRepo.create({ name: `RLS Test Tenant B ${Date.now()}` }),
    );

    vehicleA = await withTenantContext(dataSource, tenantA.id, (manager) =>
      manager.getRepository(Vehicle).save(
        manager.getRepository(Vehicle).create({
          tenantId: tenantA.id,
          vin: "TENANTA1234567890",
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
    vehicleB = await withTenantContext(dataSource, tenantB.id, (manager) =>
      manager.getRepository(Vehicle).save(
        manager.getRepository(Vehicle).create({
          tenantId: tenantB.id,
          vin: "TENANTB1234567890",
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
  });

  afterAll(async () => {
    // FKs cascade from tenants, so deleting the two test tenants cleans up
    // everything created under them.
    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.delete({ id: tenantA.id });
    await tenantRepo.delete({ id: tenantB.id });
    await dataSource.destroy();
  });

  it("SELECT only returns rows for the active tenant context", async () => {
    const seenByA = await withTenantContext(dataSource, tenantA.id, (manager) =>
      manager.getRepository(Vehicle).find({ where: { vin: "TENANTA1234567890" } }),
    );
    const crossSeenByA = await withTenantContext(dataSource, tenantA.id, (manager) =>
      manager.getRepository(Vehicle).find({ where: { vin: "TENANTB1234567890" } }),
    );

    expect(seenByA).toHaveLength(1);
    expect(seenByA[0].id).toBe(vehicleA.id);
    expect(crossSeenByA).toHaveLength(0);
  });

  it("SELECT with no tenant context set returns zero rows (default-deny)", async () => {
    // No withTenantContext wrapper here — app.tenant_id is unset on this
    // connection, so current_setting(..., true) is NULL and the RLS USING
    // clause (tenant_id = NULL) matches nothing.
    const rows = await dataSource
      .getRepository(Vehicle)
      .find({ where: { vin: "TENANTA1234567890" } });
    expect(rows).toHaveLength(0);
  });

  it("INSERT with a tenant_id that doesn't match the session context is rejected", async () => {
    await expect(
      withTenantContext(dataSource, tenantA.id, (manager) =>
        manager.getRepository(Vehicle).save(
          manager.getRepository(Vehicle).create({
            // Session context is tenant A, but this row claims tenant B —
            // the RLS WITH CHECK clause must reject it.
            tenantId: tenantB.id,
            vin: "CROSSTENANT123456", // 17 chars, matches vin varchar(17)
            crushStatus: CrushStatus.ACTIVE,
          }),
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("UPDATE cannot touch another tenant's row even by primary key", async () => {
    const result = await withTenantContext(dataSource, tenantA.id, (manager) =>
      manager
        .getRepository(Vehicle)
        .update({ id: vehicleB.id }, { model: "should-not-apply" }),
    );
    // The RLS USING clause filters vehicleB out of tenant A's view before
    // the UPDATE ever matches it, so affected rows is 0, not an error.
    expect(result.affected).toBe(0);

    const stillUnchanged = await withTenantContext(dataSource, tenantB.id, (manager) =>
      manager.getRepository(Vehicle).findOneOrFail({ where: { id: vehicleB.id } }),
    );
    expect(stillUnchanged.model).toBeNull();
  });
});
