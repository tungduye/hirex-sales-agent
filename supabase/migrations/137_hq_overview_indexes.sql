-- HireX HQ (Tổng quan, mức 1): small partial indexes for the live numbers. No data changes.
-- * who replied in the last minutes (manual sends with an approver)
create index if not exists channel_outbound_actions_manual_recent
  on public.channel_outbound_actions(workspace_id, approved_at desc)
  where dispatch_source = 'HUMAN_MANUAL' and approved_by is not null;
-- * latest campaign replies (feed + "hôm nay")
create index if not exists channel_campaign_recipients_replied_recent
  on public.channel_campaign_recipients(workspace_id, replied_at desc)
  where status = 'REPLIED';
-- * groups that tagged our nick and still wait for an answer (feed)
create index if not exists omnichannel_conversations_mention_pending
  on public.omnichannel_conversations(workspace_id, mention_pending_at desc)
  where mention_pending_at is not null;
-- * CVs added today
create index if not exists human_cvs_created_recent on public.human_cvs(workspace_id, human_created_at desc);
