import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** The Moat: every AI prediction a human corrects, captured for future model training. */
@Entity('human_corrections')
export class HumanCorrection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'ai_analysis_id', type: 'uuid' })
  aiAnalysisId!: string;

  @Column({ type: 'varchar', length: 100 })
  field!: string;

  @Column({ name: 'original_value', type: 'text', nullable: true })
  originalValue!: string | null;

  @Column({ name: 'corrected_value', type: 'text' })
  correctedValue!: string;

  @Column({ name: 'corrected_by_user_id', type: 'uuid' })
  correctedByUserId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
