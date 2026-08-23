import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Shared reference data across all tenants (part names/categories), not
 * tenant-scoped — precached client-side for offline part selection.
 */
@Entity('part_taxonomies')
export class PartTaxonomy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  category!: string;

  @Column({ name: 'is_quick_pick', type: 'boolean', default: false })
  isQuickPick!: boolean;

  /** Whether this part is visually identifiable from an outside photo (bumper, fender, headlight, etc.) -- the candidate set the AI is allowed to suggest from when identifying photos. Internal/complex parts (engine, electrical, interior mechanicals) stay false and are always manually assigned. */
  @Column({ name: 'is_exterior_visual', type: 'boolean', default: false })
  isExteriorVisual!: boolean;
}
