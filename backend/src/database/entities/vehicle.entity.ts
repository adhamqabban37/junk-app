import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CrushStatus {
  ACTIVE = 'active',
  STRIPPED = 'stripped',
  CRUSHED = 'crushed',
}

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /**
   * Client-generated intake draft id, unique per tenant (partial unique
   * index, migration-enforced — see AddVehicleIntakeDraftId). Lets
   * POST /vehicles/intake detect a retried sync and return the
   * already-created vehicle instead of creating a duplicate.
   */
  @Column({
    name: 'intake_draft_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  intakeDraftId!: string | null;

  /**
   * The yard's own handle for this vehicle -- what gets said on the phone
   * and printed on a label, unlike the UUID. Issued from the tenant's
   * `nextStockNumber` counter at intake and unique per tenant.
   *
   * Nullable only so a future bulk import can stage rows before numbering
   * them; everything created through intake gets one.
   */
  @Column({ name: 'stock_number', type: 'varchar', length: 32, nullable: true })
  stockNumber!: string | null;

  @Column({ type: 'varchar', length: 17 })
  vin!: string;

  /**
   * Odometer at intake. Capturable only when the car arrives, and load-
   * bearing well beyond reporting: mechanical parts (engine, transmission,
   * alternator) are graded on mileage in this industry, not on how they
   * photograph, so this is the input the AI physically cannot supply.
   */
  @Column({ name: 'odometer_miles', type: 'int', nullable: true })
  odometerMiles!: number | null;

  /** What the yard paid. Without it, margin on a vehicle is uncomputable. */
  @Column({
    name: 'acquisition_cost',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  acquisitionCost!: number | null;

  /** Free text for now (auction, insurance, private, tow-in). */
  @Column({
    name: 'acquisition_source',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  acquisitionSource!: string | null;

  @Column({ name: 'acquisition_date', type: 'date', nullable: true })
  acquisitionDate!: string | null;

  /**
   * Where the car physically sits, as the yard writes it ("Row 12 / Sp 8").
   *
   * A single string rather than a row/rack/shelf hierarchy on purpose: yards
   * organize themselves very differently, and fixed columns would need a
   * schema change per customer. It also doubles as the location of every
   * part still ON this vehicle, which is most of them -- parts are typically
   * dismantled on demand, not up front.
   */
  @Column({
    name: 'location_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  locationCode!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  make!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model!: string | null;

  @Column({ type: 'int', nullable: true })
  year!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  trim!: string | null;

  /** Full raw NHTSA decode response, kept for audit/debugging. */
  @Column({ name: 'decoded_raw', type: 'jsonb', nullable: true })
  decodedRaw!: Record<string, unknown> | null;

  @Column({
    name: 'crush_status',
    type: 'enum',
    enum: CrushStatus,
    default: CrushStatus.ACTIVE,
  })
  crushStatus!: CrushStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
