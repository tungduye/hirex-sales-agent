-- 111: Word files made by the Trợ lý (Đợt C). A file is stored like any Zalo attachment (bucket
-- "channel-attachments", source ASSISTANT_GENERATED), listed for its creator on "Tài liệu đã tạo", and
-- can be sent by the Trợ lý nick into the chat where it was asked for (one file, no text, same approved
-- path and idempotency keys as the Trợ lý's answers).
begin;

alter table public.channel_attachments drop constraint channel_attachments_source_allowed,
  add constraint channel_attachments_source_allowed check (source in ('INBOUND_PROVIDER','HUMAN_UPLOAD','CAMPAIGN_ASSET','ASSISTANT_GENERATED'));

create table public.assistant_generated_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null,
  kind text not null check (kind in ('FREE', 'JD')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  attachment_id uuid not null unique references public.channel_attachments(id) on delete cascade,
  job_id uuid,
  source text not null default 'WEB' check (source in ('WEB', 'ZALO')),
  created_at timestamptz not null default now(),
  constraint assistant_generated_files_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete cascade
);
create index assistant_generated_files_recent on public.assistant_generated_files(workspace_id, created_by, created_at desc);
alter table public.assistant_generated_files enable row level security;
revoke all on public.assistant_generated_files from anon, authenticated;
grant all on public.assistant_generated_files to service_role;

create or replace function public.propose_assistant_bot_file_service(p_workspace_id uuid, p_job_id uuid, p_attachment_id uuid, p_part integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_job public.assistant_bot_jobs%rowtype; v_conversation public.omnichannel_conversations%rowtype; v_policy_id uuid; v_action_id uuid; v_key text;
begin
  if p_workspace_id is null or p_job_id is null or p_attachment_id is null or p_part < 1 or p_part > 10 then return null; end if;
  select * into v_job from public.assistant_bot_jobs where id = p_job_id and workspace_id = p_workspace_id and status = 'RUNNING';
  if not found then return null; end if;
  if not exists (select 1 from public.assistant_bot_settings s where s.workspace_id = p_workspace_id and s.enabled and s.channel_account_id = v_job.channel_account_id) then return null; end if;
  -- Only a file the Trợ lý made for the member this job answers.
  if not exists (select 1 from public.assistant_generated_files f join public.channel_attachments a on a.id = f.attachment_id
      where f.workspace_id = p_workspace_id and f.attachment_id = p_attachment_id and f.created_by = v_job.profile_id
        and a.source = 'ASSISTANT_GENERATED' and a.storage_bucket = 'channel-attachments') then return null; end if;
  select * into v_conversation from public.omnichannel_conversations where id = v_job.conversation_id and workspace_id = p_workspace_id and channel_account_id = v_job.channel_account_id and channel_type = 'ZALO';
  if not found then return null; end if;
  v_key := 'assistant-bot:' || p_job_id::text || ':part:' || p_part::text;
  insert into public.channel_policy_decisions(workspace_id, conversation_id, channel_account_id, channel_type, normalized_recipient, allowed, reason_codes, expires_at)
    values (p_workspace_id, v_conversation.id, v_conversation.channel_account_id, 'ZALO', lower(btrim(v_conversation.provider_conversation_id)), true, array['ASSISTANT_BOT'], clock_timestamp() + interval '10 minutes')
    returning id into v_policy_id;
  insert into public.channel_outbound_actions(workspace_id, conversation_id, channel_account_id, channel_type, recipient_external_id, status, text_content, attachment_ids, approved_by, approved_at, idempotency_key, policy_decision_id, proposed_by, dispatch_source)
    values (p_workspace_id, v_conversation.id, v_conversation.channel_account_id, 'ZALO', v_conversation.provider_conversation_id, 'APPROVED', null, array[p_attachment_id], null, clock_timestamp(), v_key, v_policy_id, 'AI_ASSIST', 'AI_AUTOMATION')
    on conflict (workspace_id, channel_account_id, idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id = p_workspace_id and channel_account_id = v_conversation.channel_account_id and idempotency_key = v_key; end if;
  return v_action_id;
end $$;
revoke all on function public.propose_assistant_bot_file_service(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.propose_assistant_bot_file_service(uuid, uuid, uuid, integer) to service_role;

commit;
