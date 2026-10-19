-- Verifies migration 089. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
select pg_temp.assert_true(exists(select 1 from information_schema.columns where table_name='channel_outbound_actions' and column_name='mentions' and data_type='jsonb'),'mentions column exists');
select pg_temp.assert_true(exists(select 1 from pg_constraint where conname='channel_outbound_actions_mentions_shape'),'mentions limited to manual Zalo sends');
rollback;
