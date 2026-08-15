import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface TenantSettings {
  /** Below this, an AiAnalysis renders as "needs review" in the AI Review Queue instead of a high-confidence auto-suggestion (DESIGN_SPEC §5.2 / Phase 5 planning-gate finding). */
  aiConfidenceThreshold: number;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  aiConfidenceThreshold: 0.7,
};

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({
    type: 'jsonb',
    default: () => `'${JSON.stringify(DEFAULT_TENANT_SETTINGS)}'`,
  })
  settings!: TenantSettings;

  /**
   * Next stock number to hand out for this tenant's vehicles.
   *
   * A real column rather than a key in `settings` because it is incremented
   * atomically (`UPDATE ... RETURNING`) on every intake, and doing that
   * inside a jsonb blob is both awkward and needlessly lock-heavy. A
   * per-tenant counter rather than a Postgres sequence because sequences are
   * global objects and each tenant needs its own series.
   */
  @Column({ name: 'next_stock_number', type: 'int', default: 1000 })
  nextStockNumber!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
