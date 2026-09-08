begin;
create function public.reorder_email_campaign_step_attachments(p_workspace_id uuid,p_campaign_id uuid,p_step_id uuid,p_attachment_ids uuid[]) returns boolean language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if p_attachment_ids is null or cardinality(p_attachment_ids)>10 or cardinality(p_attachment_ids)=0 then return false;end if;
  perform 1 from public.email_campaigns where id=p_campaign_id and workspace_id=p_workspace_id and status='DRAFT' for update;if not found then return false;end if;
  perform 1 from public.email_campaign_steps where id=p_step_id and campaign_id=p_campaign_id and workspace_id=p_workspace_id;if not found then return false;end if;
  select count(*) into v_count from public.email_campaign_step_attachments where workspace_id=p_workspace_id and campaign_id=p_campaign_id and step_id=p_step_id;
  if v_count<>cardinality(p_attachment_ids) or (select count(distinct x) from unnest(p_attachment_ids)x)<>v_count or exists(select 1 from unnest(p_attachment_ids)x where not exists(select 1 from public.email_campaign_step_attachments a where a.workspace_id=p_workspace_id and a.campaign_id=p_campaign_id and a.step_id=p_step_id and a.attachment_id=x)) then return false;end if;
  set constraints public.email_campaign_step_attachments_order_key deferred;
  update public.email_campaign_step_attachments set sort_order=array_position(p_attachment_ids,attachment_id)-1 where workspace_id=p_workspace_id and campaign_id=p_campaign_id and step_id=p_step_id;
  return true;
end $$;
revoke all on function public.reorder_email_campaign_step_attachments(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_email_campaign_step_attachments(uuid,uuid,uuid,uuid[]) to service_role;
commit;
