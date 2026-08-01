import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from './entities.list';

// Global: DataSource/repositories are a cross-cutting dependency needed by
// AuthModule and every future resource module, not something worth
// re-importing DatabaseModule for everywhere.
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: ENTITIES,
        synchronize: false,
        migrationsRun: false,
        // Configurable so tests can force a tiny pool to prove pooled
        // connections never leak RLS session state across tenants (Phase 2
        // planning-gate finding — see backend/test/auth.e2e-spec.ts).
        extra: { max: Number(config.get<string>('DB_POOL_MAX')) || 10 },
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
