# HireX Sales Agent Platform — Database Design

## 1. Conventions

The target database is Supabase PostgreSQL. This is a logical design, not a migration. All schema changes must later be delivered as reviewed, forward-only SQL migrations.

- Primary keys: UUID (`id`), generated server-side/database-side.
- Time: `timestamptz` in UTC; standard mutable tables have `created_at` and `updated_at`.
- Tenancy: tenant-owned tables include `workspace_id`; use PostgreSQL Row Level Security plus application authorization.
- Naming: `snake_case`; enum values are uppercase strings at domain boundaries.
- Deletion: prefer restricted or soft deletion for business/audit records; use `deleted_at` where recovery or compliance requires it.
- External IDs: uniqueness is scoped by provider/account, never assumed globally unique.
- JSONB: only for provider/model metadata that does not require relational constraints. Core relationships remain typed columns and foreign keys.
- Secrets: store encrypted ciphertext or secret-manager references, never plaintext tokens.
- Audit records are append-oriented and not updated by ordinary users.

## 2. Identity and tenancy

### `workspaces`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Tenant boundary |
| `name` | text | Display name |
| `slug` | citext | Unique public-safe slug |
| `operating_mode` | text | `MANUAL` or `AI_ASSIST`; no autonomous execution |
| `timezone` | text | IANA timezone |
| `settings` | jsonb | Non-secret workspace configuration |
| `created_at`, `updated_at` | timestamptz | Audit timestamps |

### `users`

Application profile mapped one-to-one to `auth.users`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK/FK | References `auth.users.id` |
| `email` | citext | Display/contact email; auth identity remains in Supabase Auth |
| `display_name` | text | Nullable |
| `avatar_url` | text | Nullable |
| `created_at`, `updated_at` | timestamptz | Audit timestamps |

A supporting `workspace_members` table is required even though it is not in the requested core list: `workspace_id`, `user_id`, `role` (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), status, timestamps; unique on `(workspace_id, user_id)`.

## 3. CRM

### `companies`

`id`, `workspace_id`, `name`, `domain`, `website_url`, `industry`, `size_band`, `description`, `owner_user_id`, `status`, `metadata jsonb`, `created_at`, `updated_at`, `deleted_at`.

Indexes/constraints: `(workspace_id, name)`, partial index on normalized domain, FK owner constrained to workspace membership at service level.

### `contacts`

Canonical person independent of channel.

`id`, `workspace_id`, `company_id` nullable, `first_name`, `last_name`, `display_name`, `job_title`, `lifecycle_stage`, `lead_status`, `owner_user_id`, `source`, `locale`, `timezone`, `notes`, `metadata jsonb`, `created_at`, `updated_at`, `deleted_at`.

Indexes: `(workspace_id, company_id)`, `(workspace_id, owner_user_id)`, searchable normalized name. Duplicate merging should preserve aliases and audit history.

### `contact_channels`

One contact can have many identities across and within channel types.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Channel identity |
| `workspace_id` | uuid FK | Tenant |
| `contact_id` | uuid FK | Canonical contact |
| `channel_type` | text | `EMAIL`, `FACEBOOK`, `WHATSAPP`, `ZALO`, `VIBER`, future values |
| `address` | text | Email, phone, or provider handle as received |
| `normalized_address` | text | Canonical matching form |
| `provider_contact_id` | text | Nullable provider identity |
| `label` | text | Work, personal, etc. |
| `is_primary`, `is_verified` | boolean | Contact-level flags |
| `consent_status` | text | `UNKNOWN`, `OPTED_IN`, `OPTED_OUT` |
| `consent_at` | timestamptz | Nullable evidence timestamp |
| `metadata` | jsonb | Provider-specific non-secret details |
| `created_at`, `updated_at` | timestamptz | Audit timestamps |

Unique candidates: `(workspace_id, channel_type, normalized_address)` when identity is globally meaningful; otherwise `(workspace_id, channel_type, provider_contact_id)` partial unique. Ambiguous identities require a merge/review workflow rather than silent reassignment.

### `tasks`

`id`, `workspace_id`, `title`, `description`, `status`, `priority`, `due_at`, `completed_at`, `assignee_user_id`, `created_by_user_id`, polymorphic typed references (`contact_id`, `company_id`, `opportunity_id`, `conversation_id` nullable), `source`, `agent_action_id` nullable, timestamps.

### `opportunities`

`id`, `workspace_id`, `company_id` nullable, `primary_contact_id` nullable, `name`, `stage`, `status`, `amount_minor`, `currency`, `probability`, `expected_close_date`, `owner_user_id`, `source`, `lost_reason`, timestamps, `deleted_at`.

## 4. Accounts, conversations, and messages

### `channel_accounts`

Generic connected provider account.

`id`, `workspace_id`, `channel_type`, `provider`, `external_account_id`, `display_name`, `status` (`PENDING`, `ACTIVE`, `REAUTH_REQUIRED`, `SUSPENDED`, `DISCONNECTED`), `credential_ref` or encrypted credential columns, `scopes text[]`, `token_expires_at`, `webhook_state`, `capabilities jsonb`, `settings jsonb`, `connected_by_user_id`, `last_synced_at`, timestamps.

Unique: `(workspace_id, provider, external_account_id)`. Credential material is server/worker-only and excluded from normal selects/logging.

### `email_accounts`

Email-specific one-to-one extension of a channel account; supports many email accounts per workspace.

`id`, `workspace_id`, `channel_account_id` unique FK, `email_address` citext, `provider`, `provider_history_cursor`, `signature_text`, `signature_html`, `send_as_name`, `sync_enabled`, `sync_started_at`, `last_history_at`, timestamps.

Constraint: referenced channel account must have an email-capable channel type, enforced by service/trigger.

### `conversations`

`id`, `workspace_id`, `channel_type`, `channel_account_id`, `contact_id` nullable, `external_thread_id` nullable, `subject` nullable, `status` (`OPEN`, `PENDING`, `CLOSED`, `SPAM`), `assigned_user_id` nullable, `last_message_at`, `last_inbound_at`, `last_outbound_at`, `metadata jsonb`, timestamps.

Unique partial index: `(channel_account_id, external_thread_id)` where external ID is present. Group conversations may later use a `conversation_participants` join table rather than changing the contact model.

### `messages`

`id`, `workspace_id`, `conversation_id`, `channel_account_id`, `contact_channel_id` nullable, `direction` (`INBOUND`, `OUTBOUND`), `sender_type` (`CONTACT`, `USER`, `AGENT`, `SYSTEM`), `sender_user_id` nullable, `provider_message_id` nullable, `idempotency_key` nullable, `reply_to_message_id` nullable, `subject`, `body_text`, `body_html`, `content_json`, `status`, `sent_at`, `received_at`, `provider_created_at`, `error_code`, `error_detail`, `metadata jsonb`, timestamps.

Unique partial indexes: `(channel_account_id, provider_message_id)` and `(workspace_id, idempotency_key)`. Store attachments in object storage with a separate `message_attachments` table; do not place binaries in PostgreSQL.

## 5. Campaigns and sequences

### `campaigns`

`id`, `workspace_id`, `name`, `description`, `status` (`DRAFT`, `SCHEDULED`, `RUNNING`, `PAUSED`, `COMPLETED`, `CANCELLED`), `channel_type`, `from_channel_account_id`, `audience_definition jsonb`, `owner_user_id`, `scheduled_at`, `started_at`, `completed_at`, timestamps.

### `sequences`

`id`, `workspace_id`, `campaign_id` nullable, `name`, `description`, `status` (`DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED`), `version`, `default_channel_type`, `created_by_user_id`, timestamps. Published/active versions should be immutable; edits create a new version.

### `sequence_steps`

`id`, `workspace_id`, `sequence_id`, `position`, `step_type` (`MESSAGE`, `WAIT`, `TASK`, future values), `delay_seconds`, `template_subject`, `template_body`, `configuration jsonb`, `requires_approval`, timestamps. Unique `(sequence_id, position)`; validate step configuration by type.

### `sequence_enrollments`

`id`, `workspace_id`, `sequence_id`, `contact_id`, `campaign_id` nullable, `status` (`PENDING`, `ACTIVE`, `PAUSED`, `COMPLETED`, `STOPPED`, `FAILED`), `current_step_id` nullable, `channel_account_id`, `contact_channel_id`, `next_run_at`, `started_at`, `completed_at`, `stop_reason`, `enrolled_by_user_id`, timestamps.

Prevent duplicate active enrollment with a partial unique index on `(sequence_id, contact_id)` for active-like statuses. Suppression and consent are rechecked at every outbound step, not only enrollment.

## 6. Events, agents, and governance

### `email_events`

`id`, `workspace_id`, `message_id`, `email_account_id`, `event_type` (`QUEUED`, `SENT`, `DELIVERED`, `BOUNCED`, `OPENED`, `CLICKED`, `REPLIED`, `COMPLAINED`, `UNSUBSCRIBED`), `provider_event_id`, `occurred_at`, `url` nullable, `recipient` nullable, `raw_metadata jsonb`, `created_at`.

Unique partial `(email_account_id, provider_event_id)`. Open/click data can be noisy and privacy-sensitive; preserve raw facts and derive aggregates separately.

### `agent_runs`

`id`, `workspace_id`, `run_type`, `status` (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`), `trigger_type`, `trigger_ref_type`, `trigger_ref_id`, `requested_by_user_id` nullable, `operating_mode` (`MANUAL`, `AI_ASSIST`), `model_provider`, `model_name`, `prompt_version`, `input_refs jsonb`, `input_hash`, `started_at`, `completed_at`, token usage/cost fields, `error_code`, `error_detail`, `correlation_id`, timestamps.

Inputs should reference or hash durable data; copied sensitive context needs retention limits and redaction.

### `agent_actions`

`id`, `workspace_id`, `agent_run_id`, `action_type`, `status` (`PROPOSED`, `VALIDATED`, `AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `QUEUED`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `CANCELLED`), `target_type`, `target_id`, `payload jsonb`, `payload_schema_version`, `risk_level`, `policy_decision`, `policy_reasons jsonb`, `idempotency_key`, `approved_by_user_id`, `approved_at`, `executed_at`, `result_ref_type`, `result_ref_id`, `error_code`, `error_detail`, timestamps.

Unique `(workspace_id, idempotency_key)`. The database must not allow an unapproved side-effecting action to jump directly to execution; enforce through privileged service paths and state-transition checks.

### `audit_logs`

`id` (UUID or time-sortable ID), `workspace_id`, `occurred_at`, `actor_type` (`USER`, `AGENT`, `SYSTEM`, `CONNECTOR`), `actor_user_id` nullable, `actor_ref_id` nullable, `action`, `resource_type`, `resource_id`, `request_id`, `correlation_id`, `ip_address` nullable, `user_agent` nullable, `before_data jsonb` nullable, `after_data jsonb` nullable, `metadata jsonb`, `outcome`.

Append-only permissions; partition by time if volume requires it. Redact secrets and high-risk message content. Retention and export rules are workspace/compliance controlled.

### `suppression_list`

`id`, `workspace_id`, `channel_type`, `normalized_address`, `contact_id` nullable, `contact_channel_id` nullable, `scope` (`WORKSPACE`, `CAMPAIGN`), `campaign_id` nullable, `reason` (`UNSUBSCRIBED`, `BOUNCE`, `COMPLAINT`, `MANUAL`, `LEGAL`), `source`, `suppressed_at`, `expires_at` nullable, `created_by_user_id` nullable, `evidence jsonb`, `created_at`.

Unique active suppression key should cover workspace, channel, normalized address, scope, and campaign where relevant. Sends use deny-by-default when suppression state cannot be reliably checked.

## 7. Relationship summary

```text
workspace -> workspace_members -> users
workspace -> companies -> contacts -> contact_channels
workspace -> channel_accounts -> email_accounts
contact + channel_account -> conversations -> messages -> email_events
campaign -> sequences -> sequence_steps
sequence + contact -> sequence_enrollments
agent_runs -> agent_actions -> optional message/task execution result
workspace -> audit_logs
workspace/contact/channel -> suppression_list
```

## 8. RLS, integrity, and migration requirements

- Enable RLS on every tenant-owned table; policies derive accessible workspace IDs from authenticated membership. Service-role access is limited to narrowly scoped backend/worker processes.
- Include composite tenant consistency checks where practical so a child cannot reference a parent from another workspace. Where PostgreSQL cannot express the rule cleanly, enforce it in a transaction and test it.
- Use foreign keys, check constraints, partial unique indexes, and state transition functions rather than relying only on TypeScript.
- Index all foreign keys and high-frequency queue/inbox predicates such as `(workspace_id, status, next_run_at)` and `(workspace_id, last_message_at desc)`.
- Migrations include forward migration, data backfill strategy, verification query, rollback/mitigation notes, and RLS policy tests.
- Use an application outbox table when implementation begins to atomically record domain changes that must enqueue jobs.
