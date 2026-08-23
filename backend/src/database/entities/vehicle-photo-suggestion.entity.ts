import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One (VehiclePhoto, PartTaxonomy) pair Gemini identified as visible in
 * that photo -- a photo can have several of these (a headlight, bumper,
 * and fender all in one frame), so it's a child table rather than columns
 * on VehiclePhoto. Unique on (vehiclePhotoId, taxonomyId): re-suggesting
 * the same pairing on a later analysis run updates confidence rather than
 * duplicating, and "does a row already exist" is also
 * AiAnalysisService.analyzeVehicle()'s auto-create idempotency gate.
 * Still just a hint until it clears the confidence threshold -- never
 * auto-applied below it, same Human-in-the-Loop principle as everywhere
 * else in this pipeline.
 */
@Entity('vehicle_photo_suggestions')
export class VehiclePhotoSuggestion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_photo_id', type: 'uuid' })
  vehiclePhotoId!: string;

  @Column({ name: 'taxonomy_id', type: 'uuid' })
  taxonomyId!: string;

  @Column({ type: 'numeric', precision: 5, scale: 4 })
  confidence!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
