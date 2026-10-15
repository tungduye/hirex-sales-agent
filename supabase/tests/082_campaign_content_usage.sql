-- Verifies migration 082. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000821','u82@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000008a2','WS 082');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000008b2','00000000-0000-4000-8000-0000000008a2','Role 082');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000000008a2','00000000-0000-4000-8000-0000000008b2','content.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000000821','00000000-0000-4000-8000-0000000008a2','U','00000000-0000-4000-8000-0000000008b2');
insert into public.content_batches(id,workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000008c2','00000000-0000-4000-8000-0000000008a2','00000000-0000-4000-8000-000000000821','Job','PROFESSIONAL','VI','COMMENT','SALE',3);
insert into public.content_items(id,workspace_id,batch_id,title,body,job_title,content_language,content_format,department,style,created_by) values
  ('00000000-0000-4000-8000-0000000008d1','00000000-0000-4000-8000-0000000008a2','00000000-0000-4000-8000-0000000008c2','t1','b1','Job','VI','COMMENT','SALE','PROFESSIONAL','00000000-0000-4000-8000-000000000821'),
  ('00000000-0000-4000-8000-0000000008d2','00000000-0000-4000-8000-0000000008a2','00000000-0000-4000-8000-0000000008c2','t2','b2','Job','VI','COMMENT','SALE','PROFESSIONAL','00000000-0000-4000-8000-000000000821'),
  ('00000000-0000-4000-8000-0000000008d3','00000000-0000-4000-8000-0000000008a2','00000000-0000-4000-8000-0000000008c2','t3','b3','Job','EN','COMMENT','SALE','PROFESSIONAL','00000000-0000-4000-8000-000000000821');
select set_config('request.jwt.claim.role','service_role',true);
insert into public.channel_campaigns(id,workspace_id,name,created_by) values('00000000-0000-4000-8000-0000000008e1','00000000-0000-4000-8000-0000000008a2','Camp 082','00000000-0000-4000-8000-000000000821');
insert into public.content_item_usages(content_item_id,workspace_id,campaign_kind,campaign_id) values('00000000-0000-4000-8000-0000000008d1','00000000-0000-4000-8000-0000000008a2','CHANNEL','00000000-0000-4000-8000-0000000008e1');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_item_usages(content_item_id,workspace_id,campaign_kind,campaign_id) values('00000000-0000-4000-8000-0000000008d1','00000000-0000-4000-8000-0000000008a2','EMAIL',gen_random_uuid())$$),'a content item serves only one campaign');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000821',true);
select pg_temp.assert_true((select array_agg(id order by id) from public.get_available_content_items('COMMENT','SALE',null,'VI',10))='{00000000-0000-4000-8000-0000000008d2}'::uuid[],'available list skips used content and filters by labels');
select pg_temp.assert_true((select count(*) from public.get_available_content_items(null,null,null,null,10))=2,'no filter: every unused item');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
delete from public.channel_campaigns where id='00000000-0000-4000-8000-0000000008e1';
select pg_temp.assert_true(not exists(select 1 from public.content_item_usages where content_item_id='00000000-0000-4000-8000-0000000008d1'),'deleting the campaign releases its content');
delete from public.content_items where id='00000000-0000-4000-8000-0000000008d2';
select pg_temp.assert_true(true,'deleting content is allowed');
rollback;
