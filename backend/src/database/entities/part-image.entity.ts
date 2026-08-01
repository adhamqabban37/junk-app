import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("part_images")
export class PartImage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "part_id", type: "uuid" })
  partId!: string;

  @Column({ type: "varchar", length: 2048 })
  url!: string;

  /** Laplacian variance blur score and luminosity sampling, captured client-side. */
  @Column({ name: "quality_flags", type: "jsonb", nullable: true })
  qualityFlags!: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
