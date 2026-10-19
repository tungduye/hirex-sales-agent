import "server-only";

import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import { applyHolaResult, HOLA_RESULT_SCHEMA, holaInstructions, holeInstructions, jobOverview, jobsForPrompt, offerMissing, readyForOffer, type FlowJob, type RecFlowState } from "../core/rec-flow";
import { flowConversation, readFlow } from "./rec-flow-store";

const JOB_FIELDS = "id,code,title,career_track,company_name,company_name_public,location,work_mode,japanese_level_min,experience_min,salary_range,selling_points,summary,requirements,jd_link,interview_process,priority";
export type FlowScope = NonNullable<Awaited<ReturnType<typeof flowConversation>>>;
export type RecDraftResult = { ok: true; draft: string; flow: RecFlowState } | { ok: false; message: string };

/**
 * One draft for a one-to-one candidate chat. Hola follows the 8-step script closely (fast model, recent chat);
 * Hole uses the same flow as a compass but answers freely (stronger model, longer chat, more jobs).
 * Returns the draft and the flow state to save once the draft is actually sent.
 */
export async function draftRecReply(input: { scope: FlowScope; instruction: string; mode: "hola" | "hole"; apiKey: string; model: string }): Promise<RecDraftResult> {
  const { db, conversation } = input.scope;
  const hole = input.mode === "hole";
  const [{ data: messages, error }, { state }, { data: jobRows }, { data: contact }] = await Promise.all([
    db.from("omnichannel_messages").select("id,direction,sender_external_id,text_content,attachment_count,created_at").eq("workspace_id", conversation.workspaceId)
      .eq("conversation_id", conversation.id).order("created_at", { ascending: false }).limit(hole ? 50 : 30),
    readFlow(db, conversation),
    db.from("recruitment_jobs").select(JOB_FIELDS).eq("workspace_id", conversation.workspaceId).eq("status", "OPEN").order("updated_at", { ascending: false }).limit(300),
    conversation.contactId ? db.from("contacts").select("full_name").eq("workspace_id", conversation.workspaceId).eq("id", conversation.contactId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: nick } = await db.from("channel_accounts").select("display_name").eq("workspace_id", conversation.workspaceId).eq("id", conversation.channelAccountId).maybeSingle();
  if (error) return { ok: false, message: "Không đọc được nội dung cuộc chat." };
  const rows = (messages ?? []).reverse().filter((message) => message.sender_external_id !== "system");
  // File names the candidate sent (a CV shows up as "CV_Nguyen_Van_A.pdf").
  const withFiles = rows.filter((message) => Number(message.attachment_count) > 0).map((message) => message.id).slice(-20);
  const names = new Map<string, string[]>();
  if (withFiles.length) {
    const { data: links } = await db.from("channel_message_attachments").select("message_id,attachment_id").eq("workspace_id", conversation.workspaceId).in("message_id", withFiles);
    const ids = [...new Set((links ?? []).map((link) => String(link.attachment_id)))];
    const { data: files } = ids.length ? await db.from("channel_attachments").select("id,filename").eq("workspace_id", conversation.workspaceId).in("id", ids) : { data: [] };
    const byId = new Map((files ?? []).map((file) => [String(file.id), String(file.filename)]));
    for (const link of links ?? []) { const name = byId.get(String(link.attachment_id)); if (name) names.set(String(link.message_id), [...(names.get(String(link.message_id)) ?? []), name.slice(0, 120)]); }
  }
  const chat = rows.map((message) => ({ from: message.direction === "OUTBOUND" ? "Recruiter" : "Ứng viên",
    text: typeof message.text_content === "string" ? message.text_content.slice(0, 3000) : null,
    files: names.get(message.id) ?? (Number(message.attachment_count) > 0 ? [`${Number(message.attachment_count)} tệp`] : undefined) }));
  const jobs: FlowJob[] = (jobRows ?? []).flatMap((row) => typeof row.id === "string" && typeof row.code === "string" ? [{ id: row.id, code: row.code, title: String(row.title),
    careerTrack: String(row.career_track), companyName: String(row.company_name), companyNamePublic: row.company_name_public !== false, location: String(row.location),
    workMode: row.work_mode ?? null, japaneseLevelMin: row.japanese_level_min ?? null, experienceMin: row.experience_min ?? null, salaryRange: row.salary_range ?? null,
    sellingPoints: row.selling_points ?? null, summary: row.summary ?? null, requirements: row.requirements ?? null, jdLink: row.jd_link ?? null,
    interviewProcess: row.interview_process ?? null, priority: row.priority === "HIGH" ? "HIGH" as const : "NORMAL" as const }] : []);
  const label = (id: string) => { const job = jobs.find((item) => item.id === id); return job ? { code: job.code, viTri: job.title, congTy: job.companyNamePublic ? job.companyName : "(ẩn tên)" } : null; };
  try {
    const response = await postOpenAIResponse({ apiKey: input.apiKey, timeoutMs: hole ? 60_000 : 45_000, body: {
      model: input.model, max_output_tokens: hole ? 2000 : 1500, instructions: hole ? holeInstructions() : holaInstructions(),
      input: JSON.stringify({
        TRANG_THAI: { buocHienTai: state.step, daBiet: state.facts, jobDaGioiThieu: state.offeredJobIds.map(label).filter(Boolean),
          jobBiTuChoi: state.rejectedJobs.map((job) => ({ ...label(job.jobId), lyDo: job.reason })), ketQua: state.outcome },
        NICK: typeof nick?.display_name === "string" ? nick.display_name : null,
        UNG_VIEN: { ten: typeof contact?.full_name === "string" ? contact.full_name : null },
        DUOC_GIOI_THIEU_JOB: readyForOffer(state), CON_THIEU: readyForOffer(state) ? [] : offerMissing(state.facts),
        TONG_QUAN_JOB: jobOverview(jobs),
        JOBS: readyForOffer(state) ? jobsForPrompt(jobs, state, hole ? 20 : 12) : [], CUOC_CHAT: chat, CHO_UNG_VIEN_TRA_LOI: chat.at(-1)?.from === "Recruiter",
        Y_CUA_NHAN_VIEN: input.instruction || null,
      }).slice(0, 90_000),
      text: { format: { type: "json_schema", name: "rec_draft", strict: true, schema: HOLA_RESULT_SCHEMA } },
    } });
    if (!response.ok) return { ok: false, message: `Không kết nối được ${hole ? "Hole" : "Hola"}, thử lại sau.` };
    const raw = responseOutputText(await response.json()).trim();
    const applied = raw ? applyHolaResult(JSON.parse(raw), state, jobs) : null;
    return applied ? { ok: true, draft: applied.draft, flow: applied.next } : { ok: false, message: `${hole ? "Hole" : "Hola"} trả về nháp không dùng được, thử lại nhé.` };
  } catch { return { ok: false, message: `Không kết nối được ${hole ? "Hole" : "Hola"}, thử lại sau.` }; }
}
