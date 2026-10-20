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
for test in supabase/tests/021_omnichannel_foundation.sql supabase/tests/022_multichannel_campaigns.sql supabase/tests/069_ai_recruiter_auto_gates.sql supabase/tests/071_content_library.sql supabase/tests/072_content_templates.sql supabase/tests/073_content_item_template.sql supabase/tests/074_assistant_requests.sql supabase/tests/075_assistant_actions.sql supabase/tests/076_assistant_send_reply.sql supabase/tests/077_assistant_daily_briefs.sql supabase/tests/078_assistant_alerts.sql supabase/tests/079_assistant_rules.sql supabase/tests/080_inbox_zalo_group_detection.sql supabase/tests/081_content_taxonomy.sql supabase/tests/082_campaign_content_usage.sql supabase/tests/083_assistant_crm_actions.sql supabase/tests/084_assistant_uploads.sql supabase/tests/085_zalo_group_detection_system_sender.sql supabase/tests/086_zalo_group_send.sql supabase/tests/087_inbox_group_last_outbound.sql supabase/tests/088_zalo_group_members.sql supabase/tests/089_outbound_mentions.sql supabase/tests/090_zalo_send_locks.sql supabase/tests/091_zalo_message_reactions.sql supabase/tests/092_zalo_quotes.sql supabase/tests/093_zalo_file_replies.sql supabase/tests/096_recruitment_jobs.sql supabase/tests/097_candidate_flow_states.sql supabase/tests/098_content_settings.sql supabase/tests/099_content_posts_jobs.sql supabase/tests/100_account_owners_managers.sql supabase/tests/101_inbox_unread_by_account.sql supabase/tests/102_inbox_people_unread_saved_filters.sql supabase/tests/103_campaign_signals_and_dispatch.sql supabase/tests/104_assistant_conversations.sql supabase/tests/105_assistant_zalo_bot.sql supabase/tests/106_documents_permission.sql supabase/tests/107_assistant_bot_call_names.sql supabase/tests/108_assistant_bot_confirmations.sql supabase/tests/109_assistant_kpi_counts_people.sql supabase/tests/110_calendar_events.sql supabase/tests/111_assistant_generated_files.sql; do
  output=$(psql -v ON_ERROR_STOP=1 -q -o /dev/null -d "$DB" -f "$test" 2>&1) || { echo "$output" | tail -5; echo "FAILED: $test"; exit 1; }
  echo "PASS $test ($(echo "$output" | grep -c 'PASS:') checks)"
done
