import { DataSource, EntityManager } from 'typeorm';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` inside a transaction with the Postgres RLS session variable
 * (`app.tenant_id`) set via `SET LOCAL`, so it only applies for the lifetime
 * of this transaction on this connection — never leaks onto whatever request
 * a pooled connection serves next (see Phase 2 planning-gate finding: a
 * connection-level `SET` instead of `SET LOCAL` is a cross-tenant leak).
 */
export async function withTenantContext<T>(
  dataSource: DataSource,
  tenantId: string,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error(
      `withTenantContext: tenantId is not a valid UUID: ${tenantId}`,
    );
  }

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    // SET/SET LOCAL are utility statements and don't accept bind
    // parameters ($1) — the UUID format check above is what makes this
    // string interpolation safe.
    await queryRunner.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const result = await work(queryRunner.manager);
    await queryRunner.commitTransaction();
    return result;
  } catch (err) {
    await queryRunner.rollbackTransaction();
    throw err;
  } finally {
    await queryRunner.release();
  }
}
