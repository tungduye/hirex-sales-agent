#!/usr/bin/env bash
# Rebuilds a disposable database from every migration and runs the SQL regression tests.
# Usage: PGHOST=... PGPORT=... PGUSER=... supabase/tests/run-local.sh
# Never point this at a real Supabase project: it drops and recreates the target database.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${HIREX_TEST_DB:-hirex_sql_test}"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/local_postgres_supabase_bootstrap.sql
for migration in $(ls supabase/migrations/*.sql | sort); do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$migration" > /dev/null
done
echo "Applied $(ls supabase/migrations/*.sql | wc -l) migrations"
for test in supabase/tests/021_omnichannel_foundation.sql supabase/tests/022_multichannel_campaigns.sql supabase/tests/069_ai_recruiter_auto_gates.sql supabase/tests/071_content_library.sql supabase/tests/072_content_templates.sql supabase/tests/073_content_item_template.sql supabase/tests/074_assistant_requests.sql supabase/tests/075_assistant_actions.sql supabase/tests/076_assistant_send_reply.sql supabase/tests/077_assistant_daily_briefs.sql supabase/tests/078_assistant_alerts.sql supabase/tests/079_assistant_rules.sql supabase/tests/080_inbox_zalo_group_detection.sql supabase/tests/081_content_taxonomy.sql; do
  output=$(psql -v ON_ERROR_STOP=1 -q -o /dev/null -d "$DB" -f "$test" 2>&1) || { echo "$output" | tail -5; echo "FAILED: $test"; exit 1; }
  echo "PASS $test ($(echo "$output" | grep -c 'PASS:') checks)"
done
