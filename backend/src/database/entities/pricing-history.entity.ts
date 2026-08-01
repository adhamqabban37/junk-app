import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("pricing_history")
export class PricingHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "part_id", type: "uuid" })
  partId!: string;

  @Column({ type: "varchar", length: 100 })
  source!: string;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  price!: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
