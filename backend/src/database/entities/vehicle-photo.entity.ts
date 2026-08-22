import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A raw, worker-synced photo attached directly to a Vehicle, not yet
 * assigned to any Part. A manager assigns one or more of these (picking a
 * taxonomy) from the desktop dashboard, which is what actually creates the
 * Part + PartImage rows -- see VehiclesService.assignPhotos().
 */
@Entity('vehicle_photos')
export class VehiclePhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @Column({ type: 'varchar', length: 2048 })
  url!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
