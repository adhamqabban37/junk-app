import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DataSource, In } from 'typeorm';
import { User, UserRole } from '../database/entities';
import { withTenantContext } from '../database/tenant-context';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  name: string;
}

export interface WorkerSummary {
  id: string;
  name: string;
}

/**
 * Both login paths require a tenantId from the client rather than resolving
 * it from email/PIN alone. This keeps every DB read tenant-scoped through
 * withTenantContext (see tenant-context.ts) so RLS never has to be bypassed
 * for auth itself — a device is provisioned for one yard and already knows
 * its tenantId before anyone logs in (mirrors how the PIN flow always
 * needed a known tenant to list workers from).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
  ) {}

  async listWorkersForTenant(tenantId: string): Promise<WorkerSummary[]> {
    return withTenantContext(this.dataSource, tenantId, (manager) =>
      manager.getRepository(User).find({
        where: { tenantId, role: UserRole.WORKER },
        select: { id: true, name: true },
        order: { name: 'ASC' },
      }),
    );
  }

  async loginWithPin(
    tenantId: string,
    userId: string,
    pin: string,
  ): Promise<string> {
    const user = await withTenantContext(this.dataSource, tenantId, (manager) =>
      manager.getRepository(User).findOne({
        where: { id: userId, tenantId, role: UserRole.WORKER },
      }),
    );
    if (!user?.pinHash || !(await bcrypt.compare(pin, user.pinHash))) {
      throw new UnauthorizedException('Invalid worker or PIN');
    }
    return this.issueToken(user);
  }

  async loginWithPassword(
    tenantId: string,
    email: string,
    password: string,
  ): Promise<string> {
    const user = await withTenantContext(this.dataSource, tenantId, (manager) =>
      manager.getRepository(User).findOne({
        where: {
          tenantId,
          email,
          role: In([UserRole.MANAGER, UserRole.OWNER]),
        },
      }),
    );
    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueToken(user);
  }

  private issueToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      name: user.name,
    };
    return this.jwtService.sign(payload);
  }
}
