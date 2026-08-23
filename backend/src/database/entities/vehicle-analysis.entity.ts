import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AiGrade, AiAnalysisStatus } from './ai-analysis.entity';

/**
 * Whole-vehicle condition grade, computed from whatever VehiclePhotos exist
 * on the vehicle at the time -- separate from AiAnalysis (which grades one
 * PartImage after a manager assigns it to a taxonomy). Unlike AiAnalysis,
 * there is deliberately no uniqueness constraint here: a new row is written
 * every time the photo set changes, and "latest by createdAt" is the
 * current grade -- same "latest analysis wins" pattern PartsService.list()
 * already uses for per-part grades.
 */
@Entity('vehicle_analyses')
export class VehicleAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @Column({ name: 'model_version', type: 'varchar', length: 100 })
  modelVersion!: string;

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

  /** How many VehiclePhotos were actually sent to Gemini for this grade -- lets the UI show "graded from 2 photos" and explains why a grade might look thin. */
  @Column({ name: 'photo_count', type: 'int' })
  photoCount!: number;

  @Column({
    type: 'enum',
    enum: AiAnalysisStatus,
    default: AiAnalysisStatus.PENDING,
  })
  status!: AiAnalysisStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
