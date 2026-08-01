import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum UserRole {
  WORKER = 'worker',
  MANAGER = 'manager',
  OWNER = 'owner',
}

@Entity('users')
@Index(['tenantId', 'email'], { unique: true, where: '"email" IS NOT NULL' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  passwordHash!: string | null;

  /**
   * Worker PIN login is never looked up by PIN value (PINs are low-entropy;
   * indexing plaintext or a fast hash of one would let an attacker enumerate
   * them). The client instead lists workers by tenant/name and this hash
   * verifies the PIN for the selected user, so only a bcrypt-style salted
   * hash is stored — never the plaintext PIN.
   */
  @Column({ name: 'pin_hash', type: 'varchar', length: 255, nullable: true })
  pinHash!: string | null;

  @Column({ type: 'enum', enum: UserRole })
  role!: UserRole;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
