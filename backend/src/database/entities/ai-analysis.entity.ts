import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AraDamageInstance } from '../../ai/grading.service';

export enum AiGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  /** ARA-style "ungraded" -- insufficient photo information to assess a sheet-metal part's damage, distinct from simply "no damage found" (which grades A). See grading.service.ts. */
  X = 'X',
}

export enum AiAnalysisStatus {
  PENDING = 'pending',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

@Entity('ai_analyses')
@Index(['partImageId', 'modelVersion'], { unique: true })
export class AiAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'part_id', type: 'uuid' })
  partId!: string;

  @Column({ name: 'part_image_id', type: 'uuid' })
  partImageId!: string;

  /**
   * Idempotency key alongside part_image_id: a unique (part_image_id,
   * model_version) pair means a retried BullMQ job for the same image and
   * model can never write a duplicate row.
   */
  @Column({ name: 'model_version', type: 'varchar', length: 100 })
  modelVersion!: string;

  @Column({ name: 'raw_json', type: 'jsonb', nullable: true })
  rawJson!: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: AiGrade, nullable: true })
  grade!: AiGrade | null;

  @Column({
    name: 'damage_codes',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  damageCodes!: string[];

  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true })
  confidence!: number | null;

  /** Sum of every detected damage instance's ARA unit value, for sheet-metal parts only (see grading.service.ts) -- null for every other part type and for every pre-ARA-grading row. Drives `grade` via gradeFromDamageUnits(), never the other way around. */
  @Column({
    name: 'damage_units',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  damageUnits!: number | null;

  /** Itemized ARA-style damage ({location, damageType, severity, units} per instance) backing `damageUnits`/`grade` for sheet-metal parts -- null for every other part type. `damageCodes` above still gets a human-readable formatted summary of these for every existing display/export site to keep working unchanged. */
  @Column({ name: 'ara_damage_codes', type: 'jsonb', nullable: true })
  araDamageCodes!: AraDamageInstance[] | null;

  @Column({
    type: 'enum',
    enum: AiAnalysisStatus,
    default: AiAnalysisStatus.PENDING,
  })
  status!: AiAnalysisStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
