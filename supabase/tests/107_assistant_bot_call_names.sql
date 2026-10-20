-- Verifies migration 107 (extra call names for the Zalo Trợ lý).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000000701','WS 107');
insert into public.assistant_bot_settings(workspace_id,call_names) values('99000000-0000-4000-8000-000000000701',array['Soda','Trợ lý']);
select pg_temp.assert_true((select call_names='{Soda,"Trợ lý"}' from public.assistant_bot_settings where workspace_id='99000000-0000-4000-8000-000000000701'),'names are kept');
select pg_temp.assert_true(pg_temp.fails($$update public.assistant_bot_settings set call_names=array_fill('x'::text, array[11]) where workspace_id='99000000-0000-4000-8000-000000000701'$$),'at most 10 names');
rollback;
