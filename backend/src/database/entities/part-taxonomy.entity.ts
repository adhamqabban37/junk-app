import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

/**
 * Shared reference data across all tenants (part names/categories), not
 * tenant-scoped — precached client-side for offline part selection.
 */
@Entity("part_taxonomies")
export class PartTaxonomy {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 100 })
  category!: string;

  @Column({ name: "is_quick_pick", type: "boolean", default: false })
  isQuickPick!: boolean;
}
