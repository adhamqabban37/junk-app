-- The POSTGRES_USER env var on the official postgres image is always
-- created as a Postgres SUPERUSER during initdb. Postgres never applies
-- row-level security to superusers, regardless of FORCE ROW LEVEL SECURITY
-- (see postgresql.org/docs/current/ddl-rowsecurity.html). If the app
-- connected as that bootstrap user, every RLS policy in the schema would be
-- silently bypassed. This creates a separate, ordinary (non-superuser) role
-- for the app to connect as instead — migrations and app code both use
-- this role, so it owns the tables it creates, and FORCE ROW LEVEL SECURITY
-- correctly re-imposes RLS on it as a non-superuser owner.
CREATE ROLE junkyard_app WITH LOGIN PASSWORD 'junkyard_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT ALL PRIVILEGES ON DATABASE junkyard_dev TO junkyard_app;
GRANT ALL ON SCHEMA public TO junkyard_app;
