import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities.list';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ??
    'postgres://junkyard:junkyard_dev@localhost:5432/junkyard_dev',
  entities: ENTITIES,
  migrations: [__dirname + '/../../migrations/*.{ts,js}'],
  synchronize: false,
});
