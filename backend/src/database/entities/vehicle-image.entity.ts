import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

export enum VehicleImageAngle {
  FRONT = "front",
  REAR = "rear",
  LEFT = "left",
  RIGHT = "right",
}

@Entity("vehicle_images")
export class VehicleImage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "vehicle_id", type: "uuid" })
  vehicleId!: string;

  @Column({ type: "enum", enum: VehicleImageAngle })
  angle!: VehicleImageAngle;

  @Column({ type: "varchar", length: 2048 })
  url!: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
