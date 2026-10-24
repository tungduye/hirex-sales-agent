-- Verifies migration 145 (CV chuyển hóa from Zalo / Facebook chats).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
-- Campaign tables check the acting role; fixtures are written as the service.
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.assert_true(public.is_cv_file_name('CV_NgoVanTinh.pdf'),'a CV pdf');
select pg_temp.assert_true(public.is_cv_file_name('履歴書_LEVANHIEN.pdf') and public.is_cv_file_name('【職務経歴書】加藤良.docx'),'Japanese CVs');
select pg_temp.assert_true(public.is_cv_file_name('Nguyen Hoang Phuc Resume'),'a file called resume without extension');
select pg_temp.assert_true(not public.is_cv_file_name('JD BrSE Monstarlab.docx') and not public.is_cv_file_name('[GSV] JD - Project Manager.pdf'),'JDs are not CVs');
select pg_temp.assert_true(not public.is_cv_file_name('HĐ- DTS VN-Magnet_28_11_2023.pdf') and not public.is_cv_file_name('BIÊN BẢN XÁC NHẬN HỢP ĐỒNG.pdf') and not public.is_cv_file_name('CONTRACT INTALENT - TRUSTED AI.pdf'),'contracts and minutes are not CVs');
select pg_temp.assert_true(not public.is_cv_file_name('LỚP 1 - TOÁN - TUẦN 6.pdf') and not public.is_cv_file_name('TÀI LIỆU QUY TRÌNH GỬI CV.docx'),'school work and processes are not CVs');
select pg_temp.assert_true(not public.is_cv_file_name('photo.jpg') and not public.is_cv_file_name(null),'pictures and nothing are not CVs');

insert into auth.users(id,email) values('00000000-0000-4000-8000-000000014501','a145@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000001450a1','WS 145');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000001450b1','00000000-0000-4000-8000-0000001450a1','Role 145');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values('00000000-0000-4000-8000-000000014501','00000000-0000-4000-8000-0000001450a1','A','00000000-0000-4000-8000-0000001450b1',true);
-- c1: nick tuyển dụng; c2: a Sale nick (not tuyển dụng).
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status,candidate_facts_enabled) values
  ('00000000-0000-4000-8000-0000001450c1','00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-000000014501','ZALO','ZALO_BRIDGE','rec-145','Rec nick','CONNECTED',true),
  ('00000000-0000-4000-8000-0000001450c2','00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-000000014501','ZALO','ZALO_BRIDGE','sale-145','Sale nick','CONNECTED',false);
insert into public.contacts(id,workspace_id,full_name) values('00000000-0000-4000-8000-0000001450e1','00000000-0000-4000-8000-0000001450a1','UV Một'),('00000000-0000-4000-8000-0000001450e2','00000000-0000-4000-8000-0000001450a1','UV Bốn');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,contact_id,status,takeover_mode,metadata) values
  ('00000000-0000-4000-8000-0000001450d1','00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-0000001450c1','ZALO','uv-1','00000000-0000-4000-8000-0000001450e1','OPEN','BOT_ALLOWED','{}'),
  ('00000000-0000-4000-8000-0000001450d2','00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-0000001450c1','ZALO','group-2',null,'OPEN','BOT_ALLOWED','{"conversationKind":"GROUP","groupName":"Khách IT"}'),
  ('00000000-0000-4000-8000-0000001450d3','00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-0000001450c2','ZALO','uv-3',null,'OPEN','BOT_ALLOWED','{}'),
  ('00000000-0000-4000-8000-0000001450d4','00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-0000001450c2','ZALO','uv-4','00000000-0000-4000-8000-0000001450e2','OPEN','BOT_ALLOWED','{}'),
  ('00000000-0000-4000-8000-0000001450d5','00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-0000001450c1','ZALO','uv-5',null,'OPEN','BOT_ALLOWED','{}');
create function pg_temp.msg(p_id text, p_conv text, p_account text, p_sender text, p_file text, p_ago interval) returns void language sql as $$
  insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,attachment_count,received_at,created_at,metadata)
  values (p_id::uuid,'00000000-0000-4000-8000-0000001450a1',p_conv::uuid,p_account::uuid,'ZALO','m-'||p_id,'INBOUND',p_sender,case when p_file is null then 'Chào em' end,
    case when p_file is null then 0 else 1 end, now() - p_ago, now() - p_ago,
    case when p_file is null then '{}'::jsonb else jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('filename', p_file))) end) $$;
-- d1 (Rec nick): a JD (no), then a CV, then a second CV (counted once).
select pg_temp.msg('00000000-0000-4000-8000-0000001451a1','00000000-0000-4000-8000-0000001450d1','00000000-0000-4000-8000-0000001450c1','uv-1','JD BrSE.docx','3 hours');
select pg_temp.msg('00000000-0000-4000-8000-0000001451a2','00000000-0000-4000-8000-0000001450d1','00000000-0000-4000-8000-0000001450c1','uv-1','CV_Mot.pdf','2 hours');
select pg_temp.msg('00000000-0000-4000-8000-0000001451a3','00000000-0000-4000-8000-0000001450d1','00000000-0000-4000-8000-0000001450c1','uv-1','CV_Mot_v2.pdf','1 hour');
-- d2: a CV posted in a group (no). d3: a CV to the Sale nick, no campaign (no).
select pg_temp.msg('00000000-0000-4000-8000-0000001451a4','00000000-0000-4000-8000-0000001450d2','00000000-0000-4000-8000-0000001450c1','member-9','CV_Hai.pdf','2 hours');
select pg_temp.msg('00000000-0000-4000-8000-0000001451a5','00000000-0000-4000-8000-0000001450d3','00000000-0000-4000-8000-0000001450c2','uv-3','CV_Ba.pdf','2 hours');
select pg_temp.assert_true((select count(*) = 1 from public.chat_cv_conversions where workspace_id = '00000000-0000-4000-8000-0000001450a1'),'only the one-to-one chat on the nick tuyển dụng counts');
select pg_temp.assert_true((select file_name = 'CV_Mot.pdf' and source = 'FILE' and campaign_id is null and message_id = '00000000-0000-4000-8000-0000001451a2' from public.chat_cv_conversions where conversation_id = '00000000-0000-4000-8000-0000001450d1'),'first CV wins, JD ignored');
select pg_temp.assert_true((select step = 8 and outcome = 'CV_RECEIVED' from public.candidate_flow_states where contact_id = '00000000-0000-4000-8000-0000001450e1'),'Luồng Rec moves to bước 8 · Đã có CV');

-- d4 (Sale nick): the candidate replied to a campaign, then sent a CV → counted, with the campaign.
insert into public.channel_campaigns(id,workspace_id,name,created_by,status,started_at,owner_name) values
  ('00000000-0000-4000-8000-0000001450f1','00000000-0000-4000-8000-0000001450a1','MKT Tháng 10 (Tùng Sale)','00000000-0000-4000-8000-000000014501','RUNNING',now() - interval '5 days','301');
select pg_temp.msg('00000000-0000-4000-8000-0000001451b1','00000000-0000-4000-8000-0000001450d4','00000000-0000-4000-8000-0000001450c2','uv-4',null,'5 hours');
select pg_temp.msg('00000000-0000-4000-8000-0000001451b2','00000000-0000-4000-8000-0000001450d4','00000000-0000-4000-8000-0000001450c2','uv-4','Bon_resume.docx','4 hours');
-- The reply is marked after the CV arrived: the CV is found then.
insert into public.channel_campaign_recipients(id,workspace_id,campaign_id,contact_id,status,stop_reason,replied_at,source_message_id) values
  ('00000000-0000-4000-8000-0000001450f2','00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-0000001450f1','00000000-0000-4000-8000-0000001450e2','REPLIED','REPLIED',now() - interval '5 hours','00000000-0000-4000-8000-0000001451b1');
select pg_temp.assert_true((select campaign_name = 'MKT Tháng 10 (Tùng Sale)' and file_name = 'Bon_resume.docx' from public.chat_cv_conversions where conversation_id = '00000000-0000-4000-8000-0000001450d4'),'campaign reply → CV counted from MKT Zalo');
select pg_temp.assert_true((select cv_file = 'Bon_resume.docx' from public.campaign_interaction_rows('00000000-0000-4000-8000-0000001450a1', null, null) where conversation_id = '00000000-0000-4000-8000-0000001450d4'),'campaign interactions use the same CV');

-- d5: a member sets "Đã có CV" in Luồng Rec (no file seen) → counted once, as REC_FLOW.
insert into public.candidate_flow_states(workspace_id,conversation_id,step,outcome,updated_by) values('00000000-0000-4000-8000-0000001450a1','00000000-0000-4000-8000-0000001450d5',8,'CV_RECEIVED','00000000-0000-4000-8000-000000014501');
select pg_temp.assert_true((select source = 'REC_FLOW' from public.chat_cv_conversions where conversation_id = '00000000-0000-4000-8000-0000001450d5'),'Luồng Rec "Đã có CV" counts');
select pg_temp.assert_true((select count(*) = 3 from public.chat_cv_conversions where workspace_id = '00000000-0000-4000-8000-0000001450a1'),'three CV chuyển hóa in all');

-- Members read only the nicks they may open.
grant select on public.chat_cv_conversions to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000014501',true);
select pg_temp.assert_true((select count(*) = 3 from public.chat_cv_conversions),'a member with every nick sees them');
reset role;
rollback;
