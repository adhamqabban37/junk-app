import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export enum AiGrade {
  A = "A",
  B = "B",
  C = "C",
}

export enum AiAnalysisStatus {
  PENDING = "pending",
  COMPLETE = "complete",
  FAILED = "failed",
}

@Entity("ai_analyses")
@Index(["partImageId", "modelVersion"], { unique: true })
export class AiAnalysis {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "part_id", type: "uuid" })
  partId!: string;

  @Column({ name: "part_image_id", type: "uuid" })
  partImageId!: string;

  /**
   * Idempotency key alongside part_image_id: a unique (part_image_id,
   * model_version) pair means a retried BullMQ job for the same image and
   * model can never write a duplicate row.
   */
  @Column({ name: "model_version", type: "varchar", length: 100 })
  modelVersion!: string;

  @Column({ name: "raw_json", type: "jsonb", nullable: true })
  rawJson!: Record<string, unknown> | null;

  @Column({ type: "enum", enum: AiGrade, nullable: true })
  grade!: AiGrade | null;

  @Column({ name: "damage_codes", type: "text", array: true, default: () => "'{}'" })
  damageCodes!: string[];

  @Column({ type: "numeric", precision: 5, scale: 4, nullable: true })
  confidence!: number | null;

  @Column({
    type: "enum",
    enum: AiAnalysisStatus,
    default: AiAnalysisStatus.PENDING,
  })
  status!: AiAnalysisStatus;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
