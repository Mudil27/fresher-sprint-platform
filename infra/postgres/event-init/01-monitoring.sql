-- Query statistics for event-day diagnostics. Lives outside "public" so
-- drizzle-kit push (which drops unknown public objects) leaves it alone.
CREATE SCHEMA IF NOT EXISTS monitoring;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA monitoring;
