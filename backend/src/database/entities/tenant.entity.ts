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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
