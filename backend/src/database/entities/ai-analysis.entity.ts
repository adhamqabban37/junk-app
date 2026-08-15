import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Condition grades, worst-to-best D..A. The rubric these map to lives in
 * GRADING_RUBRIC (ai/gemini.service.ts) and is the single source of truth
 * for what each letter means -- change it there, not here.
 */
export enum AiGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
}

export enum AiAnalysisStatus {
  PENDING = 'pending',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/**
 * A single AI prediction. **Append-only: never update a row here.**
 *
 * This used to be mutable -- a manager's correction was written straight
 * onto the row so Inventory and the CSV export showed the corrected value.
 * The cost was invisible and severe: `human_corrections` joins back here for
 * the model version and the confidence at prediction time, so mutating the
 * row corrupted the training context of every correction attached to it,
 * and a field corrected twice lost its intermediate prediction entirely.
 *
 * The human's answer now lives on `Part.final*` and readers resolve the two
 * through effectiveCondition() (parts/effective-condition.ts). If you need
 * a different prediction for the same image, write a new row -- the
 * (part_image_id, model_version) unique index is the idempotency key that
 * keeps a retried job from doing so accidentally.
 */
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

  /**
   * Which prompt produced this prediction. Two rows sharing a model_version
   * can still come from materially different instructions -- the grading
   * rubric has already been rewritten once -- so the model name alone is not
   * enough provenance to train on. Nullable: rows written before this field
   * existed have no honest value.
   */
  @Column({
    name: 'prompt_version',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  promptVersion!: string | null;

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

  @Column({
    type: 'enum',
    enum: AiAnalysisStatus,
    default: AiAnalysisStatus.PENDING,
  })
  status!: AiAnalysisStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
