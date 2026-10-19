-- Verifies migration 098 (Cài đặt Kho content, readable codes). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
grant execute on function pg_temp.fails(text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000009801','e98@test.local'),('00000000-0000-4000-8000-000000009802','v98@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000098a1','WS 098');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000098b1','00000000-0000-4000-8000-0000000098a1','Editor'),('00000000-0000-4000-8000-0000000098b2','00000000-0000-4000-8000-0000000098a1','Viewer');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values
  ('00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-0000000098b1','content.view'),('00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-0000000098b1','content.templates'),
  ('00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-0000000098b2','content.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000009801','00000000-0000-4000-8000-0000000098a1','Editor','00000000-0000-4000-8000-0000000098b1'),
  ('00000000-0000-4000-8000-000000009802','00000000-0000-4000-8000-0000000098a1','Viewer','00000000-0000-4000-8000-0000000098b2');

select pg_temp.assert_true(public.content_initials('Giới thiệu job')='GTJ' and public.content_initials('Dạng share')='DS','initials drop Vietnamese marks');

-- Codes, built-in abbrs (no rows needed)
insert into public.content_categories(id,workspace_id,department,name,abbr) values('00000000-0000-4000-8000-0000000098c1','00000000-0000-4000-8000-0000000098a1','REC','Giới thiệu job','GT');
insert into public.content_batches(id,workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000098d1','00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-000000009801','BrSE','PROFESSIONAL','VI','POST_LONG','REC',3);
insert into public.content_items(workspace_id,batch_id,title,body,job_title,content_language,content_format,department,category_id,style,max_similarity,created_by,created_at) values
  ('00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-0000000098d1','A','a','BrSE','VI','POST_LONG','REC','00000000-0000-4000-8000-0000000098c1','PROFESSIONAL',0,'00000000-0000-4000-8000-000000009801','2026-10-19 20:00:00+07'),
  ('00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-0000000098d1','B','b','BrSE','VI','POST_LONG','REC','00000000-0000-4000-8000-0000000098c1','PROFESSIONAL',0,'00000000-0000-4000-8000-000000009801','2026-10-19 20:00:00+07'),
  ('00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-0000000098d1','C','c','BrSE','VI_JA','EMAIL','REC',null,'PROFESSIONAL',0,'00000000-0000-4000-8000-000000009801','2026-10-19 23:30:00+07');
select pg_temp.assert_true((select array_agg(code order by title) from public.content_items where workspace_id='00000000-0000-4000-8000-0000000098a1')
  = array['261019_REC_DCT_GT_VI_01','261019_REC_DCT_GT_VI_02','261019_REC_MAIL_CHUNG_VIJA_01'],'content codes: date in Vietnam time, abbrs, CHUNG without a category, numbered');
insert into public.content_templates(id,workspace_id,department,language,body,content_format,category_id) values('00000000-0000-4000-8000-0000000098e1','00000000-0000-4000-8000-0000000098a1','REC','VI','x','POST_LONG','00000000-0000-4000-8000-0000000098c1');
select pg_temp.assert_true((select code='M_REC_DCT_GT_VI_01' from public.content_templates where id='00000000-0000-4000-8000-0000000098e1'),'template codes start with M_');
update public.content_templates set body='y' where id='00000000-0000-4000-8000-0000000098e1';
select pg_temp.assert_true((select code='M_REC_DCT_GT_VI_01' from public.content_templates where id='00000000-0000-4000-8000-0000000098e1'),'editing a template keeps its code');

-- Unknown codes refused; added options accepted and used in codes
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_batches(workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-000000009801','x','PROFESSIONAL','VI','POST_LONG','AM',1)$$),'a department not in the settings is refused');
insert into public.content_options(workspace_id,kind,code,label,abbr,sort) values('00000000-0000-4000-8000-0000000098a1','DEPARTMENT','AM','Account Manager','AM',7),
  ('00000000-0000-4000-8000-0000000098a1','LANGUAGE','KO','Tiếng Hàn','KO',7);
insert into public.content_items(workspace_id,batch_id,title,body,job_title,content_language,content_format,department,style,max_similarity,created_by,created_at)
  values('00000000-0000-4000-8000-0000000098a1','00000000-0000-4000-8000-0000000098d1','D','d','x','KO','COMMENT','AM','PROFESSIONAL',0,'00000000-0000-4000-8000-000000009801','2026-10-20 08:00:00+07');
select pg_temp.assert_true((select code='261020_AM_CMT_CHUNG_KO_01' from public.content_items where title='D'),'a department and language added in settings work and use their abbr');
update public.content_options set abbr='TD' where workspace_id='00000000-0000-4000-8000-0000000098a1' and kind='DEPARTMENT' and code='AM';
select pg_temp.assert_true((select code='261020_AM_CMT_CHUNG_KO_01' from public.content_items where title='D'),'changing an abbr leaves existing codes alone');

-- Permissions
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009802',true);
select pg_temp.assert_true((select count(*)>=2 from public.content_options),'viewers read the options');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_options(workspace_id,kind,code,label) values('00000000-0000-4000-8000-0000000098a1','STYLE','FUN','Vui')$$),'viewers cannot add options');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009801',true);
select pg_temp.assert_true(not pg_temp.fails($$insert into public.content_options(workspace_id,kind,code,label,sort) values('00000000-0000-4000-8000-0000000098a1','STYLE','FUN','Vui',9)$$),'managers add options');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_options(workspace_id,kind,code,label,abbr) values('00000000-0000-4000-8000-0000000098a1','DEPARTMENT','PR','PR','TD')$$),'an abbr is unique within its kind');
select pg_temp.assert_true(pg_temp.fails($$delete from public.content_options where code='FUN'$$) or (select count(*)=1 from public.content_options where code='FUN'),'options are hidden, never deleted');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.content_code_counters','select'),'counters are not readable');
reset role;
rollback;
