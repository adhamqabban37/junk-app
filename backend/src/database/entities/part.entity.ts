import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

export enum PartStatus {
  PENDING_AI = "pending_ai",
  PENDING_REVIEW = "pending_review",
  NEEDS_MANUAL_GRADING = "needs_manual_grading",
  APPROVED = "approved",
  LISTED = "listed",
  SOLD = "sold",
}

@Entity("parts")
export class Part {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "vehicle_id", type: "uuid" })
  vehicleId!: string;

  @Column({ name: "taxonomy_id", type: "uuid" })
  taxonomyId!: string;

  @Column({
    type: "enum",
    enum: PartStatus,
    default: PartStatus.PENDING_AI,
  })
  status!: PartStatus;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
