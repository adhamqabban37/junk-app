import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AiGrade } from './ai-analysis.entity';

export enum PartStatus {
  PENDING_AI = 'pending_ai',
  PENDING_REVIEW = 'pending_review',
  NEEDS_MANUAL_GRADING = 'needs_manual_grading',
  APPROVED = 'approved',
  LISTED = 'listed',
  SOLD = 'sold',
}

@Entity('parts')
export class Part {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @Column({ name: 'taxonomy_id', type: 'uuid' })
  taxonomyId!: string;

  @Column({
    type: 'enum',
    enum: PartStatus,
    default: PartStatus.PENDING_AI,
  })
  status!: PartStatus;

  /**
   * The human's answer on this part's condition, per field.
   *
   * NULL means no person has ruled on that field yet, so readers fall back
   * to the latest AiAnalysis for it -- resolved by effectiveCondition()
   * (parts/effective-condition.ts), which every display surface goes
   * through so they cannot drift apart.
   *
   * Per-field on purpose: a manager who fixes a wrong grade but agrees with
   * the AI's damage tags should not have those tags silently re-attributed
   * to them. Only what they actually changed becomes theirs.
   */
  @Column({ name: 'final_grade', type: 'enum', enum: AiGrade, nullable: true })
  finalGrade!: AiGrade | null;

  @Column({
    name: 'final_damage_codes',
    type: 'text',
    array: true,
    nullable: true,
  })
  finalDamageCodes!: string[] | null;

  @Column({
    name: 'final_confidence',
    type: 'numeric',
    precision: 5,
    scale: 4,
    nullable: true,
  })
  finalConfidence!: number | null;

  @Column({ name: 'condition_set_by_user_id', type: 'uuid', nullable: true })
  conditionSetByUserId!: string | null;

  @Column({ name: 'condition_set_at', type: 'timestamptz', nullable: true })
  conditionSetAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
