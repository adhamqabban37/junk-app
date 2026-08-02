import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../database/entities/user.entity';
import { withTenantContext } from '../database/tenant-context';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export type SanitizedUser = Omit<User, 'passwordHash' | 'pinHash'>;

function sanitize(user: User): SanitizedUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    name: user.name,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly dataSource: DataSource) {}

  async list(tenantId: string): Promise<SanitizedUser[]> {
    const users = await withTenantContext(
      this.dataSource,
      tenantId,
      (manager) =>
        manager
          .getRepository(User)
          .find({ where: { tenantId }, order: { name: 'ASC' } }),
    );
    return users.map(sanitize);
  }

  async create(tenantId: string, dto: CreateUserDto): Promise<SanitizedUser> {
    if (dto.role === UserRole.WORKER) {
      if (!dto.pin) {
        throw new BadRequestException('pin is required for the worker role');
      }
    } else if (!dto.email || !dto.password) {
      throw new BadRequestException(
        'email and password are required for the manager role',
      );
    }

    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const user = manager.getRepository(User).create({
        tenantId,
        role: dto.role,
        name: dto.name,
        email: dto.role === UserRole.WORKER ? null : (dto.email ?? null),
        passwordHash:
          dto.role === UserRole.WORKER
            ? null
            : await bcrypt.hash(dto.password as string, 10),
        pinHash:
          dto.role === UserRole.WORKER
            ? await bcrypt.hash(dto.pin as string, 10)
            : null,
      });
      const saved = await manager.getRepository(User).save(user);
      return sanitize(saved);
    });
  }

  async update(
    tenantId: string,
    userId: string,
    dto: UpdateUserDto,
  ): Promise<SanitizedUser> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const user = await manager
        .getRepository(User)
        .findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      if (dto.name !== undefined) {
        user.name = dto.name;
      }
      if (dto.role !== undefined) {
        user.role = dto.role;
      }
      const saved = await manager.getRepository(User).save(user);
      return sanitize(saved);
    });
  }
}
