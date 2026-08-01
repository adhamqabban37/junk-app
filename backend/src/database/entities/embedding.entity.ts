import { Column, ColumnType, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

export enum EmbeddingType {
  IMAGE = "image",
  TEXT = "text",
}

/**
 * pgvector similarity search (visual intelligence, Phase 3+). The `vector`
 * Postgres type isn't in TypeORM's built-in ColumnType union, so it's cast
 * here — the real DDL comes from the migration, this only shapes query
 * parameter typing.
 */
const VECTOR_COLUMN_TYPE = "vector" as unknown as ColumnType;

@Entity("embeddings")
export class Embedding {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "part_id", type: "uuid", nullable: true })
  partId!: string | null;

  @Column({ name: "part_image_id", type: "uuid", nullable: true })
  partImageId!: string | null;

  @Column({ type: "enum", enum: EmbeddingType })
  type!: EmbeddingType;

  @Column({ type: VECTOR_COLUMN_TYPE, nullable: true })
  vector!: number[] | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
