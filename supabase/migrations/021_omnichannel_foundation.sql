-- HireX Phase 6A: canonical omnichannel foundation.
-- Provider credentials and provider-specific payloads remain outside browser access.
begin;

alter table public.contact_channels
  add column marketing_consent_status text not null default 'UNKNOWN',
  add column marketing_consent_source text,
  add column marketing_consent_recorded_at timestamptz,
  add constraint contact_channels_marketing_consent_status_allowed
    check(marketing_consent_status in ('UNKNOWN','OPTED_IN','OPTED_OUT')),
  add constraint contact_channels_marketing_consent_shape check(
    (marketing_consent_status = 'UNKNOWN' and marketing_consent_source is null and marketing_consent_recorded_at is null)
    or (marketing_consent_status in ('OPTED_IN','OPTED_OUT') and marketing_consent_source is not null and btrim(marketing_consent_source) <> '' and marketing_consent_recorded_at is not null)
  );

create index contact_channels_marketing_consent_idx
  on public.contact_channels(workspace_id,channel_type,marketing_consent_status);

create table public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connected_by uuid not null,
  channel_type text not null,
  provider text not null,
  external_account_id text not null,
  legacy_email_account_id uuid,
  display_name text,
  status text not null default 'CONNECTED',
  capabilities text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  last_health_check_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_accounts_id_workspace_key unique(id, workspace_id),
  constraint channel_accounts_id_workspace_type_key unique(id, workspace_id, channel_type),
  constraint channel_accounts_profile_workspace_fk foreign key(connected_by, workspace_id)
    references public.profiles(id, workspace_id) on delete restrict,
  constraint channel_accounts_legacy_email_workspace_fk foreign key(legacy_email_account_id, workspace_id)
    references public.email_accounts(id, workspace_id) on delete cascade,
  constraint channel_accounts_email_link_shape check(
    (channel_type = 'EMAIL' and legacy_email_account_id is not null)
    or (channel_type <> 'EMAIL' and legacy_email_account_id is null)
  ),
  constraint channel_accounts_type_allowed check(channel_type in ('EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER')),
  constraint channel_accounts_status_allowed check(status in ('CONNECTED','REAUTH_REQUIRED','DISCONNECTED','ERROR')),
  constraint channel_accounts_provider_not_blank check(btrim(provider) <> ''),
  constraint channel_accounts_external_id_not_blank check(btrim(external_account_id) <> ''),
  constraint channel_accounts_capabilities_no_nulls check(array_position(capabilities, null) is null),
  constraint channel_accounts_metadata_object check(jsonb_typeof(metadata) = 'object'),
  constraint channel_accounts_error_code_not_blank check(last_error_code is null or btrim(last_error_code) <> '')
);

create unique index channel_accounts_external_identity_key
  on public.channel_accounts(workspace_id, channel_type, lower(provider), lower(btrim(external_account_id)));
create unique index channel_accounts_legacy_email_key
  on public.channel_accounts(workspace_id, legacy_email_account_id)
  where legacy_email_account_id is not null;
create index channel_accounts_workspace_status_idx on public.channel_accounts(workspace_id, status, channel_type);

create table public.channel_account_credentials (
  channel_account_id uuid primary key,
  workspace_id uuid not null,
  access_token_encrypted text,
  webhook_secret_encrypted text not null,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_account_credentials_account_workspace_fk foreign key(channel_account_id,workspace_id) references public.channel_accounts(id,workspace_id) on delete cascade,
  constraint channel_account_credentials_access_not_blank check(access_token_encrypted is null or btrim(access_token_encrypted)<>''),
  constraint channel_account_credentials_webhook_not_blank check(btrim(webhook_secret_encrypted)<>''),
  constraint channel_account_credentials_configuration_object check(jsonb_typeof(configuration)='object')
);

create table public.omnichannel_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null,
  channel_type text not null,
  provider_conversation_id text not null,
  contact_id uuid,
  subject text,
  status text not null default 'OPEN',
  takeover_mode text not null default 'BOT_ALLOWED',
  assigned_to uuid,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omnichannel_conversations_id_workspace_key unique(id, workspace_id),
  constraint omnichannel_conversations_account_workspace_type_fk foreign key(channel_account_id, workspace_id, channel_type)
    references public.channel_accounts(id, workspace_id, channel_type) on delete cascade,
  constraint omnichannel_conversations_contact_workspace_fk foreign key(contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete set null(contact_id),
  constraint omnichannel_conversations_assignee_workspace_fk foreign key(assigned_to, workspace_id)
    references public.profiles(id, workspace_id) on delete set null(assigned_to),
  constraint omnichannel_conversations_type_allowed check(channel_type in ('EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER')),
  constraint omnichannel_conversations_provider_id_not_blank check(btrim(provider_conversation_id) <> ''),
  constraint omnichannel_conversations_status_allowed check(status in ('OPEN','PENDING','RESOLVED','SPAM')),
  constraint omnichannel_conversations_takeover_allowed check(takeover_mode in ('BOT_ALLOWED','HUMAN_TAKEOVER')),
  constraint omnichannel_conversations_unread_nonnegative check(unread_count >= 0),
  constraint omnichannel_conversations_metadata_object check(jsonb_typeof(metadata) = 'object'),
  constraint omnichannel_conversations_type_matches_account unique(id, workspace_id, channel_account_id, channel_type)
);

create unique index omnichannel_conversations_provider_identity_key
  on public.omnichannel_conversations(workspace_id, channel_account_id, provider_conversation_id);
create index omnichannel_conversations_inbox_idx
  on public.omnichannel_conversations(workspace_id, status, last_message_at desc nulls last);
create index omnichannel_conversations_contact_idx
  on public.omnichannel_conversations(workspace_id, contact_id) where contact_id is not null;
create index omnichannel_conversations_assignee_idx
  on public.omnichannel_conversations(workspace_id, assigned_to, status) where assigned_to is not null;

create table public.omnichannel_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  channel_account_id uuid not null,
  channel_type text not null,
  provider_message_id text not null,
  provider_event_id text,
  direction text not null,
  sender_external_id text not null,
  recipient_external_ids text[] not null default '{}'::text[],
  text_content text,
  attachment_count integer not null default 0,
  sent_at timestamptz,
  received_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omnichannel_messages_id_workspace_key unique(id, workspace_id),
  constraint omnichannel_messages_conversation_scope_fk
    foreign key(conversation_id, workspace_id, channel_account_id, channel_type)
    references public.omnichannel_conversations(id, workspace_id, channel_account_id, channel_type) on delete cascade,
  constraint omnichannel_messages_direction_allowed check(direction in ('INBOUND','OUTBOUND')),
  constraint omnichannel_messages_provider_id_not_blank check(btrim(provider_message_id) <> ''),
  constraint omnichannel_messages_sender_not_blank check(btrim(sender_external_id) <> ''),
  constraint omnichannel_messages_recipients_no_nulls check(array_position(recipient_external_ids, null) is null),
  constraint omnichannel_messages_attachment_count_nonnegative check(attachment_count >= 0),
  constraint omnichannel_messages_has_content check(text_content is not null or attachment_count > 0),
  constraint omnichannel_messages_time_shape check(
    (direction = 'INBOUND' and received_at is not null)
    or (direction = 'OUTBOUND' and sent_at is not null)
  ),
  constraint omnichannel_messages_metadata_object check(jsonb_typeof(metadata) = 'object')
);

create unique index omnichannel_messages_provider_identity_key
  on public.omnichannel_messages(workspace_id, channel_account_id, provider_message_id);
create unique index omnichannel_messages_provider_event_key
  on public.omnichannel_messages(workspace_id, channel_account_id, provider_event_id)
  where provider_event_id is not null;
create index omnichannel_messages_timeline_idx
  on public.omnichannel_messages(workspace_id, conversation_id, coalesce(received_at, sent_at) desc);

create table public.channel_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  source text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint channel_attachments_id_workspace_key unique(id, workspace_id),
  constraint channel_attachments_creator_workspace_fk foreign key(created_by, workspace_id)
    references public.profiles(id, workspace_id) on delete set null(created_by),
  constraint channel_attachments_bucket_not_blank check(btrim(storage_bucket) <> ''),
  constraint channel_attachments_path_not_blank check(btrim(storage_path) <> '' and storage_path !~ '(^|/)\.\.(/|$)'),
  constraint channel_attachments_filename_safe check(btrim(filename) <> '' and length(filename) <= 255 and filename !~ '[[:cntrl:]]'),
  constraint channel_attachments_content_type_not_blank check(btrim(content_type) <> ''),
  constraint channel_attachments_size_range check(size_bytes between 0 and 26214400),
  constraint channel_attachments_sha256_shape check(sha256 ~ '^[0-9a-f]{64}$'),
  constraint channel_attachments_source_allowed check(source in ('INBOUND_PROVIDER','HUMAN_UPLOAD','CAMPAIGN_ASSET'))
);
create unique index channel_attachments_storage_key on public.channel_attachments(workspace_id, storage_bucket, storage_path);

create table public.channel_message_attachments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id uuid not null,
  attachment_id uuid not null,
  position integer not null default 0,
  primary key(message_id, attachment_id),
  constraint channel_message_attachments_message_workspace_fk foreign key(message_id, workspace_id)
    references public.omnichannel_messages(id, workspace_id) on delete cascade,
  constraint channel_message_attachments_attachment_workspace_fk foreign key(attachment_id, workspace_id)
    references public.channel_attachments(id, workspace_id) on delete cascade,
  constraint channel_message_attachments_position_nonnegative check(position >= 0)
);
create unique index channel_message_attachments_position_key on public.channel_message_attachments(message_id, position);

create table public.channel_inbound_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null,
  provider_event_id text not null,
  event_type text not null,
  payload_reference text not null,
  status text not null default 'RECEIVED',
  safe_error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint channel_inbound_events_id_workspace_key unique(id, workspace_id),
  constraint channel_inbound_events_account_workspace_fk foreign key(channel_account_id, workspace_id)
    references public.channel_accounts(id, workspace_id) on delete cascade,
  constraint channel_inbound_events_provider_id_not_blank check(btrim(provider_event_id) <> ''),
  constraint channel_inbound_events_type_not_blank check(btrim(event_type) <> ''),
  constraint channel_inbound_events_reference_not_blank check(btrim(payload_reference) <> ''),
  constraint channel_inbound_events_status_allowed check(status in ('RECEIVED','PROCESSING','PROCESSED','FAILED')),
  constraint channel_inbound_events_error_not_blank check(safe_error_code is null or btrim(safe_error_code) <> '')
);

create unique index channel_inbound_events_dedupe_key
  on public.channel_inbound_events(workspace_id, channel_account_id, provider_event_id);
create index channel_inbound_events_processing_idx
  on public.channel_inbound_events(workspace_id, status, received_at);

create table public.channel_policy_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid,
  channel_account_id uuid not null,
  channel_type text not null,
  normalized_recipient text not null,
  allowed boolean not null,
  reason_codes text[] not null default '{}'::text[],
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint channel_policy_decisions_id_workspace_key unique(id, workspace_id),
  constraint channel_policy_decisions_account_workspace_type_fk foreign key(channel_account_id, workspace_id, channel_type)
    references public.channel_accounts(id, workspace_id, channel_type) on delete cascade,
  constraint channel_policy_decisions_conversation_workspace_fk foreign key(conversation_id, workspace_id)
    references public.omnichannel_conversations(id, workspace_id) on delete cascade,
  constraint channel_policy_decisions_type_allowed check(channel_type in ('EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER')),
  constraint channel_policy_decisions_recipient_not_blank check(btrim(normalized_recipient) <> ''),
  constraint channel_policy_decisions_reasons_no_nulls check(array_position(reason_codes, null) is null)
);
create index channel_policy_decisions_expiry_idx on public.channel_policy_decisions(workspace_id, expires_at);

create table public.channel_outbound_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid,
  channel_account_id uuid not null,
  channel_type text not null,
  recipient_external_id text not null,
  status text not null default 'PROPOSED',
  text_content text,
  attachment_ids uuid[] not null default '{}'::uuid[],
  idempotency_key text not null,
  policy_decision_id uuid not null,
  proposed_by text not null default 'HUMAN',
  approved_by uuid,
  approved_at timestamptz,
  provider_message_id text,
  provider_conversation_id text,
  attempt_count integer not null default 0,
  execution_lock_id uuid,
  execution_lock_at timestamptz,
  accepted_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_outbound_actions_id_workspace_key unique(id, workspace_id),
  constraint channel_outbound_actions_account_workspace_type_fk foreign key(channel_account_id, workspace_id, channel_type)
    references public.channel_accounts(id, workspace_id, channel_type) on delete cascade,
  constraint channel_outbound_actions_conversation_workspace_fk foreign key(conversation_id, workspace_id)
    references public.omnichannel_conversations(id, workspace_id) on delete restrict,
  constraint channel_outbound_actions_policy_workspace_fk foreign key(policy_decision_id, workspace_id)
    references public.channel_policy_decisions(id, workspace_id) on delete restrict,
  constraint channel_outbound_actions_approver_workspace_fk foreign key(approved_by, workspace_id)
    references public.profiles(id, workspace_id) on delete restrict,
  constraint channel_outbound_actions_type_allowed check(channel_type in ('EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER')),
  constraint channel_outbound_actions_recipient_not_blank check(btrim(recipient_external_id) <> ''),
  constraint channel_outbound_actions_status_allowed check(status in ('PROPOSED','APPROVED','QUEUED','EXECUTING','SENT','FAILED','DELIVERY_UNKNOWN','CANCELLED')),
  constraint channel_outbound_actions_has_content check(text_content is not null or cardinality(attachment_ids) > 0),
  constraint channel_outbound_actions_idempotency_not_blank check(btrim(idempotency_key) <> ''),
  constraint channel_outbound_actions_proposer_allowed check(proposed_by in ('HUMAN','AI_ASSIST')),
  constraint channel_outbound_actions_attempt_nonnegative check(attempt_count >= 0),
  constraint channel_outbound_actions_lock_shape check(
    (status in ('EXECUTING','DELIVERY_UNKNOWN') and execution_lock_id is not null and execution_lock_at is not null)
    or (status not in ('EXECUTING','DELIVERY_UNKNOWN') and execution_lock_id is null and execution_lock_at is null)
  ),
  constraint channel_outbound_actions_sent_shape check(
    status <> 'SENT' or (provider_message_id is not null and provider_conversation_id is not null and accepted_at is not null)
  ),
  constraint channel_outbound_actions_approval_shape check(
    (status = 'PROPOSED' and approved_by is null and approved_at is null)
    or (status <> 'PROPOSED' and approved_by is not null and approved_at is not null)
  )
);

create unique index channel_outbound_actions_idempotency_key
  on public.channel_outbound_actions(workspace_id, channel_account_id, idempotency_key);
create index channel_outbound_actions_queue_idx
  on public.channel_outbound_actions(workspace_id, status, created_at);

create table public.conversation_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_tags_id_workspace_key unique(id, workspace_id),
  constraint conversation_tags_name_not_blank check(btrim(name) <> ''),
  constraint conversation_tags_color_shape check(color is null or color ~ '^#[0-9A-Fa-f]{6}$')
);
create unique index conversation_tags_workspace_name_key on public.conversation_tags(workspace_id, lower(btrim(name)));

create table public.conversation_tag_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(conversation_id, tag_id),
  constraint conversation_tag_links_conversation_workspace_fk foreign key(conversation_id, workspace_id)
    references public.omnichannel_conversations(id, workspace_id) on delete cascade,
  constraint conversation_tag_links_tag_workspace_fk foreign key(tag_id, workspace_id)
    references public.conversation_tags(id, workspace_id) on delete cascade
);

create table public.quick_reply_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  shortcut text not null,
  text_content text not null,
  channel_types text[] not null default '{}'::text[],
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_reply_templates_creator_workspace_fk foreign key(created_by, workspace_id)
    references public.profiles(id, workspace_id) on delete restrict,
  constraint quick_reply_templates_name_not_blank check(btrim(name) <> ''),
  constraint quick_reply_templates_shortcut_shape check(shortcut ~ '^[a-z0-9_-]{1,40}$'),
  constraint quick_reply_templates_content_not_blank check(btrim(text_content) <> ''),
  constraint quick_reply_templates_channels_allowed check(
    channel_types <@ array['EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER']::text[]
    and array_position(channel_types, null) is null
  )
);
create unique index quick_reply_templates_workspace_shortcut_key
  on public.quick_reply_templates(workspace_id, lower(shortcut));

create table public.channel_suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_type text not null,
  normalized_recipient text not null,
  reason text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint channel_suppressions_type_allowed check(channel_type in ('EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER')),
  constraint channel_suppressions_recipient_not_blank check(btrim(normalized_recipient) <> ''),
  constraint channel_suppressions_reason_allowed check(reason in ('MANUAL','UNSUBSCRIBED','HARD_BOUNCE','COMPLAINT','PROVIDER_BLOCK')),
  constraint channel_suppressions_source_not_blank check(btrim(source) <> '')
);
create unique index channel_suppressions_identity_key
  on public.channel_suppressions(workspace_id, channel_type, lower(btrim(normalized_recipient)));

create function public.enforce_channel_suppression_precedence()
returns trigger language plpgsql set search_path = '' as $$
declare v_old_rank integer; v_new_rank integer;
begin
  v_old_rank := case old.reason when 'MANUAL' then 1 when 'PROVIDER_BLOCK' then 2 when 'UNSUBSCRIBED' then 3 when 'HARD_BOUNCE' then 4 when 'COMPLAINT' then 5 else 0 end;
  v_new_rank := case new.reason when 'MANUAL' then 1 when 'PROVIDER_BLOCK' then 2 when 'UNSUBSCRIBED' then 3 when 'HARD_BOUNCE' then 4 when 'COMPLAINT' then 5 else 0 end;
  if v_new_rank < v_old_rank then raise exception 'Channel suppression cannot be downgraded'; end if;
  return new;
end $$;
create trigger channel_suppressions_precedence before update on public.channel_suppressions
for each row execute function public.enforce_channel_suppression_precedence();

create table public.channel_delivery_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null,
  outbound_action_id uuid,
  message_id uuid,
  provider_event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint channel_delivery_events_account_workspace_fk foreign key(channel_account_id, workspace_id)
    references public.channel_accounts(id, workspace_id) on delete cascade,
  constraint channel_delivery_events_action_workspace_fk foreign key(outbound_action_id, workspace_id)
    references public.channel_outbound_actions(id, workspace_id) on delete cascade,
  constraint channel_delivery_events_message_workspace_fk foreign key(message_id, workspace_id)
    references public.omnichannel_messages(id, workspace_id) on delete cascade,
  constraint channel_delivery_events_provider_id_not_blank check(btrim(provider_event_id) <> ''),
  constraint channel_delivery_events_type_allowed check(event_type in ('ACCEPTED','DELIVERED','READ','CLICKED','REPLIED','FAILED','UNKNOWN')),
  constraint channel_delivery_events_metadata_object check(jsonb_typeof(metadata) = 'object')
);
create unique index channel_delivery_events_dedupe_key
  on public.channel_delivery_events(workspace_id, channel_account_id, provider_event_id, event_type);
create index channel_delivery_events_reporting_idx
  on public.channel_delivery_events(workspace_id, event_type, occurred_at desc);

create table public.channel_automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  enabled boolean not null default false,
  version integer not null default 1,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_automations_id_workspace_key unique(id, workspace_id),
  constraint channel_automations_creator_workspace_fk foreign key(created_by, workspace_id)
    references public.profiles(id, workspace_id) on delete restrict,
  constraint channel_automations_name_not_blank check(btrim(name) <> ''),
  constraint channel_automations_version_positive check(version > 0),
  constraint channel_automations_trigger_allowed check(trigger_type in ('MESSAGE_RECEIVED','KEYWORD_MATCHED','TAG_ADDED','CONVERSATION_ASSIGNED','SCHEDULED')),
  constraint channel_automations_trigger_object check(jsonb_typeof(trigger_config) = 'object'),
  constraint channel_automations_actions_array check(jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 20)
);
create index channel_automations_enabled_idx on public.channel_automations(workspace_id, enabled, trigger_type);

create table public.channel_automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  automation_id uuid not null,
  conversation_id uuid,
  trigger_event_id uuid,
  idempotency_key text not null,
  status text not null default 'PENDING',
  safe_error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint channel_automation_runs_automation_workspace_fk foreign key(automation_id, workspace_id)
    references public.channel_automations(id, workspace_id) on delete cascade,
  constraint channel_automation_runs_conversation_workspace_fk foreign key(conversation_id, workspace_id)
    references public.omnichannel_conversations(id, workspace_id) on delete cascade,
  constraint channel_automation_runs_event_workspace_fk foreign key(trigger_event_id, workspace_id)
    references public.channel_inbound_events(id, workspace_id) on delete cascade,
  constraint channel_automation_runs_idempotency_not_blank check(btrim(idempotency_key) <> ''),
  constraint channel_automation_runs_status_allowed check(status in ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED')),
  constraint channel_automation_runs_error_not_blank check(safe_error_code is null or btrim(safe_error_code) <> '')
);
alter table public.channel_automation_runs add constraint channel_automation_runs_id_workspace_key unique(id,workspace_id);
create unique index channel_automation_runs_idempotency_key
  on public.channel_automation_runs(workspace_id, automation_id, idempotency_key);

create table public.channel_automation_proposals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  automation_run_id uuid not null, conversation_id uuid not null,
  action_type text not null, configuration jsonb not null,
  status text not null default 'PROPOSED', reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint channel_automation_proposals_run_workspace_fk foreign key(automation_run_id,workspace_id) references public.channel_automation_runs(id,workspace_id) on delete cascade,
  constraint channel_automation_proposals_conversation_workspace_fk foreign key(conversation_id,workspace_id) references public.omnichannel_conversations(id,workspace_id) on delete cascade,
  constraint channel_automation_proposals_reviewer_workspace_fk foreign key(reviewed_by,workspace_id) references public.profiles(id,workspace_id) on delete restrict,
  constraint channel_automation_proposals_action_allowed check(action_type in ('ADD_TAG','REMOVE_TAG','ASSIGN_CONVERSATION','SET_CONVERSATION_STATUS','PROPOSE_MESSAGE','CREATE_TASK')),
  constraint channel_automation_proposals_configuration_object check(jsonb_typeof(configuration)='object'),
  constraint channel_automation_proposals_status_allowed check(status in ('PROPOSED','APPROVED','REJECTED','APPLIED')),
  constraint channel_automation_proposals_review_shape check((status='PROPOSED' and reviewed_by is null and reviewed_at is null) or (status<>'PROPOSED' and reviewed_by is not null and reviewed_at is not null))
);
create index channel_automation_proposals_review_idx on public.channel_automation_proposals(workspace_id,status,created_at);

create table public.channel_tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid, title text not null, status text not null default 'OPEN', assigned_to uuid, due_at timestamptz,
  source_automation_proposal_id uuid, created_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint channel_tasks_conversation_workspace_fk foreign key(conversation_id,workspace_id) references public.omnichannel_conversations(id,workspace_id) on delete cascade,
  constraint channel_tasks_assignee_workspace_fk foreign key(assigned_to,workspace_id) references public.profiles(id,workspace_id) on delete restrict,
  constraint channel_tasks_creator_workspace_fk foreign key(created_by,workspace_id) references public.profiles(id,workspace_id) on delete restrict,
  constraint channel_tasks_title_not_blank check(btrim(title)<>'' and length(btrim(title))<=240),
  constraint channel_tasks_status_allowed check(status in ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'))
);
create index channel_tasks_queue_idx on public.channel_tasks(workspace_id,status,due_at);

-- Backfill the existing Gmail mailbox into the canonical read model. Token
-- ciphertext remains exclusively in email_accounts and is never copied here.
insert into public.channel_accounts(
  workspace_id, connected_by, channel_type, provider, external_account_id,
  legacy_email_account_id, display_name, status, capabilities,
  last_health_check_at, last_error_code
)
select
  account.workspace_id,
  account.connected_by,
  'EMAIL',
  account.provider,
  lower(btrim(account.email_address)),
  account.id,
  account.display_name,
  account.status,
  array_remove(array[
    case when account.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[] then 'SEND_TEXT' end,
    case when account.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[] then 'SEND_FILE' end,
    case when account.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[] then 'REPLY' end
  ], null),
  account.last_sync_at,
  case when account.last_sync_error is null then null else 'EMAIL_SYNC_ERROR' end
from public.email_accounts account;

insert into public.omnichannel_conversations(
  id, workspace_id, channel_account_id, channel_type,
  provider_conversation_id, contact_id, subject, status,
  takeover_mode, last_message_at, unread_count, metadata,
  created_at, updated_at
)
select
  thread.id,
  thread.workspace_id,
  channel.id,
  'EMAIL',
  thread.provider_thread_id,
  thread.contact_id,
  thread.subject,
  'OPEN',
  'BOT_ALLOWED',
  thread.last_message_at,
  case when thread.is_unread then 1 else 0 end,
  jsonb_build_object('legacyEmailThread', true),
  thread.created_at,
  thread.updated_at
from public.email_threads thread
join public.channel_accounts channel
  on channel.workspace_id = thread.workspace_id
 and channel.legacy_email_account_id = thread.email_account_id;

insert into public.omnichannel_messages(
  id, workspace_id, conversation_id, channel_account_id, channel_type,
  provider_message_id, provider_event_id, direction, sender_external_id,
  recipient_external_ids, text_content, attachment_count, sent_at,
  received_at, metadata, created_at, updated_at
)
select
  message.id,
  message.workspace_id,
  message.email_thread_id,
  channel.id,
  'EMAIL',
  message.provider_message_id,
  null,
  message.direction,
  coalesce(nullif(btrim(message.from_email), ''), 'unknown'),
  coalesce(message.to_emails, '{}'::text[]),
  coalesce(message.body_text, message.snippet, ''),
  message.attachment_count,
  case when message.direction = 'OUTBOUND' then coalesce(message.sent_at, message.provider_internal_date, message.created_at) end,
  case when message.direction = 'INBOUND' then coalesce(message.received_at, message.provider_internal_date, message.created_at) end,
  jsonb_build_object('legacyEmailMessage', true, 'hasAttachments', message.has_attachments),
  message.created_at,
  message.updated_at
from public.email_messages message
join public.channel_accounts channel
  on channel.workspace_id = message.workspace_id
 and channel.legacy_email_account_id = message.email_account_id;

create function public.sync_email_thread_to_omnichannel()
returns trigger language plpgsql set search_path = '' as $$
declare v_channel_account_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.omnichannel_conversations
    where id = old.id and workspace_id = old.workspace_id;
    return old;
  end if;
  select id into v_channel_account_id
  from public.channel_accounts
  where workspace_id = new.workspace_id and legacy_email_account_id = new.email_account_id;
  if v_channel_account_id is null then
    raise exception 'Canonical email channel account is unavailable';
  end if;
  insert into public.omnichannel_conversations(
    id, workspace_id, channel_account_id, channel_type, provider_conversation_id,
    contact_id, subject, status, takeover_mode, last_message_at, unread_count,
    metadata, created_at, updated_at
  ) values (
    new.id, new.workspace_id, v_channel_account_id, 'EMAIL', new.provider_thread_id,
    new.contact_id, new.subject, 'OPEN', 'BOT_ALLOWED', new.last_message_at,
    case when new.is_unread then 1 else 0 end,
    jsonb_build_object('legacyEmailThread', true), new.created_at, new.updated_at
  ) on conflict(id) do update set
    contact_id = excluded.contact_id,
    subject = excluded.subject,
    last_message_at = excluded.last_message_at,
    unread_count = excluded.unread_count,
    updated_at = excluded.updated_at;
  return new;
end $$;

create function public.sync_email_account_to_channel_account()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  insert into public.channel_accounts(
    workspace_id, connected_by, channel_type, provider, external_account_id,
    legacy_email_account_id, display_name, status, capabilities,
    last_health_check_at, last_error_code
  ) values (
    new.workspace_id, new.connected_by, 'EMAIL', new.provider,
    lower(btrim(new.email_address)), new.id, new.display_name, new.status,
    array_remove(array[
      case when new.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[] then 'SEND_TEXT' end,
      case when new.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[] then 'SEND_FILE' end,
      case when new.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[] then 'REPLY' end
    ], null),
    new.last_sync_at,
    case when new.last_sync_error is null then null else 'EMAIL_SYNC_ERROR' end
  ) on conflict(workspace_id, legacy_email_account_id) where legacy_email_account_id is not null
  do update set
    connected_by = excluded.connected_by,
    external_account_id = excluded.external_account_id,
    display_name = excluded.display_name,
    status = excluded.status,
    capabilities = excluded.capabilities,
    last_health_check_at = excluded.last_health_check_at,
    last_error_code = excluded.last_error_code;
  return new;
end $$;

create function public.sync_email_message_to_omnichannel()
returns trigger language plpgsql set search_path = '' as $$
declare v_channel_account_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.omnichannel_messages
    where id = old.id and workspace_id = old.workspace_id;
    return old;
  end if;
  select id into v_channel_account_id
  from public.channel_accounts
  where workspace_id = new.workspace_id and legacy_email_account_id = new.email_account_id;
  if v_channel_account_id is null then
    raise exception 'Canonical email channel account is unavailable';
  end if;
  insert into public.omnichannel_messages(
    id, workspace_id, conversation_id, channel_account_id, channel_type,
    provider_message_id, provider_event_id, direction, sender_external_id,
    recipient_external_ids, text_content, attachment_count, sent_at,
    received_at, metadata, created_at, updated_at
  ) values (
    new.id, new.workspace_id, new.email_thread_id, v_channel_account_id, 'EMAIL',
    new.provider_message_id, null, new.direction,
    coalesce(nullif(btrim(new.from_email), ''), 'unknown'),
    coalesce(new.to_emails, '{}'::text[]), coalesce(new.body_text, new.snippet, ''),
    new.attachment_count,
    case when new.direction = 'OUTBOUND' then coalesce(new.sent_at, new.provider_internal_date, new.created_at) end,
    case when new.direction = 'INBOUND' then coalesce(new.received_at, new.provider_internal_date, new.created_at) end,
    jsonb_build_object('legacyEmailMessage', true, 'hasAttachments', new.has_attachments),
    new.created_at, new.updated_at
  ) on conflict(id) do update set
    conversation_id = excluded.conversation_id,
    sender_external_id = excluded.sender_external_id,
    recipient_external_ids = excluded.recipient_external_ids,
    text_content = excluded.text_content,
    attachment_count = excluded.attachment_count,
    sent_at = excluded.sent_at,
    received_at = excluded.received_at,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at;
  return new;
end $$;

create trigger email_threads_omnichannel_sync
after insert or update or delete on public.email_threads
for each row execute function public.sync_email_thread_to_omnichannel();
create trigger email_messages_omnichannel_sync
after insert or update or delete on public.email_messages
for each row execute function public.sync_email_message_to_omnichannel();
create trigger email_accounts_omnichannel_sync
after insert or update on public.email_accounts
for each row execute function public.sync_email_account_to_channel_account();
revoke all on function public.sync_email_account_to_channel_account() from public, anon, authenticated;
revoke all on function public.sync_email_thread_to_omnichannel() from public, anon, authenticated;
revoke all on function public.sync_email_message_to_omnichannel() from public, anon, authenticated;

create function public.set_omnichannel_conversation_controls(
  p_conversation_id uuid,
  p_status text,
  p_takeover_mode text,
  p_assigned_to uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid();
begin
  if v_workspace_id is null or v_actor_id is null
    or p_status not in ('OPEN','PENDING','RESOLVED','SPAM')
    or p_takeover_mode not in ('BOT_ALLOWED','HUMAN_TAKEOVER') then return false; end if;
  if p_assigned_to is not null and not exists(
    select 1 from public.profiles where id = p_assigned_to and workspace_id = v_workspace_id
  ) then return false; end if;
  update public.omnichannel_conversations set
    status = p_status, takeover_mode = p_takeover_mode, assigned_to = p_assigned_to
  where id = p_conversation_id and workspace_id = v_workspace_id;
  if not found then return false; end if;
  insert into public.audit_logs(workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values(v_workspace_id, v_actor_id, 'CONVERSATION_CONTROLS_UPDATED', 'OMNICHANNEL_CONVERSATION', p_conversation_id,
    jsonb_build_object('status', p_status, 'takeoverMode', p_takeover_mode, 'assignedTo', p_assigned_to));
  return true;
end $$;

create function public.create_conversation_tag(p_name text, p_color text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_name is null or btrim(p_name) = ''
    or length(btrim(p_name)) > 80 or (p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$') then return null; end if;
  insert into public.conversation_tags(workspace_id, name, color)
  values(v_workspace_id, btrim(p_name), p_color) returning id into v_id;
  insert into public.audit_logs(workspace_id, actor_id, action, entity_type, entity_id)
  values(v_workspace_id, v_actor_id, 'CONVERSATION_TAG_CREATED', 'CONVERSATION_TAG', v_id);
  return v_id;
end $$;

create function public.set_conversation_tag(p_conversation_id uuid, p_tag_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid();
begin
  if v_workspace_id is null or v_actor_id is null or p_enabled is null
    or not exists(select 1 from public.omnichannel_conversations where id = p_conversation_id and workspace_id = v_workspace_id)
    or not exists(select 1 from public.conversation_tags where id = p_tag_id and workspace_id = v_workspace_id) then return false; end if;
  if p_enabled then
    insert into public.conversation_tag_links(workspace_id, conversation_id, tag_id)
    values(v_workspace_id, p_conversation_id, p_tag_id) on conflict(conversation_id, tag_id) do nothing;
  else
    delete from public.conversation_tag_links where workspace_id = v_workspace_id and conversation_id = p_conversation_id and tag_id = p_tag_id;
  end if;
  insert into public.audit_logs(workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values(v_workspace_id, v_actor_id, case when p_enabled then 'CONVERSATION_TAG_ADDED' else 'CONVERSATION_TAG_REMOVED' end,
    'OMNICHANNEL_CONVERSATION', p_conversation_id, jsonb_build_object('tagId', p_tag_id));
  return true;
end $$;

create function public.save_quick_reply_template(
  p_id uuid,
  p_name text,
  p_shortcut text,
  p_text_content text,
  p_channel_types text[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null
    or p_name is null or btrim(p_name) = '' or length(btrim(p_name)) > 100
    or p_shortcut is null or lower(btrim(p_shortcut)) !~ '^[a-z0-9_-]{1,40}$'
    or p_text_content is null or btrim(p_text_content) = '' or length(p_text_content) > 100000
    or p_channel_types is null
    or not (p_channel_types <@ array['EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER']::text[])
    or array_position(p_channel_types, null) is not null then return null; end if;
  if p_id is null then
    insert into public.quick_reply_templates(workspace_id,name,shortcut,text_content,channel_types,created_by)
    values(v_workspace_id,btrim(p_name),lower(btrim(p_shortcut)),p_text_content,p_channel_types,v_actor_id)
    returning id into v_id;
  else
    update public.quick_reply_templates set name=btrim(p_name),shortcut=lower(btrim(p_shortcut)),
      text_content=p_text_content,channel_types=p_channel_types
    where id=p_id and workspace_id=v_workspace_id and created_by=v_actor_id returning id into v_id;
    if v_id is null then return null; end if;
  end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id)
  values(v_workspace_id,v_actor_id,case when p_id is null then 'QUICK_REPLY_CREATED' else 'QUICK_REPLY_UPDATED' end,'QUICK_REPLY_TEMPLATE',v_id);
  return v_id;
end $$;

create function public.delete_quick_reply_template(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid();
begin
  if v_workspace_id is null or v_actor_id is null then return false; end if;
  delete from public.quick_reply_templates where id=p_id and workspace_id=v_workspace_id and created_by=v_actor_id;
  if not found then return false; end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id)
  values(v_workspace_id,v_actor_id,'QUICK_REPLY_DELETED','QUICK_REPLY_TEMPLATE',p_id);
  return true;
end $$;

create function public.save_channel_automation(
  p_id uuid,
  p_name text,
  p_enabled boolean,
  p_trigger_type text,
  p_trigger_config jsonb,
  p_actions jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_name is null or btrim(p_name)=''
    or length(btrim(p_name)) > 120 or p_enabled is null
    or p_trigger_type not in ('MESSAGE_RECEIVED','KEYWORD_MATCHED','TAG_ADDED','CONVERSATION_ASSIGNED','SCHEDULED')
    or p_trigger_config is null or jsonb_typeof(p_trigger_config) <> 'object'
    or p_actions is null or jsonb_typeof(p_actions) <> 'array'
    or jsonb_array_length(p_actions) not between 1 and 20 then return null; end if;
  if exists(
    select 1 from jsonb_array_elements(p_actions) action
    where jsonb_typeof(action) <> 'object'
      or action->>'type' not in ('ADD_TAG','REMOVE_TAG','ASSIGN_CONVERSATION','SET_CONVERSATION_STATUS','PROPOSE_MESSAGE','CREATE_TASK')
  ) then return null; end if;
  if p_id is null then
    insert into public.channel_automations(workspace_id,name,enabled,trigger_type,trigger_config,actions,created_by)
    values(v_workspace_id,btrim(p_name),p_enabled,p_trigger_type,p_trigger_config,p_actions,v_actor_id)
    returning id into v_id;
  else
    update public.channel_automations set name=btrim(p_name),enabled=p_enabled,trigger_type=p_trigger_type,
      trigger_config=p_trigger_config,actions=p_actions,version=version+1
    where id=p_id and workspace_id=v_workspace_id returning id into v_id;
    if v_id is null then return null; end if;
  end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_workspace_id,v_actor_id,case when p_id is null then 'CHANNEL_AUTOMATION_CREATED' else 'CHANNEL_AUTOMATION_UPDATED' end,
    'CHANNEL_AUTOMATION',v_id,jsonb_build_object('enabled',p_enabled,'triggerType',p_trigger_type));
  return v_id;
end $$;

create function public.upsert_channel_account_credential(
  p_workspace_id uuid,p_connected_by uuid,p_channel_type text,p_provider text,
  p_external_account_id text,p_display_name text,p_capabilities text[],
  p_access_token_encrypted text,p_webhook_secret_encrypted text,p_configuration jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if p_workspace_id is null or p_connected_by is null
    or p_channel_type not in ('FACEBOOK','ZALO')
    or (p_channel_type='FACEBOOK' and p_provider<>'META_GRAPH')
    or (p_channel_type='ZALO' and p_provider<>'ZALO_BRIDGE')
    or p_external_account_id is null or btrim(p_external_account_id)='' or length(btrim(p_external_account_id))>256
    or p_provider is null or btrim(p_provider)=''
    or p_capabilities is null or array_position(p_capabilities,null) is not null
    or not (p_capabilities <@ array['SEND_TEXT','SEND_IMAGE','SEND_FILE','REPLY','REACTIONS','DELIVERY_RECEIPTS','READ_RECEIPTS','TYPING_INDICATOR','TEMPLATES','COMMENTS']::text[])
    or p_webhook_secret_encrypted is null or btrim(p_webhook_secret_encrypted)=''
    or (p_channel_type='FACEBOOK' and (p_access_token_encrypted is null or btrim(p_access_token_encrypted)=''))
    or p_configuration is null or jsonb_typeof(p_configuration)<>'object'
    or not exists(select 1 from public.profiles where id=p_connected_by and workspace_id=p_workspace_id)
  then return null; end if;
  insert into public.channel_accounts(workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status,capabilities)
  values(p_workspace_id,p_connected_by,p_channel_type,p_provider,btrim(p_external_account_id),nullif(btrim(p_display_name),''),'CONNECTED',p_capabilities)
  on conflict(workspace_id,channel_type,lower(provider),lower(btrim(external_account_id)))
  do update set display_name=excluded.display_name,status='CONNECTED',capabilities=excluded.capabilities,last_error_code=null
  returning id into v_id;
  insert into public.channel_account_credentials(channel_account_id,workspace_id,access_token_encrypted,webhook_secret_encrypted,configuration)
  values(v_id,p_workspace_id,p_access_token_encrypted,p_webhook_secret_encrypted,p_configuration)
  on conflict(channel_account_id) do update set access_token_encrypted=excluded.access_token_encrypted,webhook_secret_encrypted=excluded.webhook_secret_encrypted,configuration=excluded.configuration;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_workspace_id,p_connected_by,'CHANNEL_ACCOUNT_CREDENTIAL_CONFIGURED','CHANNEL_ACCOUNT',v_id,jsonb_build_object('channelType',p_channel_type,'provider',p_provider));
  return v_id;
end $$;

create function public.disconnect_channel_account(p_workspace_id uuid,p_actor_id uuid,p_channel_account_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and workspace_id=p_workspace_id) then return false; end if;
  update public.channel_accounts set status='DISCONNECTED' where id=p_channel_account_id and workspace_id=p_workspace_id and channel_type in ('FACEBOOK','ZALO') and status<>'DISCONNECTED';
  if not found then return false; end if;
  delete from public.channel_account_credentials where channel_account_id=p_channel_account_id and workspace_id=p_workspace_id;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id) values(p_workspace_id,p_actor_id,'CHANNEL_ACCOUNT_DISCONNECTED','CHANNEL_ACCOUNT',p_channel_account_id);
  return true;
end $$;

create function public.set_contact_channel_marketing_consent(
  p_contact_channel_id uuid,
  p_status text,
  p_source text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_workspace_id uuid := public.current_workspace_id();
  v_actor_id uuid := auth.uid();
  v_source text := nullif(btrim(p_source),'');
begin
  if v_workspace_id is null or v_actor_id is null or p_contact_channel_id is null
    or p_status not in ('UNKNOWN','OPTED_IN','OPTED_OUT')
    or (p_status <> 'UNKNOWN' and (v_source is null or length(v_source)>200 or v_source ~ '[[:cntrl:]]'))
  then return false; end if;
  update public.contact_channels
  set marketing_consent_status=p_status,
      marketing_consent_source=case when p_status='UNKNOWN' then null else v_source end,
      marketing_consent_recorded_at=case when p_status='UNKNOWN' then null else now() end
  where id=p_contact_channel_id and workspace_id=v_workspace_id;
  if not found then return false; end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_workspace_id,v_actor_id,'CONTACT_CHANNEL_MARKETING_CONSENT_SET','CONTACT_CHANNEL',p_contact_channel_id,
    jsonb_build_object('status',p_status,'source',case when p_status='UNKNOWN' then null else v_source end));
  return true;
end $$;

create function public.save_manual_channel_suppression(p_channel_type text, p_normalized_recipient text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null
    or p_channel_type not in ('EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER')
    or p_normalized_recipient is null or btrim(p_normalized_recipient)='' or length(btrim(p_normalized_recipient)) > 512
    or p_normalized_recipient ~ '[[:cntrl:]]' then return null; end if;
  insert into public.channel_suppressions(workspace_id,channel_type,normalized_recipient,reason,source)
  values(v_workspace_id,p_channel_type,lower(btrim(p_normalized_recipient)),'MANUAL','OPERATOR')
  on conflict(workspace_id,channel_type,lower(btrim(normalized_recipient))) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id)
  values(v_workspace_id,v_actor_id,'CHANNEL_SUPPRESSION_CREATED','CHANNEL_SUPPRESSION',v_id);
  return v_id;
end $$;

create function public.delete_manual_channel_suppression(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid();
begin
  if v_workspace_id is null or v_actor_id is null then return false; end if;
  delete from public.channel_suppressions where id=p_id and workspace_id=v_workspace_id and reason='MANUAL' and source='OPERATOR';
  if not found then return false; end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id)
  values(v_workspace_id,v_actor_id,'CHANNEL_SUPPRESSION_DELETED','CHANNEL_SUPPRESSION',p_id);
  return true;
end $$;

create function public.claim_channel_outbound_action(p_workspace_id uuid, p_action_id uuid, p_execution_lock_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_action public.channel_outbound_actions%rowtype;
begin
  if p_workspace_id is null or p_action_id is null or p_execution_lock_id is null then return false; end if;
  select * into v_action from public.channel_outbound_actions
  where id=p_action_id and workspace_id=p_workspace_id and status in ('APPROVED','QUEUED')
    and attempt_count=0 and execution_lock_id is null and execution_lock_at is null
  for update;
  if not found then return false; end if;
  if not exists(
    select 1 from public.channel_policy_decisions policy
    where policy.id=v_action.policy_decision_id and policy.workspace_id=p_workspace_id
      and policy.channel_account_id=v_action.channel_account_id and policy.channel_type=v_action.channel_type
      and policy.normalized_recipient=lower(btrim(v_action.recipient_external_id))
      and policy.allowed and policy.expires_at > clock_timestamp()
  ) or exists(
    select 1 from public.channel_suppressions suppression
    where suppression.workspace_id=p_workspace_id and suppression.channel_type=v_action.channel_type
      and lower(btrim(suppression.normalized_recipient))=lower(btrim(v_action.recipient_external_id))
  ) then return false; end if;
  update public.channel_outbound_actions set status='EXECUTING',attempt_count=1,
    execution_lock_id=p_execution_lock_id,execution_lock_at=clock_timestamp()
  where id=p_action_id and workspace_id=p_workspace_id;
  return true;
end $$;

create function public.approve_channel_outbound_action(p_action_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_action public.channel_outbound_actions%rowtype;
begin
  if v_workspace_id is null or v_actor_id is null or p_action_id is null then return false; end if;
  select * into v_action from public.channel_outbound_actions
  where id=p_action_id and workspace_id=v_workspace_id and status='PROPOSED'
    and approved_by is null and approved_at is null for update;
  if not found then return false; end if;
  if not exists(
    select 1 from public.channel_policy_decisions policy
    where policy.id=v_action.policy_decision_id and policy.workspace_id=v_workspace_id
      and policy.channel_account_id=v_action.channel_account_id and policy.channel_type=v_action.channel_type
      and policy.normalized_recipient=lower(btrim(v_action.recipient_external_id))
      and policy.allowed and policy.expires_at > clock_timestamp()
  ) or exists(
    select 1 from public.channel_suppressions suppression
    where suppression.workspace_id=v_workspace_id and suppression.channel_type=v_action.channel_type
      and lower(btrim(suppression.normalized_recipient))=lower(btrim(v_action.recipient_external_id))
  ) then return false; end if;
  update public.channel_outbound_actions set status='APPROVED',approved_by=v_actor_id,approved_at=clock_timestamp()
  where id=p_action_id and workspace_id=v_workspace_id;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id)
  values(v_workspace_id,v_actor_id,'CHANNEL_OUTBOUND_ACTION_APPROVED','CHANNEL_OUTBOUND_ACTION',p_action_id);
  return true;
end $$;

create function public.propose_channel_message(p_conversation_id uuid,p_text_content text,p_idempotency_key text,p_proposed_by text default 'HUMAN')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_conversation public.omnichannel_conversations%rowtype; v_recipient text; v_allowed boolean; v_policy_id uuid; v_action_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_text_content is null or btrim(p_text_content)='' or length(p_text_content)>100000
    or p_idempotency_key is null or btrim(p_idempotency_key)='' or length(p_idempotency_key)>256 or p_proposed_by not in ('HUMAN','AI_ASSIST') then return null; end if;
  select * into v_conversation from public.omnichannel_conversations where id=p_conversation_id and workspace_id=v_workspace_id and status in ('OPEN','PENDING','RESOLVED') for update;
  if not found then return null; end if;
  select sender_external_id into v_recipient from public.omnichannel_messages where workspace_id=v_workspace_id and conversation_id=v_conversation.id and direction='INBOUND' order by received_at desc nulls last,created_at desc limit 1;
  if v_recipient is null or btrim(v_recipient)='' then return null; end if;
  v_allowed := exists(select 1 from public.channel_accounts where id=v_conversation.channel_account_id and workspace_id=v_workspace_id and status='CONNECTED' and channel_type=v_conversation.channel_type)
    and not exists(select 1 from public.channel_suppressions where workspace_id=v_workspace_id and channel_type=v_conversation.channel_type and lower(btrim(normalized_recipient))=lower(btrim(v_recipient)));
  insert into public.channel_policy_decisions(workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,reason_codes,expires_at)
  values(v_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,lower(btrim(v_recipient)),v_allowed,case when v_allowed then '{}'::text[] else array['ACCOUNT_OR_SUPPRESSION_BLOCK']::text[] end,clock_timestamp()+interval '10 minutes') returning id into v_policy_id;
  if not v_allowed then return null; end if;
  insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,text_content,idempotency_key,policy_decision_id,proposed_by)
  values(v_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,v_recipient,p_text_content,p_idempotency_key,v_policy_id,p_proposed_by)
  on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id=v_workspace_id and channel_account_id=v_conversation.channel_account_id and idempotency_key=p_idempotency_key and conversation_id=v_conversation.id and text_content=p_text_content and status='PROPOSED'; end if;
  if v_action_id is not null then insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(v_workspace_id,v_actor_id,'CHANNEL_MESSAGE_PROPOSED','CHANNEL_OUTBOUND_ACTION',v_action_id,jsonb_build_object('proposedBy',p_proposed_by)); end if;
  return v_action_id;
end $$;

create function public.review_channel_automation_proposal(p_proposal_id uuid,p_approved boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid:=public.current_workspace_id(); v_actor_id uuid:=auth.uid(); v_proposal public.channel_automation_proposals%rowtype; v_value text; v_result boolean; v_action_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_proposal_id is null or p_approved is null then return false; end if;
  select * into v_proposal from public.channel_automation_proposals where id=p_proposal_id and workspace_id=v_workspace_id and status='PROPOSED' for update;
  if not found then return false; end if;
  if not p_approved then update public.channel_automation_proposals set status='REJECTED',reviewed_by=v_actor_id,reviewed_at=clock_timestamp() where id=v_proposal.id; return true; end if;
  if v_proposal.action_type in ('ADD_TAG','REMOVE_TAG') then
    v_value:=v_proposal.configuration->>'tagId'; if v_value is null or v_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
    if v_proposal.action_type='ADD_TAG' then insert into public.conversation_tag_links(workspace_id,conversation_id,tag_id) select v_workspace_id,v_proposal.conversation_id,v_value::uuid where exists(select 1 from public.conversation_tags where id=v_value::uuid and workspace_id=v_workspace_id) on conflict do nothing; v_result:=found;
    else delete from public.conversation_tag_links where workspace_id=v_workspace_id and conversation_id=v_proposal.conversation_id and tag_id=v_value::uuid; v_result:=found; end if;
  elsif v_proposal.action_type='ASSIGN_CONVERSATION' then
    v_value:=v_proposal.configuration->>'profileId'; if v_value is null or v_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
    update public.omnichannel_conversations set assigned_to=v_value::uuid where id=v_proposal.conversation_id and workspace_id=v_workspace_id and exists(select 1 from public.profiles where id=v_value::uuid and workspace_id=v_workspace_id); v_result:=found;
  elsif v_proposal.action_type='SET_CONVERSATION_STATUS' then
    v_value:=v_proposal.configuration->>'status'; if v_value not in ('OPEN','PENDING','RESOLVED','SPAM') then return false; end if;
    update public.omnichannel_conversations set status=v_value where id=v_proposal.conversation_id and workspace_id=v_workspace_id; v_result:=found;
  elsif v_proposal.action_type='PROPOSE_MESSAGE' then
    v_value:=v_proposal.configuration->>'text'; if v_value is null then return false; end if;
    v_action_id:=public.propose_channel_message(v_proposal.conversation_id,v_value,'automation-proposal:'||v_proposal.id::text,'AI_ASSIST'); v_result:=v_action_id is not null;
  elsif v_proposal.action_type='CREATE_TASK' then
    v_value:=v_proposal.configuration->>'title'; if v_value is null or btrim(v_value)='' or length(btrim(v_value))>240 then return false; end if;
    insert into public.channel_tasks(workspace_id,conversation_id,title,source_automation_proposal_id,created_by) values(v_workspace_id,v_proposal.conversation_id,btrim(v_value),v_proposal.id,v_actor_id); v_result:=true;
  else return false; end if;
  if not v_result then return false; end if;
  update public.channel_automation_proposals set status='APPLIED',reviewed_by=v_actor_id,reviewed_at=clock_timestamp() where id=v_proposal.id;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(v_workspace_id,v_actor_id,'CHANNEL_AUTOMATION_PROPOSAL_APPLIED','CHANNEL_AUTOMATION_PROPOSAL',v_proposal.id,jsonb_build_object('actionType',v_proposal.action_type));
  return true;
end $$;

create function public.finalize_channel_outbound_action_sent(
  p_workspace_id uuid,p_action_id uuid,p_execution_lock_id uuid,
  p_provider_message_id text,p_provider_conversation_id text,p_accepted_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid;
begin
  if p_provider_message_id is null or btrim(p_provider_message_id)='' or p_provider_conversation_id is null
    or btrim(p_provider_conversation_id)='' or p_accepted_at is null then return false; end if;
  update public.channel_outbound_actions set status='SENT',provider_message_id=p_provider_message_id,
    provider_conversation_id=p_provider_conversation_id,accepted_at=p_accepted_at,
    execution_lock_id=null,execution_lock_at=null
  where id=p_action_id and workspace_id=p_workspace_id and status='EXECUTING'
    and execution_lock_id=p_execution_lock_id and attempt_count=1 returning approved_by into v_actor_id;
  if not found then return false; end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id)
  values(p_workspace_id,v_actor_id,'CHANNEL_MESSAGE_SENT','CHANNEL_OUTBOUND_ACTION',p_action_id);
  return true;
end $$;

create function public.finalize_channel_outbound_action_failed(
  p_workspace_id uuid,p_action_id uuid,p_execution_lock_id uuid,p_safe_error_code text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_safe_error_code not in ('INVALID_WEBHOOK','UNSUPPORTED_EVENT','ACCOUNT_UNAVAILABLE','PERMISSION_DENIED','RATE_LIMITED','DELIVERY_REJECTED') then return false; end if;
  update public.channel_outbound_actions set status='FAILED',safe_error_code=p_safe_error_code,
    execution_lock_id=null,execution_lock_at=null
  where id=p_action_id and workspace_id=p_workspace_id and status='EXECUTING'
    and execution_lock_id=p_execution_lock_id and attempt_count=1;
  return found;
end $$;

create function public.finalize_channel_outbound_action_unknown(
  p_workspace_id uuid,p_action_id uuid,p_execution_lock_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.channel_outbound_actions set status='DELIVERY_UNKNOWN',safe_error_code='DELIVERY_UNKNOWN'
  where id=p_action_id and workspace_id=p_workspace_id and status='EXECUTING'
    and execution_lock_id=p_execution_lock_id and attempt_count=1;
  return found;
end $$;

revoke all on function public.set_omnichannel_conversation_controls(uuid,text,text,uuid) from public, anon;
revoke all on function public.create_conversation_tag(text,text) from public, anon;
revoke all on function public.set_conversation_tag(uuid,uuid,boolean) from public, anon;
revoke all on function public.save_quick_reply_template(uuid,text,text,text,text[]) from public, anon;
revoke all on function public.delete_quick_reply_template(uuid) from public, anon;
revoke all on function public.save_channel_automation(uuid,text,boolean,text,jsonb,jsonb) from public, anon;
revoke all on function public.upsert_channel_account_credential(uuid,uuid,text,text,text,text,text[],text,text,jsonb) from public,anon,authenticated;
revoke all on function public.disconnect_channel_account(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_contact_channel_marketing_consent(uuid,text,text) from public,anon;
revoke all on function public.save_manual_channel_suppression(text,text) from public, anon;
revoke all on function public.delete_manual_channel_suppression(uuid) from public, anon;
revoke all on function public.claim_channel_outbound_action(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.approve_channel_outbound_action(uuid) from public, anon;
revoke all on function public.propose_channel_message(uuid,text,text,text) from public, anon;
revoke all on function public.review_channel_automation_proposal(uuid,boolean) from public,anon;
revoke all on function public.finalize_channel_outbound_action_sent(uuid,uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_channel_outbound_action_failed(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.finalize_channel_outbound_action_unknown(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_omnichannel_conversation_controls(uuid,text,text,uuid) to authenticated;
grant execute on function public.create_conversation_tag(text,text) to authenticated;
grant execute on function public.set_conversation_tag(uuid,uuid,boolean) to authenticated;
grant execute on function public.save_quick_reply_template(uuid,text,text,text,text[]) to authenticated;
grant execute on function public.delete_quick_reply_template(uuid) to authenticated;
grant execute on function public.save_channel_automation(uuid,text,boolean,text,jsonb,jsonb) to authenticated;
grant execute on function public.upsert_channel_account_credential(uuid,uuid,text,text,text,text,text[],text,text,jsonb) to service_role;
grant execute on function public.disconnect_channel_account(uuid,uuid,uuid) to service_role;
grant execute on function public.set_contact_channel_marketing_consent(uuid,text,text) to authenticated;
grant execute on function public.save_manual_channel_suppression(text,text) to authenticated;
grant execute on function public.delete_manual_channel_suppression(uuid) to authenticated;
grant execute on function public.claim_channel_outbound_action(uuid,uuid,uuid) to service_role;
grant execute on function public.approve_channel_outbound_action(uuid) to authenticated;
grant execute on function public.propose_channel_message(uuid,text,text,text) to authenticated;
grant execute on function public.review_channel_automation_proposal(uuid,boolean) to authenticated;
grant execute on function public.finalize_channel_outbound_action_sent(uuid,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.finalize_channel_outbound_action_failed(uuid,uuid,uuid,text) to service_role;
grant execute on function public.finalize_channel_outbound_action_unknown(uuid,uuid,uuid) to service_role;

create trigger channel_accounts_updated_at before update on public.channel_accounts for each row execute function public.set_updated_at();
create trigger channel_account_credentials_updated_at before update on public.channel_account_credentials for each row execute function public.set_updated_at();
create trigger omnichannel_conversations_updated_at before update on public.omnichannel_conversations for each row execute function public.set_updated_at();
create trigger omnichannel_messages_updated_at before update on public.omnichannel_messages for each row execute function public.set_updated_at();
create trigger channel_outbound_actions_updated_at before update on public.channel_outbound_actions for each row execute function public.set_updated_at();
create trigger conversation_tags_updated_at before update on public.conversation_tags for each row execute function public.set_updated_at();
create trigger quick_reply_templates_updated_at before update on public.quick_reply_templates for each row execute function public.set_updated_at();
create trigger channel_automations_updated_at before update on public.channel_automations for each row execute function public.set_updated_at();
create trigger channel_tasks_updated_at before update on public.channel_tasks for each row execute function public.set_updated_at();

alter table public.channel_accounts enable row level security;
alter table public.channel_account_credentials enable row level security;
alter table public.omnichannel_conversations enable row level security;
alter table public.omnichannel_messages enable row level security;
alter table public.channel_inbound_events enable row level security;
alter table public.channel_attachments enable row level security;
alter table public.channel_message_attachments enable row level security;
alter table public.channel_policy_decisions enable row level security;
alter table public.channel_outbound_actions enable row level security;
alter table public.conversation_tags enable row level security;
alter table public.conversation_tag_links enable row level security;
alter table public.quick_reply_templates enable row level security;
alter table public.channel_suppressions enable row level security;
alter table public.channel_delivery_events enable row level security;
alter table public.channel_automations enable row level security;
alter table public.channel_automation_runs enable row level security;
alter table public.channel_automation_proposals enable row level security;
alter table public.channel_tasks enable row level security;

create policy channel_accounts_read on public.channel_accounts for select to authenticated using(workspace_id = public.current_workspace_id());
create policy omnichannel_conversations_read on public.omnichannel_conversations for select to authenticated using(workspace_id = public.current_workspace_id());
create policy omnichannel_messages_read on public.omnichannel_messages for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_attachments_read on public.channel_attachments for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_message_attachments_read on public.channel_message_attachments for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_outbound_actions_read on public.channel_outbound_actions for select to authenticated using(workspace_id = public.current_workspace_id());
create policy conversation_tags_read on public.conversation_tags for select to authenticated using(workspace_id = public.current_workspace_id());
create policy conversation_tag_links_read on public.conversation_tag_links for select to authenticated using(workspace_id = public.current_workspace_id());
create policy quick_reply_templates_read on public.quick_reply_templates for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_suppressions_read on public.channel_suppressions for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_delivery_events_read on public.channel_delivery_events for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_automations_read on public.channel_automations for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_automation_runs_read on public.channel_automation_runs for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_automation_proposals_read on public.channel_automation_proposals for select to authenticated using(workspace_id = public.current_workspace_id());
create policy channel_tasks_read on public.channel_tasks for select to authenticated using(workspace_id = public.current_workspace_id());

revoke all on public.channel_accounts, public.omnichannel_conversations, public.omnichannel_messages,
  public.channel_account_credentials,
  public.channel_inbound_events, public.channel_outbound_actions, public.conversation_tags,
  public.channel_policy_decisions,
  public.channel_attachments, public.channel_message_attachments,
  public.conversation_tag_links, public.quick_reply_templates, public.channel_suppressions,
  public.channel_delivery_events, public.channel_automations, public.channel_automation_runs, public.channel_automation_proposals, public.channel_tasks from anon, authenticated;

grant select(id,workspace_id,channel_type,provider,external_account_id,display_name,status,capabilities,last_health_check_at,last_error_code,created_at,updated_at)
  on public.channel_accounts to authenticated;
grant select on public.omnichannel_conversations, public.omnichannel_messages, public.channel_outbound_actions,
  public.conversation_tags, public.conversation_tag_links to authenticated;
grant select(id,workspace_id,filename,content_type,size_bytes,sha256,source,created_at) on public.channel_attachments to authenticated;
grant select on public.channel_message_attachments to authenticated;
grant select on public.quick_reply_templates, public.channel_suppressions, public.channel_delivery_events,
  public.channel_automations, public.channel_automation_runs, public.channel_automation_proposals, public.channel_tasks to authenticated;
grant select,insert,update,delete on public.channel_accounts, public.omnichannel_conversations,
  public.omnichannel_messages, public.channel_attachments, public.channel_message_attachments,
  public.channel_inbound_events, public.channel_policy_decisions, public.channel_outbound_actions,
  public.conversation_tags, public.conversation_tag_links, public.quick_reply_templates,
  public.channel_suppressions, public.channel_delivery_events, public.channel_automations,
  public.channel_automation_runs, public.channel_automation_proposals, public.channel_tasks to service_role;
grant select,insert,update,delete on public.channel_account_credentials to service_role;

comment on table public.channel_inbound_events is 'Server-only deduplicated ingress. Payload content is referenced, not browser-readable.';
comment on table public.channel_outbound_actions is 'Policy-gated durable outbound intent. Adapters execute actions; AI cannot call providers directly.';

commit;
