import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Optional, worker-applied tag for a *batch* of photos uploaded together
 * (one tap before/after shooting a few photos of one area) -- never
 * required, and never per-photo, to avoid reintroducing the on-site
 * friction this project deliberately removed once already (the old
 * Part-First flow's rigid 4-required-angle capture). Used to scope the
 * whole-vehicle AI analysis job to a small, naturally-clustered set of
 * photos instead of the entire gallery, making "which photos show the
 * same physical part" a much more tractable question.
 */
export enum VehiclePhotoSection {
  FRONT = 'front',
  REAR = 'rear',
  DRIVER_SIDE = 'driver_side',
  PASSENGER_SIDE = 'passenger_side',
  INTERIOR = 'interior',
  UNDERCARRIAGE = 'undercarriage',
}

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

  @Column({ type: 'enum', enum: VehiclePhotoSection, nullable: true })
  section!: VehiclePhotoSection | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
