import "server-only";
import { withoutQuestionMarks } from "../core/approved-intro-flow";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { ChannelAdapterRegistry } from "@/modules/channels/core/channel-adapter-registry";
import { executeChannelOutboundAction } from "@/modules/channels/server/execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";
import { messageContext, object, recruiterProfileQuestion } from "../core/recruiter-text";

// AUTO only: when the model fails repeatedly, send a fixed, non-model reply so the candidate is not left waiting.
export async function sendGenerationFallback(
  run: { id: string; workspace_id: string; bot_id: string; conversation_id: string; inbound_message_id: string; mode: string },
  code: string,
) {
  const db = createPrivilegedClient();
  const [{ data: bot }, { data: conversation }, { data: state }, { data: inbound }] = await Promise.all([
    db.from("ai_recruiter_bots").select("id,bot_type,enabled,mode").eq("id", run.bot_id).eq("workspace_id", run.workspace_id).maybeSingle(),
    db
      .from("omnichannel_conversations")
      .select("id,status,takeover_mode,channel_account_id,metadata")
      .eq("id", run.conversation_id)
      .eq("workspace_id", run.workspace_id)
      .maybeSingle(),
    db
      .from("ai_recruiter_conversation_states")
      .select("profile,bot_paused,last_inbound_message_id")
      .eq("workspace_id", run.workspace_id)
      .eq("conversation_id", run.conversation_id)
      .maybeSingle(),
    db
      .from("omnichannel_messages")
      .select("text_content,attachment_count,metadata")
      .eq("workspace_id", run.workspace_id)
      .eq("conversation_id", run.conversation_id)
      .eq("id", run.inbound_message_id)
      .eq("direction", "INBOUND")
      .maybeSingle(),
  ]);
  const metadata =
    conversation?.metadata && typeof conversation.metadata === "object" && !Array.isArray(conversation.metadata)
      ? conversation.metadata
      : {};
  if (
    !bot?.enabled ||
    bot.mode !== "AUTO" ||
    run.mode !== "AUTO" ||
    !conversation ||
    conversation.takeover_mode !== "BOT_ALLOWED" ||
    !["OPEN", "PENDING"].includes(conversation.status) ||
    state?.bot_paused ||
    state?.last_inbound_message_id !== run.inbound_message_id ||
    String(metadata.aiRecruiterModeOverride ?? "").toUpperCase() !== "AUTO"
  )
    return false;
  const profile = object(state?.profile) ? state.profile : {};
  const matches = Array.isArray(profile.job_matches) ? profile.job_matches.filter(object) : [];
  const matchedJobId = typeof matches[0]?.jobId === "string" ? matches[0].jobId : null;
  const { data: job } = matchedJobId
    ? await db
        .from("ai_recruiter_jobs")
        .select("external_job_id,company_name,job_title,location,salary_range")
        .eq("workspace_id", run.workspace_id)
        .eq("bot_id", run.bot_id)
        .eq("external_job_id", matchedJobId)
        .eq("active", true)
        .maybeSingle()
    : { data: null };
  let text: string;
  const recruiterFallback =
    String(bot.bot_type) === "RECRUITER" && inbound ? recruiterProfileQuestion(messageContext(inbound), profile) : null;
  if (recruiterFallback) {
    text = recruiterFallback;
  } else if (job) {
    const salary = job.salary_range ? `, mức ${job.salary_range}` : "";
    text = `Em giới thiệu kỹ hơn nhé. Vị trí ${job.job_title} ở ${job.location}${salary}. Anh chia sẻ giúp em thời điểm có thể bắt đầu để em trao đổi bước tiếp theo nhé.`;
  } else if (profile.expected_salary === undefined) {
    text = "Anh chia sẻ giúp em mức thu nhập mong muốn để em lọc job sát hơn nhé.";
  } else if (profile.availability === undefined) {
    text = "Anh chia sẻ giúp em thời điểm có thể bắt đầu công việc mới nhé.";
  } else {
    text = "Em đang rà lại job phù hợp nhất theo hồ sơ của anh và sẽ trao đổi ngay ở bước tiếp theo nhé.";
  }
  text = withoutQuestionMarks(text);
  await db
    .from("ai_recruiter_runs")
    .update({
      status: "DRAFT_READY",
      proposed_text_parts: [text],
      safe_error_code: `${code}_FALLBACK`,
      completed_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  const proposed = await db.rpc("propose_ai_recruiter_message_service", {
    p_workspace_id: run.workspace_id,
    p_run_id: run.id,
    p_text_content: text,
    p_part: 1,
  });
  if (proposed.error || typeof proposed.data !== "string") return false;
  const loaded = await loadChannelAdapterByAccountId(conversation.channel_account_id),
    registry = new ChannelAdapterRegistry();
  registry.register(loaded.adapter);
  const dispatched = await executeChannelOutboundAction(proposed.data, registry);
  await db
    .from("ai_recruiter_runs")
    .update({
      status: dispatched.status === "SENT" ? "SENT" : "QUEUED",
      safe_error_code:
        dispatched.status === "SENT"
          ? `${code}_FALLBACK`
          : dispatched.status === "FAILED"
            ? dispatched.safeErrorCode
            : "DISPATCH_UNAVAILABLE",
    })
    .eq("id", run.id);
  if (dispatched.status === "SENT")
    await db
      .from("ai_recruiter_conversation_states")
      .update({ last_ai_run_id: run.id })
      .eq("workspace_id", run.workspace_id)
      .eq("conversation_id", run.conversation_id);
  return dispatched.status === "SENT";
}
