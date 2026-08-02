import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant, TenantSettings } from '../database/entities/tenant.entity';

@Injectable()
export class SettingsService {
  constructor(private readonly dataSource: DataSource) {}

  // tenants has no RLS (see Tenant entity / Phase 1 migration) -- scoped
  // directly by id here rather than through withTenantContext.
  async get(tenantId: string): Promise<TenantSettings> {
    const tenant = await this.dataSource
      .getRepository(Tenant)
      .findOneOrFail({ where: { id: tenantId } });
    return tenant.settings;
  }

  async update(
    tenantId: string,
    settings: TenantSettings,
  ): Promise<TenantSettings> {
    await this.dataSource
      .getRepository(Tenant)
      .update({ id: tenantId }, { settings });
    return settings;
  }
}
