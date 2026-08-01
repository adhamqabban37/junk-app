-- Runs before 01-app-role.sql, as the bootstrap superuser. `CREATE EXTENSION
-- vector` requires superuser on this image build (not marked "trusted"), so
-- it can't run inside the TypeORM migration once the app connects as the
-- non-superuser junkyard_app role (see 01-app-role.sql for why that role
-- exists). Creating it here, once, at container init time avoids that.
CREATE EXTENSION IF NOT EXISTS vector;
