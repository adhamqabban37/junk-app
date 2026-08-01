import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CrushStatus {
  ACTIVE = 'active',
  STRIPPED = 'stripped',
  CRUSHED = 'crushed',
}

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 17 })
  vin!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  make!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model!: string | null;

  @Column({ type: 'int', nullable: true })
  year!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  trim!: string | null;

  /** Full raw NHTSA decode response, kept for audit/debugging. */
  @Column({ name: 'decoded_raw', type: 'jsonb', nullable: true })
  decodedRaw!: Record<string, unknown> | null;

  @Column({
    name: 'crush_status',
    type: 'enum',
    enum: CrushStatus,
    default: CrushStatus.ACTIVE,
  })
  crushStatus!: CrushStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
