"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { loadChannelAdapterByAccountId } from "./load-channel-adapter";
import { randomUUID } from "node:crypto";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { getAccessibleChannelAccountIds, hasPermission, requirePermission } from "@/modules/access/server/access-control";
import type { ChannelActionState } from "../types/channel-action-state";

const vietnamPhoneSchema = z.string().regex(/^0(3|5|7|8|9)\d{8}$/u);
const pacingSchema = {
  dailyMessageLimit: z.coerce.number().int().min(1).max(5000),
  minDelaySeconds: z.coerce.number().int().min(5).max(86400),
  maxDelaySeconds: z.coerce.number().int().min(5).max(86400),
  batchSize: z.coerce.number().int().min(1).max(1000),
  batchPauseMinutes: z.coerce.number().int().min(1).max(1440),
};
const schema = z.object({
  name: z.string().trim().min(1).max(160),
  campaignType: z.string().trim().min(1).max(100),
  campaignTypeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/u),
  comboUv: z.string().trim().max(200).optional(),
  placement: z.string().trim().max(200).optional(),
  channelRank: z.string().trim().max(200).optional(),
  ownerName: z.string().trim().max(200).optional(),
  amRank: z.string().trim().max(200).optional(),
  messageVariants: z.array(z.string().trim().min(1).max(100000)).min(1).max(10),
  delayMinutes: z.coerce.number().int().min(0).max(525600),
  ...pacingSchema,
  channels: z.array(z.enum(["EMAIL","FACEBOOK","FACEBOOK_PROFILE","ZALO","WHATSAPP","VIBER","TELEGRAM","OTHER"])).min(1),
  contactIds: z.array(z.string().uuid()).max(5000),
  phoneRecipients: z.array(vietnamPhoneSchema).max(5000),
  senderIds: z.array(z.string().uuid()).min(1).max(50),
}).superRefine((value, context) => {
  if (value.contactIds.length === 0 && value.phoneRecipients.length === 0)
    context.addIssue({ code: "custom", path: ["phoneRecipients"], message: "Audience is required." });
  if (value.minDelaySeconds > value.maxDelaySeconds)
    context.addIssue({ code: "custom", path: ["maxDelaySeconds"], message: "Maximum delay must be greater than or equal to minimum delay." });
});

export async function deleteSelectedChannelCampaigns(formData:FormData):Promise<void>{
  const account=await requirePermission("campaigns.delete");
  const ids=[...new Set(formData.getAll("campaignId").flatMap(value=>{const parsed=z.string().uuid().safeParse(value);return parsed.success?[parsed.data]:[]}))].slice(0,100);
  const returnTo=formData.get("returnTo")==="facebook"?"/campaigns/facebook-profile":"/campaigns/omnichannel";
  if(!ids.length)redirect(`${returnTo}?archiveResult=none`);
  const db=createPrivilegedClient();
  const {data:campaigns,error:loadError}=await db.from("channel_campaigns").select("id,status").eq("workspace_id",account.workspaceId).is("archived_at",null).in("id",ids);
  if(loadError)redirect(`${returnTo}?archiveResult=error`);
  const archivableIds=(campaigns??[]).filter(item=>["DRAFT","COMPLETED","CANCELLED"].includes(item.status)).map(item=>item.id);
  let archived=0;
  if(archivableIds.length){
    const archivedAt=new Date().toISOString();
    const results=await Promise.all(archivableIds.map(id=>db.from("channel_campaigns").update({archived_at:archivedAt})
      .eq("workspace_id",account.workspaceId).eq("id",id).is("archived_at",null).select("id").maybeSingle()));
    if(results.some(result=>result.error))redirect(`${returnTo}?archiveResult=error`);
    archived=results.filter(result=>typeof result.data?.id==="string").length;
  }
  const skipped=Math.max(0,ids.length-archived);
  revalidatePath("/campaigns/omnichannel");
  revalidatePath("/campaigns/facebook-profile");
  redirect(`${returnTo}?archived=${archived}&skipped=${skipped}`);
}
const resolvePhonesSchema = z.object({ senderId: z.string().uuid(), phones: z.array(z.string().regex(/^0(3|5|7|8|9)\d{8}$/u)).min(1).max(200), requestFriend: z.boolean(), friendMessage: z.string().max(150) });
const facebookProfileCampaignSchema=z.object({name:z.string().trim().min(1).max(160),campaignType:z.string().trim().min(1).max(100),campaignTypeColor:z.string().regex(/^#[0-9A-Fa-f]{6}$/u),comboUv:z.string().trim().max(200).optional(),placement:z.string().trim().max(200).optional(),channelRank:z.string().trim().max(200).optional(),ownerName:z.string().trim().max(200).optional(),amRank:z.string().trim().max(200).optional(),messageVariants:z.array(z.string().trim().min(1).max(5000)).min(1).max(10),delayMinutes:z.coerce.number().int().min(0).max(525600),...pacingSchema,recipientValues:z.array(z.string().trim().min(1).max(500)).min(1).max(500),senderIds:z.array(z.string().uuid()).min(1)}).refine(value=>value.minDelaySeconds<=value.maxDelaySeconds,{path:["maxDelaySeconds"],message:"Maximum delay must be greater than or equal to minimum delay."});
export type ZaloPhoneResolveResult = { status: "success" | "error"; message: string; resolved: Array<{ phone: string; contactId: string; channelId: string; zaloId: string; displayName: string; isFriend: boolean; friendRequestStatus: string | null }>; notFound: string[] };

export async function createChannelCampaign(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = schema.safeParse({ ...Object.fromEntries(formData), messageVariants: formData.getAll("messageVariants"), channels: formData.getAll("channels"), contactIds: formData.getAll("contactIds"), phoneRecipients: formData.getAll("phoneRecipients"), senderIds: formData.getAll("senderIds") });
  const account = await getAccountContext();
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    if (fields.has("senderIds")) return { status: "error", message: "Vui lòng chọn ít nhất một tài khoản Zalo gửi." };
    if (fields.has("contactIds") || fields.has("phoneRecipients")) {
      const audienceIssue = parsed.error.issues.find((issue) => issue.path[0] === "contactIds" || issue.path[0] === "phoneRecipients");
      if (audienceIssue?.code === "too_big") return { status: "error", message: "Mỗi chiến dịch hỗ trợ tối đa 5.000 người nhận. Hãy giảm danh sách rồi thử lại." };
      return { status: "error", message: "Vui lòng chọn người nhận hoặc nhập danh sách SĐT hợp lệ (tối đa 5.000 người nhận)." };
    }
    if (fields.has("messageVariants")) return { status: "error", message: "Vui lòng kiểm tra và nhập đầy đủ từng mẫu nội dung." };
    if (fields.has("maxDelaySeconds")) return { status: "error", message: "Thời gian nghỉ tối đa phải lớn hơn hoặc bằng thời gian tối thiểu." };
    return { status: "error", message: "Một số thông tin chiến dịch chưa hợp lệ. Vui lòng kiểm tra lại tên, nhịp gửi và nội dung." };
  }
  if (!account?.workspaceId) return { status: "error", message: "Không xác định được không gian làm việc. Vui lòng tải lại trang và thử lại." };
  if (!await hasPermission("campaigns.create")) return { status: "error", message: "Bạn không có quyền tạo chiến dịch." };
  if (parsed.data.phoneRecipients.length > 0 && (!await hasPermission("contacts.create") || !await hasPermission("contacts.update")))
    return { status: "error", message: "Bạn không có quyền tạo người nhận từ danh sách SĐT." };
  const allowedSenderIds = await getAccessibleChannelAccountIds();
  if (allowedSenderIds !== null && parsed.data.senderIds.some(id => !allowedSenderIds.includes(id)))
    return { status: "error", message: "Bạn chưa được cấp quyền sử dụng tài khoản gửi đã chọn." };
  const client = await createClient();
  const privileged = createPrivilegedClient();
  const { data: campaignId, error } = await client.rpc("create_channel_campaign_draft", { p_name: parsed.data.name });
  if (error || typeof campaignId !== "string") return { status: "error", message: "Campaign could not be created." };
  const rollbackDraft = async (message: string): Promise<ChannelActionState> => {
    const cleanup = await privileged.from("channel_campaigns").delete().eq("id", campaignId).eq("workspace_id", account.workspaceId).eq("status", "DRAFT");
    if (cleanup.error) console.error("Channel campaign draft rollback failed", { code: cleanup.error.code });
    return { status: "error", message };
  };
  const metadataUpdate=await privileged.from("channel_campaigns").update({campaign_type:parsed.data.campaignType,campaign_type_color:parsed.data.campaignTypeColor,combo_uv:parsed.data.comboUv||null,placement:parsed.data.placement||null,channel_rank:parsed.data.channelRank||null,owner_name:parsed.data.ownerName||null,am_rank:parsed.data.amRank||null,daily_message_limit:parsed.data.dailyMessageLimit,min_delay_seconds:parsed.data.minDelaySeconds,max_delay_seconds:parsed.data.maxDelaySeconds,batch_size:parsed.data.batchSize,batch_pause_minutes:parsed.data.batchPauseMinutes}).eq("id",campaignId).eq("workspace_id",account.workspaceId).eq("status","DRAFT");
  if(metadataUpdate.error) return rollbackDraft("Không thể lưu thông tin chiến dịch. Bản nháp chưa hoàn tất; vui lòng thử lại.");
  const step = await client.rpc("add_channel_campaign_step", { p_campaign_id: campaignId, p_delay_minutes: parsed.data.delayMinutes, p_text_template: parsed.data.messageVariants[0], p_allowed_channels: parsed.data.channels });
  if (step.error || typeof step.data !== "string") return rollbackDraft("Không thể lưu nội dung chiến dịch. Bản nháp chưa hoàn tất; vui lòng thử lại.");
  const savedVariants=await privileged.from("channel_campaign_steps").update({content_variants:parsed.data.messageVariants}).eq("id",step.data).eq("workspace_id",account.workspaceId).eq("campaign_id",campaignId);
  if(savedVariants.error) return rollbackDraft("Không thể lưu các mẫu nội dung. Bản nháp chưa hoàn tất; vui lòng thử lại.");
  const recipientContactIds = new Set(parsed.data.contactIds);
  if (parsed.data.phoneRecipients.length > 0) {
    const phones = [...new Set(parsed.data.phoneRecipients)];
    for (let offset = 0; offset < phones.length; offset += 100) {
      const phoneBatch = phones.slice(offset, offset + 100);
      const contactByPhone = new Map<string, string>();
      const hasPhoneChannel = new Set<string>();
      const { data: channels, error: channelLookupError } = await privileged.from("contact_channels").select("contact_id,channel_value")
        .eq("workspace_id", account.workspaceId).eq("channel_type", "PHONE").in("channel_value", phoneBatch);
      if (channelLookupError) return rollbackDraft("Không thể tra cứu danh sách SĐT. Bản nháp chưa hoàn tất; vui lòng thử lại.");
      for (const channel of channels ?? []) {
        const phone = channel.channel_value.trim();
        if (!contactByPhone.has(phone)) contactByPhone.set(phone, channel.contact_id);
        hasPhoneChannel.add(phone);
      }
      const phonesWithoutChannel = phoneBatch.filter((phone) => !contactByPhone.has(phone));
      if (phonesWithoutChannel.length) {
        const { data: existingContacts, error: contactLookupError } = await privileged.from("contacts").select("id,phone")
          .eq("workspace_id", account.workspaceId).in("phone", phonesWithoutChannel);
        if (contactLookupError) return rollbackDraft("Không thể đối chiếu SĐT với liên hệ hiện có. Bản nháp chưa hoàn tất; vui lòng thử lại.");
        for (const contact of existingContacts ?? []) if (contact.phone && !contactByPhone.has(contact.phone)) contactByPhone.set(contact.phone, contact.id);
      }
      const contactsToCreate = phoneBatch.filter((phone) => !contactByPhone.has(phone)).map((phone) => ({
        workspace_id: account.workspaceId, full_name: `SĐT ••••${phone.slice(-4)}`, phone, source: "ZALO_CAMPAIGN_PHONE_IMPORT",
      }));
      if (contactsToCreate.length) {
        const { data: createdContacts, error: createContactsError } = await privileged.from("contacts").insert(contactsToCreate).select("id,phone");
        if (createContactsError || createdContacts?.length !== contactsToCreate.length) {
          console.error("Zalo phone import contact batch failed", { code: createContactsError?.code });
          return rollbackDraft("Không thể lưu đủ SĐT trong file. Bản nháp chưa hoàn tất; vui lòng kiểm tra file rồi thử lại.");
        }
        for (const contact of createdContacts) if (contact.phone) contactByPhone.set(contact.phone, contact.id);
      }
      const channelsToCreate = phoneBatch.filter((phone) => !hasPhoneChannel.has(phone)).flatMap((phone) => {
        const contactId = contactByPhone.get(phone);
        return contactId ? [{ workspace_id: account.workspaceId, contact_id: contactId, channel_type: "PHONE", channel_value: phone, marketing_consent_status: "UNKNOWN", metadata: { source: "ZALO_CAMPAIGN_PHONE_IMPORT" } }] : [];
      });
      if (channelsToCreate.length) {
        const { error: createChannelsError } = await privileged.from("contact_channels").insert(channelsToCreate);
        if (createChannelsError) {
          console.error("Zalo phone import channel batch failed", { code: createChannelsError.code });
          return rollbackDraft("Không thể lưu thông tin liên hệ từ file. Bản nháp chưa hoàn tất; vui lòng thử lại.");
        }
      }
      for (const phone of phoneBatch) {
        const contactId = contactByPhone.get(phone);
        if (!contactId) return rollbackDraft("Không thể xác định người nhận cho một SĐT. Bản nháp chưa hoàn tất; vui lòng thử lại.");
        recipientContactIds.add(contactId);
      }
    }
  }
  for (let index = 0; index < parsed.data.contactIds.length; index += 100) {
    const chunk = parsed.data.contactIds.slice(index, index + 100);
    const { data: validContacts, error: contactCheckError } = await privileged.from("contacts").select("id")
      .eq("workspace_id", account.workspaceId).in("id", chunk);
    if (contactCheckError || validContacts?.length !== chunk.length)
      return rollbackDraft("Một số người nhận không còn khả dụng trong workspace. Hãy tải lại danh sách rồi tạo lại chiến dịch.");
  }
  const contactIds = [...recipientContactIds];
  const { data: validSenders, error: senderCheckError } = await privileged.from("channel_accounts").select("id")
    .eq("workspace_id", account.workspaceId).eq("channel_type", "ZALO").eq("status", "CONNECTED").is("deleted_at", null).in("id", parsed.data.senderIds);
  if (senderCheckError || validSenders?.length !== parsed.data.senderIds.length)
    return rollbackDraft("Một tài khoản Zalo đã ngắt kết nối hoặc không còn khả dụng. Tải lại trang, chọn lại tài khoản rồi thử.");
  // The server has checked the actor's create permission, workspace ownership, consent flow,
  // recipient membership and sender-account access above. Bulk inserts avoid thousands of
  // per-recipient authenticated RPCs and keep large (1k+) campaigns from failing halfway.
  for (let index = 0; index < contactIds.length; index += 500) {
    const recipientInsert = await privileged.from("channel_campaign_recipients").insert(contactIds.slice(index, index + 500).map((contactId) => ({
      workspace_id: account.workspaceId, campaign_id: campaignId, contact_id: contactId,
    })));
    if (recipientInsert.error) {
      console.error("Channel campaign recipient batch insert failed", { code: recipientInsert.error.code, offset: index });
      return rollbackDraft("Không thể lưu người nhận vào chiến dịch. Bản nháp lỗi đã được dọn; vui lòng thử lại.");
    }
  }
  const senderInsert = await privileged.from("channel_campaign_senders").insert(parsed.data.senderIds.map((senderId) => ({
    workspace_id: account.workspaceId, campaign_id: campaignId, channel_account_id: senderId, priority: 100, enabled: true,
  })));
  if (senderInsert.error) {
    console.error("Channel campaign sender insert failed", { code: senderInsert.error.code });
    return rollbackDraft("Không thể lưu tài khoản Zalo gửi. Bản nháp lỗi đã được dọn; vui lòng thử lại.");
  }
  const [savedRecipients, savedSenders] = await Promise.all([
    privileged.from("channel_campaign_recipients").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("campaign_id", campaignId),
    privileged.from("channel_campaign_senders").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("campaign_id", campaignId),
  ]);
  if (savedRecipients.error || savedSenders.error || savedRecipients.count !== recipientContactIds.size || savedSenders.count !== parsed.data.senderIds.length)
    return rollbackDraft("Chưa lưu đủ người nhận hoặc tài khoản gửi. Bản nháp lỗi đã được dọn; vui lòng tải lại trang rồi thử lại.");
  redirect(`/campaigns/omnichannel/${campaignId}`);
}

export async function createFacebookProfileCampaign(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const parsed=facebookProfileCampaignSchema.safeParse({...Object.fromEntries(formData),messageVariants:formData.getAll("messageVariants"),recipientValues:formData.getAll("recipientValues"),senderIds:formData.getAll("senderIds")});
  const account=await getAccountContext();
  if(!parsed.success){const fields=new Set(parsed.error.issues.map(issue=>issue.path[0]));if(fields.has("senderIds"))return{status:"error",message:"Vui lòng chọn ít nhất một tài khoản Facebook cá nhân gửi."};if(fields.has("messageVariants"))return{status:"error",message:"Vui lòng kiểm tra và nhập đầy đủ từng mẫu nội dung."};if(fields.has("maxDelaySeconds"))return{status:"error",message:"Thời gian nghỉ tối đa phải lớn hơn hoặc bằng thời gian tối thiểu."};return{status:"error",message:"Một số thông tin chiến dịch Facebook chưa hợp lệ. Vui lòng kiểm tra lại tên, UID/link, nhịp gửi và nội dung."};}
  if(!account?.workspaceId)return{status:"error",message:"Không xác định được không gian làm việc. Vui lòng tải lại trang và thử lại."};
  if(!await hasPermission("campaigns.create"))return{status:"error",message:"Bạn không có quyền tạo chiến dịch."};
  const targets=[...new Map(parsed.data.recipientValues.map(value=>{const target=normalizeFacebookProfileTarget(value);return[target?.externalId??value,target]})).values()].filter((target):target is {externalId:string;sourceValue:string}=>Boolean(target));
  if(!targets.length)return{status:"error",message:"Không tìm thấy UID hoặc link Facebook hợp lệ."};
  const allowedSenderIds=await getAccessibleChannelAccountIds();
  if(allowedSenderIds!==null&&parsed.data.senderIds.some(id=>!allowedSenderIds.includes(id)))return{status:"error",message:"Bạn chưa được cấp quyền sử dụng tài khoản gửi đã chọn."};
  const privileged=createPrivilegedClient();
  const{data:senderRows,error:senderError}=await privileged.from("channel_accounts").select("id").eq("workspace_id",account.workspaceId).eq("channel_type","FACEBOOK_PROFILE").eq("status","CONNECTED").in("id",parsed.data.senderIds);
  if(senderError||senderRows?.length!==parsed.data.senderIds.length)return{status:"error",message:"Một tài khoản Facebook cá nhân không khả dụng."};
  const client=await createClient();
  const{data:campaignId,error}=await client.rpc("create_channel_campaign_draft",{p_name:parsed.data.name});
  if(error||typeof campaignId!=="string")return{status:"error",message:"Không thể tạo bản nháp chiến dịch."};
  const createdContactIds:string[]=[];
  const rollback=async(message:string):Promise<ChannelActionState>=>{
    await privileged.from("channel_campaigns").delete().eq("id",campaignId).eq("workspace_id",account.workspaceId).eq("status","DRAFT");
    if(createdContactIds.length)await privileged.from("contacts").delete().eq("workspace_id",account.workspaceId).in("id",createdContactIds).eq("source","FACEBOOK_PROFILE_CAMPAIGN_IMPORT");
    return{status:"error",message};
  };
  const metadata=await privileged.from("channel_campaigns").update({campaign_type:parsed.data.campaignType,campaign_type_color:parsed.data.campaignTypeColor,combo_uv:parsed.data.comboUv||null,placement:parsed.data.placement||null,channel_rank:parsed.data.channelRank||null,owner_name:parsed.data.ownerName||null,am_rank:parsed.data.amRank||null,daily_message_limit:parsed.data.dailyMessageLimit,min_delay_seconds:parsed.data.minDelaySeconds,max_delay_seconds:parsed.data.maxDelaySeconds,batch_size:parsed.data.batchSize,batch_pause_minutes:parsed.data.batchPauseMinutes}).eq("id",campaignId).eq("workspace_id",account.workspaceId).eq("status","DRAFT");
  if(metadata.error)return rollback("Không thể lưu thông tin chiến dịch.");
  const step=await client.rpc("add_channel_campaign_step",{p_campaign_id:campaignId,p_delay_minutes:parsed.data.delayMinutes,p_text_template:parsed.data.messageVariants[0],p_allowed_channels:["FACEBOOK_PROFILE"]});
  if(step.error||typeof step.data!=="string")return rollback("Không thể lưu nội dung chiến dịch Facebook cá nhân.");
  const variants=await privileged.from("channel_campaign_steps").update({content_variants:parsed.data.messageVariants}).eq("id",step.data).eq("workspace_id",account.workspaceId).eq("campaign_id",campaignId);
  if(variants.error)return rollback("Không thể lưu các mẫu nội dung Facebook cá nhân.");
  for(const target of targets){
    const existing=await privileged.from("contact_channels").select("contact_id").eq("workspace_id",account.workspaceId).eq("channel_type","FACEBOOK_PROFILE").eq("channel_value",target.externalId).limit(1).maybeSingle();
    if(existing.error)return rollback(`Không thể kiểm tra UID ${target.sourceValue}.`);
    let contactId=existing.data?.contact_id as string|undefined;
    if(!contactId){
      const created=await privileged.from("contacts").insert({workspace_id:account.workspaceId,full_name:`Facebook ${target.externalId}`,source:"FACEBOOK_PROFILE_CAMPAIGN_IMPORT"}).select("id").single();
      if(created.error||!created.data)return rollback(`Không thể tạo liên hệ cho ${target.sourceValue}.`);
      contactId=created.data.id;createdContactIds.push(created.data.id);
      const channel=await privileged.from("contact_channels").insert({workspace_id:account.workspaceId,contact_id:contactId,channel_type:"FACEBOOK_PROFILE",channel_value:target.externalId,marketing_consent_status:"UNKNOWN",metadata:{source:"FACEBOOK_PROFILE_CAMPAIGN_IMPORT",input:target.sourceValue}});
      if(channel.error)return rollback(`Không thể lưu UID ${target.sourceValue}.`);
    }
    const recipient=await client.rpc("add_channel_campaign_recipient",{p_campaign_id:campaignId,p_contact_id:contactId});
    if(recipient.error||typeof recipient.data!=="string")return rollback("Không thể thêm một người nhận vào chiến dịch.");
    for(const senderId of parsed.data.senderIds){
      const conversation=await privileged.from("omnichannel_conversations").upsert({workspace_id:account.workspaceId,channel_account_id:senderId,channel_type:"FACEBOOK_PROFILE",provider_conversation_id:target.externalId,contact_id:contactId,status:"OPEN",metadata:{participantExternalId:target.externalId,source:"FACEBOOK_PROFILE_CAMPAIGN_IMPORT"}},{onConflict:"workspace_id,channel_account_id,provider_conversation_id"});
      if(conversation.error)return rollback(`Không thể chuẩn bị hội thoại cho ${target.sourceValue}.`);
    }
  }
  for(const senderId of parsed.data.senderIds){
    const sender=await client.rpc("add_channel_campaign_sender",{p_campaign_id:campaignId,p_channel_account_id:senderId,p_priority:100});
    if(sender.error||typeof sender.data!=="string")return rollback("Không thể thêm tài khoản gửi.");
  }
  redirect(`/campaigns/facebook-profile/${campaignId}`);
}

function normalizeFacebookProfileTarget(raw:string){const value=raw.trim();if(/^[1-9]\d{4,30}$/u.test(value))return{externalId:value,sourceValue:value};try{const url=new URL(/^https?:\/\//iu.test(value)?value:`https://${value}`);if(!/(^|\.)facebook\.com$/iu.test(url.hostname))return null;const queryId=url.searchParams.get("id");if(queryId&&/^[1-9]\d{4,30}$/u.test(queryId))return{externalId:queryId,sourceValue:value};const segment=url.pathname.split("/").filter(Boolean)[0];if(segment&&/^(?:[1-9]\d{4,30}|[A-Za-z0-9.]{5,100})$/u.test(segment)&&!["profile.php","messages","groups","pages","marketplace"].includes(segment.toLowerCase()))return{externalId:segment,sourceValue:value};return null}catch{return null}}

export async function startChannelCampaign(campaignId: string): Promise<void> {
  const parsed = z.string().uuid().safeParse(campaignId);
  const account = await getAccountContext();
  if (!parsed.success) redirect("/campaigns/omnichannel?startError=not-found");
  const path = `/campaigns/omnichannel/${parsed.data}`;
  if (!account?.workspaceId) redirect(`${path}?startError=workspace`);
  if (!await hasPermission("campaigns.launch")) redirect(`${path}?startError=permission`);
  const privileged = createPrivilegedClient();
  const {data:existing,error:existingError}=await privileged.from("channel_campaigns")
    .select("status").eq("id",parsed.data).eq("workspace_id",account.workspaceId).maybeSingle();
  if(existingError||!existing)redirect(`${path}?startError=check`);
  // A duplicate form submit or a lost RPC response must not report failure
  // after the first launch has already committed.
  if(existing.status==="RUNNING")redirect(path);
  if(existing.status!=="DRAFT")redirect(`${path}?startError=blocked`);
  const client = await createClient();
  const allowedSenderIds = await getAccessibleChannelAccountIds();
  if (allowedSenderIds !== null) {
    const { data: senders, error: senderError } = await client.from("channel_campaign_senders")
      .select("channel_account_id").eq("campaign_id", parsed.data);
    if (senderError) redirect(`/campaigns/omnichannel/${parsed.data}?startError=check`);
    if (!senders?.length) redirect(`/campaigns/omnichannel/${parsed.data}?startError=senders`);
    if (senders.some(sender => !allowedSenderIds.includes(sender.channel_account_id))) redirect(`/campaigns/omnichannel/${parsed.data}?startError=permission`);
  }
  const recipients: Array<{ contact_id: string }> = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data: page, error: recipientError } = await privileged.from("channel_campaign_recipients")
      .select("contact_id").eq("workspace_id", account.workspaceId).eq("campaign_id", parsed.data).range(offset, offset + 999);
    if (recipientError) redirect(`/campaigns/omnichannel/${parsed.data}?startError=check`);
    recipients.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  if (!recipients.length) redirect(`/campaigns/omnichannel/${parsed.data}?startError=audience`);
  const { data: configuredSenders, error: configuredSenderError } = await privileged.from("channel_campaign_senders")
    .select("id").eq("workspace_id", account.workspaceId).eq("campaign_id", parsed.data).eq("enabled", true);
  if (configuredSenderError) redirect(`/campaigns/omnichannel/${parsed.data}?startError=check`);
  if (!configuredSenders?.length) redirect(`/campaigns/omnichannel/${parsed.data}?startError=senders`);
  const { data: configuredSteps, error: configuredStepError } = await privileged.from("channel_campaign_steps")
    .select("id").eq("workspace_id", account.workspaceId).eq("campaign_id", parsed.data);
  if (configuredStepError) redirect(`/campaigns/omnichannel/${parsed.data}?startError=check`);
  if (!configuredSteps?.length) redirect(`/campaigns/omnichannel/${parsed.data}?startError=content`);
  const contactIds = [...new Set(recipients.map((recipient) => recipient.contact_id))];
  for (let index = 0; index < contactIds.length; index += 100) {
    const consentUpdate = await privileged.from("contact_channels").update({
      marketing_consent_status: "OPTED_IN",
      marketing_consent_source: "CAMPAIGN_LAUNCH_CONFIRMATION",
      marketing_consent_recorded_at: new Date().toISOString(),
    }).eq("workspace_id", account.workspaceId)
      .in("contact_id", contactIds.slice(index, index + 100))
      .in("channel_type", ["PHONE", "ZALO", "FACEBOOK_PROFILE"])
      .eq("marketing_consent_status", "UNKNOWN");
    if (consentUpdate.error) redirect(`/campaigns/omnichannel/${parsed.data}?startError=consent`);
  }
  const { data, error } = await client.rpc("start_channel_campaign", { p_campaign_id: parsed.data });
  if (error || data !== true) {
    const {data:afterLaunch}=await privileged.from("channel_campaigns")
      .select("status").eq("id",parsed.data).eq("workspace_id",account.workspaceId).maybeSingle();
    if(afterLaunch?.status!=="RUNNING")redirect(`${path}?startError=blocked`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function setChannelCampaignPaused(campaignId: string, pause: boolean): Promise<void> {
  const parsed = z.string().uuid().safeParse(campaignId);
  if (!parsed.success) redirect("/campaigns/omnichannel");
  const path = `/campaigns/omnichannel/${parsed.data}`;
  if (typeof pause !== "boolean") redirect(`${path}?controlError=update`);
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("campaigns.launch")) redirect(`${path}?controlError=permission`);
  const privileged = createPrivilegedClient();
  const from = pause ? "RUNNING" : "PAUSED";
  const to = pause ? "PAUSED" : "RUNNING";
  const { data, error } = await privileged.from("channel_campaigns")
    .update({ status: to })
    .eq("id", parsed.data).eq("workspace_id", account.workspaceId).eq("status", from)
    .is("archived_at", null).select("id").maybeSingle();
  if (error) redirect(`${path}?controlError=update`);
  if (!data) redirect(`${path}?controlError=changed`);
  const event = await privileged.from("channel_campaign_events").insert({
    workspace_id: account.workspaceId, campaign_id: parsed.data,
    event_type: pause ? "PAUSED" : "RESUMED",
  });
  if (event.error) console.error("Channel campaign status event unavailable", { code: event.error.code });
  revalidatePath(path);
  revalidatePath("/campaigns/omnichannel");
  redirect(`${path}?controlResult=${pause ? "paused" : "resumed"}`);
}

export async function resolveImportedZaloPhones(formData: FormData): Promise<ZaloPhoneResolveResult> {
  const parsed = resolvePhonesSchema.safeParse({ senderId: formData.get("senderId"), phones: formData.getAll("phone"), requestFriend: formData.get("requestFriend") === "confirmed", friendMessage: String(formData.get("friendMessage") ?? "") });
  const account = await getAccountContext();
  const empty = { resolved: [], notFound: [] };
  if (!parsed.success || !account?.workspaceId) return { status: "error", message: "Danh sách SĐT hoặc tài khoản Zalo không hợp lệ.", ...empty };
  if (!await hasPermission("campaigns.create") || !await hasPermission("contacts.create") || !await hasPermission("contacts.update"))
    return { status: "error", message: "Bạn không có quyền tra cứu và tạo liên hệ chiến dịch.", ...empty };
  const allowed = await getAccessibleChannelAccountIds();
  if (allowed !== null && !allowed.includes(parsed.data.senderId)) return { status: "error", message: "Bạn chưa được cấp quyền sử dụng tài khoản Zalo này.", ...empty };
  const client = await createClient();
  const sender = await client.from("channel_accounts").select("id").eq("id", parsed.data.senderId).eq("workspace_id", account.workspaceId).eq("channel_type", "ZALO").eq("status", "CONNECTED").maybeSingle();
  if (sender.error || !sender.data) return { status: "error", message: "Tài khoản Zalo không khả dụng.", ...empty };
  const loaded = await loadChannelAdapterByAccountId(parsed.data.senderId);
  if (!("findUserByPhone" in loaded.adapter) || typeof loaded.adapter.findUserByPhone !== "function") return { status: "error", message: "Bridge Zalo chưa hỗ trợ tra cứu SĐT.", ...empty };
  const privileged = createPrivilegedClient();
  const resolved: ZaloPhoneResolveResult["resolved"] = [], notFound: string[] = [];
  for (const phone of [...new Set(parsed.data.phones)]) {
    const identity = await loaded.adapter.findUserByPhone(`+84${phone.slice(1)}`, randomUUID());
    if (!identity) { notFound.push(phone); continue; }
    const existingPhone = await privileged.from("contact_channels").select("contact_id").eq("workspace_id", account.workspaceId).eq("channel_type", "PHONE").eq("channel_value", phone).maybeSingle();
    let contactId = existingPhone.data?.contact_id as string | undefined;
    if (!contactId) {
      const created = await privileged.from("contacts").insert({ workspace_id: account.workspaceId, full_name: identity.displayName, phone, source: "ZALO_PHONE_IMPORT" }).select("id").single();
      if (created.error || !created.data) continue;
      contactId = created.data.id;
    }
    if (!contactId) continue;
    await privileged.from("contact_channels").upsert({ workspace_id: account.workspaceId, contact_id: contactId, channel_type: "PHONE", channel_value: phone, metadata: { source: "ZALO_PHONE_IMPORT" } }, { onConflict: "workspace_id,channel_type,channel_value" });
    const zaloChannel = await privileged.from("contact_channels").upsert({ workspace_id: account.workspaceId, contact_id: contactId, channel_type: "ZALO", channel_value: identity.userId, metadata: { phone, displayName: identity.displayName, avatarUrl: identity.avatarUrl, resolvedByAccountId: parsed.data.senderId } }, { onConflict: "workspace_id,channel_type,channel_value" }).select("id").single();
    if (zaloChannel.error || !zaloChannel.data) continue;
    await privileged.from("omnichannel_conversations").upsert({ workspace_id: account.workspaceId, channel_account_id: parsed.data.senderId, channel_type: "ZALO", provider_conversation_id: identity.userId, contact_id: contactId, status: "OPEN", metadata: { participantExternalId: identity.userId, participantDisplayName: identity.displayName, resolvedFromPhone: phone } }, { onConflict: "workspace_id,channel_account_id,provider_conversation_id" });
    let friendRequestStatus: string | null = null;
    if (parsed.data.requestFriend && !identity.isFriend && "sendFriendRequest" in loaded.adapter && typeof loaded.adapter.sendFriendRequest === "function")
      friendRequestStatus = await loaded.adapter.sendFriendRequest(identity.userId, parsed.data.friendMessage, randomUUID());
    resolved.push({ phone, contactId, channelId: zaloChannel.data.id, zaloId: identity.userId, displayName: identity.displayName, isFriend: identity.isFriend, friendRequestStatus });
  }
  revalidatePath("/campaigns/omnichannel/new");
  return { status: "success", message: `Đã nhận diện ${resolved.length}/${parsed.data.phones.length} SĐT trên Zalo${parsed.data.requestFriend ? " và xử lý lời mời đã xác nhận" : ""}.`, resolved, notFound };
}
