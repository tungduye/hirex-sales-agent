-- Verifies migration 092. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated, service_role;
select pg_temp.assert_true(exists(select 1 from pg_constraint where conname='channel_outbound_actions_quote_shape'),'quotes limited to manual Zalo replies');
select pg_temp.assert_true(exists(select 1 from information_schema.tables where table_name='zalo_message_quotes'),'quote table exists');
select pg_temp.assert_true((select relrowsecurity from pg_class where relname='zalo_message_quotes'),'quote table has row security');
rollback;
