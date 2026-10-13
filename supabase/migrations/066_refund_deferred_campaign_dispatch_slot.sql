begin;

-- A dispatch reservation protects provider pacing, but a pre-provider Zalo
-- deferral must not count as one of the campaign's message/batch slots.
-- Compare-and-swap prevents a late refund from undoing a newer reservation.
create function public.refund_channel_campaign_dispatch_slot(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_expected_next_at timestamptz,
  p_expected_batch_progress integer
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_campaign public.channel_campaigns%rowtype;
begin
  if auth.role() <> 'service_role' or p_workspace_id is null or p_campaign_id is null
    or p_expected_next_at is null or p_expected_batch_progress is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_campaign from public.channel_campaigns
    where id=p_campaign_id and workspace_id=p_workspace_id and status in ('RUNNING','PAUSED') for update;
  if not found or v_campaign.pacing_next_at is distinct from p_expected_next_at
    or v_campaign.pacing_batch_sent <> p_expected_batch_progress
    or p_expected_batch_progress < 0 or p_expected_batch_progress >= v_campaign.batch_size then
    return false;
  end if;
  update public.channel_campaigns
    set pacing_next_at=clock_timestamp(),
      pacing_batch_sent=case when p_expected_batch_progress=0 then v_campaign.batch_size-1
        else p_expected_batch_progress-1 end
    where id=p_campaign_id and workspace_id=p_workspace_id;
  return true;
end $$;

revoke all on function public.refund_channel_campaign_dispatch_slot(uuid,uuid,timestamptz,integer)
  from public,anon,authenticated;
grant execute on function public.refund_channel_campaign_dispatch_slot(uuid,uuid,timestamptz,integer)
  to service_role;

commit;
