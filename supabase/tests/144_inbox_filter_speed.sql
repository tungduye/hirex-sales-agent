-- Verifies migration 144 (Suối Nguồn filter speed): same rows as before, tag filter "all"/"any", access per nick kept.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000014401','a144@test.local'),('00000000-0000-4000-8000-000000014402','b144@test.local'),('00000000-0000-4000-8000-000000014403','c144@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000001440a1','WS 144'),('00000000-0000-4000-8000-0000001440a2','WS 144 other');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000001440b1','00000000-0000-4000-8000-0000001440a1','Role 144'),('00000000-0000-4000-8000-0000001440b2','00000000-0000-4000-8000-0000001440a2','Role 144 other');
-- A sees every nick; B only the first nick; C belongs to another workspace.
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000014401','00000000-0000-4000-8000-0000001440a1','A','00000000-0000-4000-8000-0000001440b1',true),
  ('00000000-0000-4000-8000-000000014402','00000000-0000-4000-8000-0000001440a1','B','00000000-0000-4000-8000-0000001440b1',false),
  ('00000000-0000-4000-8000-000000014403','00000000-0000-4000-8000-0000001440a2','C','00000000-0000-4000-8000-0000001440b2',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000001440c1','00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-000000014401','ZALO','ZALO_BRIDGE','nick-144-1','Nick 1','CONNECTED'),
  ('00000000-0000-4000-8000-0000001440c2','00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-000000014401','ZALO','ZALO_BRIDGE','nick-144-2','Nick 2','CONNECTED');
insert into public.profile_channel_account_access(workspace_id,profile_id,channel_account_id) values('00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-000000014402','00000000-0000-4000-8000-0000001440c1');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata,last_message_at) values
  ('00000000-0000-4000-8000-0000001440d1','00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440c1','ZALO','p1','OPEN','BOT_ALLOWED','{"participantDisplayName":"Nguyễn An"}','2026-10-20T08:00:00Z'),
  ('00000000-0000-4000-8000-0000001440d2','00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440c1','ZALO','p2','OPEN','BOT_ALLOWED','{}','2026-10-20T07:00:00Z'),
  ('00000000-0000-4000-8000-0000001440d3','00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440c2','ZALO','p3','OPEN','BOT_ALLOWED','{}','2026-10-20T06:00:00Z'),
  ('00000000-0000-4000-8000-0000001440d4','00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440c2','ZALO','p4','OPEN','BOT_ALLOWED','{"hidden":"true"}','2026-10-20T05:00:00Z'),
  ('00000000-0000-4000-8000-0000001440d5','00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440c2','ZALO','p5','OPEN','BOT_ALLOWED','{}','2026-08-01T05:00:00Z');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at)
select c.workspace_id, c.id, c.channel_account_id, c.channel_type, 'm-'||c.provider_conversation_id, 'INBOUND', c.provider_conversation_id, 'Chào', c.last_message_at, c.last_message_at, c.last_message_at
from public.omnichannel_conversations c where c.workspace_id='00000000-0000-4000-8000-0000001440a1';
-- Tag triggers check the acting member; fixtures are inserted as the database owner.
set local session_replication_role = replica;
insert into public.conversation_tags(id,workspace_id,name) values('00000000-0000-4000-8000-0000001440e1','00000000-0000-4000-8000-0000001440a1','Hạng 1'),('00000000-0000-4000-8000-0000001440e2','00000000-0000-4000-8000-0000001440a1','Thị trường Nhật'),('00000000-0000-4000-8000-0000001440e3','00000000-0000-4000-8000-0000001440a1','Trống');
-- d1: Hạng 1 + Nhật; d2: Hạng 1; d3: Nhật; d4 (hidden): Hạng 1 + Nhật.
insert into public.conversation_tag_links(workspace_id,conversation_id,tag_id) values
  ('00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440d1','00000000-0000-4000-8000-0000001440e1'),
  ('00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440d1','00000000-0000-4000-8000-0000001440e2'),
  ('00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440d2','00000000-0000-4000-8000-0000001440e1'),
  ('00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440d3','00000000-0000-4000-8000-0000001440e2'),
  ('00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440d4','00000000-0000-4000-8000-0000001440e1'),
  ('00000000-0000-4000-8000-0000001440a1','00000000-0000-4000-8000-0000001440d4','00000000-0000-4000-8000-0000001440e2');
set local session_replication_role = origin;
grant select on public.contacts, public.omnichannel_conversations, public.omnichannel_messages, public.conversation_tag_links to authenticated;

create function pg_temp.ids(p_tags uuid[], p_mode text, p_search text default null, p_since timestamptz default null, p_before_at timestamptz default null, p_before_id uuid default null, p_chunk integer default null)
returns text language sql as $$
  select coalesce(string_agg(right(f.id::text, 2), ',' order by f.sort_at desc, f.id desc), '')
  from public.inbox_filtered_conversations(array['00000000-0000-4000-8000-0000001440c1','00000000-0000-4000-8000-0000001440c2','00000000-0000-4000-8000-0000001440c2']::uuid[],
    null, p_tags, p_mode, null, null, p_search, null, p_since, p_before_at, p_before_id, p_chunk) f $$;
grant execute on function pg_temp.ids(uuid[],text,text,timestamptz,timestamptz,uuid,integer) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000014401',true);
select pg_temp.assert_true(pg_temp.ids(null,'all')='d1,d2,d3,d5','no tag: every visible conversation, newest first, hidden left out');
select pg_temp.assert_true(pg_temp.ids(array['00000000-0000-4000-8000-0000001440e1','00000000-0000-4000-8000-0000001440e2']::uuid[],'all')='d1','two tags, "all": only conversations with both');
select pg_temp.assert_true(pg_temp.ids(array['00000000-0000-4000-8000-0000001440e1','00000000-0000-4000-8000-0000001440e2']::uuid[],'any')='d1,d2,d3','two tags, "any": at least one');
select pg_temp.assert_true(pg_temp.ids(array['00000000-0000-4000-8000-0000001440e1','00000000-0000-4000-8000-0000001440e1','00000000-0000-4000-8000-0000001440e2']::uuid[],'all')='d1','a tag picked twice still means both tags');
select pg_temp.assert_true(pg_temp.ids(array['00000000-0000-4000-8000-0000001440e1','00000000-0000-4000-8000-0000001440e3']::uuid[],'all')='','a tag nobody has: nothing');
select pg_temp.assert_true(pg_temp.ids(array['00000000-0000-4000-8000-0000001440e1']::uuid[],null)='d1,d2','mode left out means "all"');
select pg_temp.assert_true(pg_temp.ids(null,'all','nguyen an')='d1','search ignores marks');
select pg_temp.assert_true(pg_temp.ids(null,'all',null,'2026-10-01T00:00:00Z')='d1,d2,d3','since: recent conversations only');
select pg_temp.assert_true(pg_temp.ids(null,'all',null,null,'2026-10-20T07:00:00Z','00000000-0000-4000-8000-0000001440d2')='d3,d5','cursor continues after the last row');
select pg_temp.assert_true(pg_temp.ids(null,'all',null,null,null,null,2)='d1,d2','chunk limits the rows');
-- B may open only Nick 1: asking for Nick 2 too returns nothing from it.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000014402',true);
select pg_temp.assert_true(pg_temp.ids(null,'all')='d1,d2','a member sees only the nicks they may open');
select pg_temp.assert_true(pg_temp.ids(array['00000000-0000-4000-8000-0000001440e2']::uuid[],'any')='d1','tag filter keeps the nick access');
-- Someone in another workspace gets nothing.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000014403',true);
select pg_temp.assert_true(pg_temp.ids(null,'all')='','another workspace sees nothing');
select pg_temp.assert_true(pg_temp.ids(array['00000000-0000-4000-8000-0000001440e1']::uuid[],'any')='','another workspace: no tagged rows either');
reset role;
rollback;
