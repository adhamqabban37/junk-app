import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

export enum ListingMarketplace {
  CSV_EXPORT = "csv_export",
  EBAY = "ebay",
  SHOPIFY = "shopify",
  CAR_PART = "car_part",
}

export enum ListingStatus {
  DRAFT = "draft",
  EXPORTED = "exported",
  SYNCED = "synced",
}

@Entity("listings")
export class Listing {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "part_id", type: "uuid" })
  partId!: string;

  @Column({ type: "enum", enum: ListingMarketplace })
  marketplace!: ListingMarketplace;

  @Column({ name: "external_id", type: "varchar", length: 255, nullable: true })
  externalId!: string | null;

  @Column({ type: "enum", enum: ListingStatus, default: ListingStatus.DRAFT })
  status!: ListingStatus;

  @CreateDateColumn({ name: "listed_at" })
  listedAt!: Date;
}
