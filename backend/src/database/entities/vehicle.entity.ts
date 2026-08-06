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

  /**
   * Client-generated intake draft id, unique per tenant (partial unique
   * index, migration-enforced — see AddVehicleIntakeDraftId). Lets
   * POST /vehicles/intake detect a retried sync and return the
   * already-created vehicle instead of creating a duplicate.
   */
  @Column({
    name: 'intake_draft_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  intakeDraftId!: string | null;

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
