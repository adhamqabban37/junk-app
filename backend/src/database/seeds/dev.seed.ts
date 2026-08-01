import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { AppDataSource } from '../data-source';
import { Tenant, User, UserRole } from '../entities';
import { withTenantContext } from '../tenant-context';
import { seedTaxonomy } from './taxonomy.seed';

const DEMO_TENANT_NAME = 'Demo Salvage Yard';
const DEMO_WORKER_PIN = '1234';
const DEMO_MANAGER_EMAIL = 'manager@demo-yard.local';
const DEMO_MANAGER_PASSWORD = 'manager-dev-password';

/**
 * Seeds one demo tenant with a worker (PIN login) and a manager
 * (email+password login) so a new engineer can exercise the intake flow
 * locally without hand-creating rows (Phase 1 planning-gate finding).
 */
export async function seedDev(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  const tenantRepo = dataSource.getRepository(Tenant);
  let tenant = await tenantRepo.findOne({ where: { name: DEMO_TENANT_NAME } });
  if (!tenant) {
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: DEMO_TENANT_NAME }),
    );
  }

  await withTenantContext(dataSource, tenant.id, async (manager) => {
    const userRepo = manager.getRepository(User);

    const existingWorker = await userRepo.findOne({
      where: { tenantId: tenant.id, name: 'Demo Worker' },
    });
    if (!existingWorker) {
      const pinHash = await bcrypt.hash(DEMO_WORKER_PIN, 10);
      await userRepo.save(
        userRepo.create({
          tenantId: tenant.id,
          name: 'Demo Worker',
          role: UserRole.WORKER,
          pinHash,
          email: null,
          passwordHash: null,
        }),
      );
    }

    const existingManager = await userRepo.findOne({
      where: { tenantId: tenant.id, email: DEMO_MANAGER_EMAIL },
    });
    if (!existingManager) {
      const passwordHash = await bcrypt.hash(DEMO_MANAGER_PASSWORD, 10);
      await userRepo.save(
        userRepo.create({
          tenantId: tenant.id,
          name: 'Demo Manager',
          role: UserRole.MANAGER,
          email: DEMO_MANAGER_EMAIL,
          passwordHash,
          pinHash: null,
        }),
      );
    }
  });

  await seedTaxonomy();
}

if (require.main === module) {
  seedDev()
    .then(() => {
      console.log('Dev seed complete:');
      console.log(`  Tenant: ${DEMO_TENANT_NAME}`);
      console.log(`  Worker PIN login: "Demo Worker", PIN ${DEMO_WORKER_PIN}`);
      console.log(
        `  Manager login: ${DEMO_MANAGER_EMAIL} / ${DEMO_MANAGER_PASSWORD}`,
      );
      return AppDataSource.destroy();
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
