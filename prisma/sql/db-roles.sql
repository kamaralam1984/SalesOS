-- Least-privilege PostgreSQL roles for SalesOS (Phase 10). NOT a Prisma migration: run once per environment by the DBA, AFTER the
-- first `prisma migrate deploy` and again after any migration that adds tables (the default privileges below cover new tables created
-- by the migration role, so a re-run is only needed when the role names change).
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
--        -v dbname=salesos -v migrator_role=salesos_migrator -v app_role=salesos_app \
--        -v migrator_password="$(openssl rand -base64 33)" -v app_password="$(openssl rand -base64 33)" \
--        -f prisma/sql/db-roles.sql
--
-- Model:
--   migrator_role  OWNS the schema objects; used ONLY by `prisma migrate deploy` (DATABASE_URL of the migration job). Has DDL.
--   app_role       used by the API and the worker (DATABASE_URL of the long-running services). DML only:
--                  no CREATE/DROP/ALTER, no TRUNCATE, no ownership, no superuser/createdb/createrole.
--                  audit_logs and the money history tables are append-only at the PRIVILEGE level as well as by trigger.
-- The API refuses to boot under app_role if the guard triggers are missing (DB_AUTO_DDL=false is the production default).

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'migrator_role', :'migrator_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_role', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'migrator_role', :'migrator_password') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'app_role', :'app_password') \gexec

-- The database and schema belong to the migration role; nobody else may create objects.
SELECT format('ALTER DATABASE %I OWNER TO %I', :'dbname', :'migrator_role') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'dbname') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I', :'dbname', :'app_role', :'migrator_role') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'migrator_role') \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role') \gexec

-- Existing objects: hand them to the migration role (a database restored by a superuser is owned by the superuser).
SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'migrator_role') FROM pg_tables WHERE schemaname = 'public' \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', schemaname, sequencename, :'migrator_role') FROM pg_sequences WHERE schemaname = 'public' \gexec

-- Application: data manipulation only.
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_role') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'migrator_role', :'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'migrator_role', :'app_role') \gexec

-- Append-only history: even if a trigger were dropped, the application role could not rewrite it.
SELECT format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, payment_events, refund_events, deal_status_history, founder_report_snapshots, sales_credits FROM %I', :'app_role') \gexec
-- Migration bookkeeping is not the application's business.
SELECT format('REVOKE ALL ON _prisma_migrations FROM %I', :'app_role') \gexec
