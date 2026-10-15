-- 079: "Quy tắc tự động" of Trợ lý HireX (phase 3, step 3). A member describes a rule in Vietnamese,
-- the assistant turns it into a checked definition and the member confirms it on a card. The alert
-- scan evaluates enabled rules every 5 minutes: a rule only notifies (an alert) or attaches a
-- proposal (an assistant_actions row) that the recipient must still confirm. Written by the server
-- only; members read their own rules (administrators read all).
begin;

create table public.assistant_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null,
  name text not null,
  definition jsonb not null,
  enabled boolean not null default true,
  last_matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_rules_id_workspace_key unique (id, workspace_id),
  constraint assistant_rules_owner_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint assistant_rules_name_length check (length(btrim(name)) between 1 and 120),
  constraint assistant_rules_definition_shape check (jsonb_typeof(definition) = 'object' and definition->>'trigger' in ('CUSTOMER_WAITING','TASK_OVERDUE','LEAD_STALE'))
);
create index assistant_rules_enabled on public.assistant_rules(workspace_id) where enabled;

alter table public.assistant_rules enable row level security;
create policy assistant_rules_select on public.assistant_rules for select to authenticated
using (workspace_id = public.current_workspace_id() and (created_by = auth.uid() or public.has_workspace_permission('roles.manage')));
revoke all on public.assistant_rules from anon, authenticated;
grant select on public.assistant_rules to authenticated;
grant all on public.assistant_rules to service_role;

-- Rule alerts: which rule raised them and the proposal attached to them (if any).
alter table public.assistant_alerts drop constraint assistant_alerts_kind_allowed,
  add constraint assistant_alerts_kind_allowed check (kind in ('CHANNEL_DOWN','EMAIL_WORKER_STALE','CUSTOMER_WAITING','RULE')),
  add column rule_id uuid references public.assistant_rules(id) on delete cascade,
  add column action_id uuid references public.assistant_actions(id) on delete set null,
  add constraint assistant_alerts_rule_kind check ((kind = 'RULE') = (rule_id is not null));

-- The confirmation card that creates a rule.
alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in ('CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY','CREATE_RULE'));

commit;
