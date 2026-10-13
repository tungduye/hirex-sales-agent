begin;

alter table public.ai_recruiter_bots
  add column if not exists bot_type text;

update public.ai_recruiter_bots
set bot_type='RECRUITER'
where bot_type is null;

alter table public.ai_recruiter_bots
  alter column bot_type set default 'RECRUITER',
  alter column bot_type set not null;

alter table public.ai_recruiter_bots
  drop constraint if exists ai_recruiter_bots_bot_type_check;
alter table public.ai_recruiter_bots
  add constraint ai_recruiter_bots_bot_type_check
  check (bot_type in ('SALE','RECRUITER','COLLABORATOR','INTERNAL_HR'));

create unique index if not exists ai_recruiter_bots_workspace_type_unique
  on public.ai_recruiter_bots(workspace_id,bot_type);

commit;
