-- Do not reclaim a stale campaign delivery once a send request exists.
-- Preserve ambiguous and pre-existing attempts for manual reconciliation.
begin;
do $$
declare definition text; old_guard text; new_guard text;
begin
  definition := pg_get_functiondef('public.claim_email_campaign_sequence_steps(uuid,uuid,uuid,integer)'::regprocedure);
  old_guard := 'd.claimed_at<clock_timestamp()-interval ''15 minutes''';
  new_guard := old_guard || ' and not exists (select 1 from public.email_send_requests existing_request where existing_request.workspace_id=d.workspace_id and existing_request.idempotency_key=d.idempotency_key)';
  if position('existing_request.idempotency_key=d.idempotency_key' in definition) > 0 then return; end if;
  if position(old_guard in definition) = 0 then raise exception 'Unexpected sequence claim definition; aborting'; end if;
  execute replace(definition, old_guard, new_guard);
end $$;
commit;
