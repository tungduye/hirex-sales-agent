# Supabase boundary

Phase 1A installs the official Supabase packages and reserves this server/data-access boundary, but does not create a client or connect to a Supabase project. Future client factories must validate environment variables, keep privileged credentials server-only, and follow the migration/RLS rules in `DATABASE_DESIGN.md`.
