\set ON_ERROR_STOP on
\echo 'SETUP_START'

do $$
begin
  if exists(select 1 from auth.users where id='96000000-0000-4000-8000-000000000001')
    or exists(select 1 from public.workspaces where id='96000000-0000-4000-8000-000000000002') then
    raise exception 'Concurrency fixture collision; run cleanup.sql or investigate before continuing';
  end if;
end $$;

begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','96000000-0000-4000-8000-000000000001','authenticated','authenticated','campaign-concurrency@example.test','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp());
insert into public.workspaces(id,name) values('96000000-0000-4000-8000-000000000002','Campaign concurrency fixture');
insert into public.profiles(id,workspace_id,full_name) values('96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','Campaign Concurrency Fixture');

insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes) values
('96000000-0000-4000-8000-000000000010','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000001','GMAIL','same-recipient@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']),
('96000000-0000-4000-8000-000000000011','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000001','GMAIL','shared-cross-campaign@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']),
('96000000-0000-4000-8000-000000000012','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000001','GMAIL','fallback-cross-campaign@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']);

insert into public.email_campaigns(id,workspace_id,name,status,subject_template,body_text_template,created_by) values
('96000000-0000-4000-8000-000000000100','96000000-0000-4000-8000-000000000002','Same recipient race','DRAFT','Same recipient','Body','96000000-0000-4000-8000-000000000001'),
('96000000-0000-4000-8000-000000000101','96000000-0000-4000-8000-000000000002','Cross campaign A','DRAFT','Cross A','Body','96000000-0000-4000-8000-000000000001'),
('96000000-0000-4000-8000-000000000102','96000000-0000-4000-8000-000000000002','Cross campaign B','DRAFT','Cross B','Body','96000000-0000-4000-8000-000000000001');

insert into public.email_campaign_senders(id,workspace_id,campaign_id,email_account_id,daily_cap,per_minute_cap,priority) values
('96000000-0000-4000-8000-000000000110','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000100','96000000-0000-4000-8000-000000000010',1,1,0),
('96000000-0000-4000-8000-000000000111','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000101','96000000-0000-4000-8000-000000000011',1,1,0),
('96000000-0000-4000-8000-000000000112','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000102','96000000-0000-4000-8000-000000000011',1,1,0),
('96000000-0000-4000-8000-000000000113','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000102','96000000-0000-4000-8000-000000000012',1,1,10);

insert into public.email_campaign_recipients(id,workspace_id,campaign_id,email,normalized_email,idempotency_key) values
('96000000-0000-4000-8000-000000000200','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000100','same-race@example.test','same-race@example.test','96000000-0000-4000-8000-000000000300'),
('96000000-0000-4000-8000-000000000201','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000101','cross-a@example.test','cross-a@example.test','96000000-0000-4000-8000-000000000301'),
('96000000-0000-4000-8000-000000000202','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000102','cross-b@example.test','cross-b@example.test','96000000-0000-4000-8000-000000000302');

insert into public.email_sender_limits(workspace_id,email_account_id,daily_cap,per_minute_cap) values
('96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000010',1,1),
('96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000011',1,1),
('96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000012',1,1);

update public.email_campaigns set status='RUNNING',started_at=clock_timestamp()
where workspace_id='96000000-0000-4000-8000-000000000002';
commit;

select 'workspace' as name,'96000000-0000-4000-8000-000000000002'::uuid as value
union all select 'same_campaign','96000000-0000-4000-8000-000000000100'::uuid
union all select 'same_token_a','96000000-0000-4000-8000-000000000400'::uuid
union all select 'same_token_b','96000000-0000-4000-8000-000000000401'::uuid
union all select 'cross_campaign_a','96000000-0000-4000-8000-000000000101'::uuid
union all select 'cross_campaign_b','96000000-0000-4000-8000-000000000102'::uuid
union all select 'cross_token_a','96000000-0000-4000-8000-000000000402'::uuid
union all select 'cross_token_b','96000000-0000-4000-8000-000000000403'::uuid;
\echo 'SETUP_PASS'
