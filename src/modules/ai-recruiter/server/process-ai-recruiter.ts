import "server-only";
import { approvedIntroReply, withoutQuestionMarks } from "../core/approved-intro-flow";
import { initialRecruiterOpening, withFirstGreeting } from "../core/recruiter-opening";
import { recoverIntroMemory } from "../core/intro-memory";
import { CV_REQUEST, jobIntroduction, nextJobIntroduction, nextScriptJob, SALARY_QUESTION, salaryFollowup, salaryInText, startDateInText } from "../core/recruiter-script";
import { introductionQuestion, missingIntroField } from "../core/profile-disclosure-gate";
import { containsJobDisclosure } from "../core/anonymous-job-preview";
import { candidateBurst, shapeReply } from "../core/reply-shaping";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { ChannelAdapterRegistry } from "@/modules/channels/core/channel-adapter-registry";
import { executeChannelOutboundAction } from "@/modules/channels/server/execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";
import {
  availabilityFollowup,
  candidateExplicitlyHasNoCv,
  eligibleRecruiterJobIds,
  isManagementRecruiterJob,
} from "./ai-recruiter-job-policy";
import { recruiterRejectionKind, recruiterRejectionOverride } from "@/modules/ai-recruiter/core/recruiter-conversation-policy";
import {
  clarificationReply,
  hasCvEvidence,
  humanizeRecruiterReply,
  mentionsJob,
  messageContext,
  normalizedEvidence,
  normalizedMatchText,
  object,
} from "../core/recruiter-text";
import { generateRecruiterReply } from "./generate-recruiter-reply";
import { sendGenerationFallback } from "./send-generation-fallback";

async function processRun(run: {
  id: string;
  workspace_id: string;
  bot_id: string;
  conversation_id: string;
  inbound_message_id: string;
  mode: string;
  input_snapshot?: unknown;
}) {
  const db = createPrivilegedClient(),
    claimed = await db
      .from("ai_recruiter_runs")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("status", "PENDING")
      .select("id")
      .maybeSingle();
  if (!claimed.data) return "SKIPPED";
  const aiAttempt =
    object(run.input_snapshot) && typeof run.input_snapshot.aiAttempt === "number"
      ? Math.max(0, Math.floor(run.input_snapshot.aiAttempt))
      : 0;
  try {
    const { data: inbound } = await db
      .from("omnichannel_messages")
      .select("id,direction,text_content,attachment_count,metadata,created_at")
      .eq("workspace_id", run.workspace_id)
      .eq("conversation_id", run.conversation_id)
      .eq("id", run.inbound_message_id)
      .eq("direction", "INBOUND")
      .maybeSingle();
    if (!inbound) throw new Error("INBOUND_MESSAGE_UNAVAILABLE");
    if (Date.now() - Date.parse(inbound.created_at) < 8000) {
      await db.from("ai_recruiter_runs").update({ status: "PENDING", started_at: null }).eq("id", run.id);
      return "DEBOUNCED";
    }
    const [{ data: bot }, { data: conversation }, { data: state }, { data: messages }, { data: jobs }, { data: stages }] =
      await Promise.all([
        db
          .from("ai_recruiter_bots")
          .select(
            "id,name,bot_type,enabled,mode,model,recruiter_name,company_intro,job_scope,max_jobs_to_offer,extra_rules,reminder_1_minutes",
          )
          .eq("id", run.bot_id)
          .eq("workspace_id", run.workspace_id)
          .maybeSingle(),
        db
          .from("omnichannel_conversations")
          .select("id,status,takeover_mode,channel_account_id,metadata")
          .eq("id", run.conversation_id)
          .eq("workspace_id", run.workspace_id)
          .maybeSingle(),
        db
          .from("ai_recruiter_conversation_states")
          .select("status,current_stage,profile,offered_job_ids,bot_paused,last_inbound_message_id")
          .eq("workspace_id", run.workspace_id)
          .eq("conversation_id", run.conversation_id)
          .maybeSingle(),
        db
          .from("omnichannel_messages")
          .select("id,direction,text_content,attachment_count,metadata,created_at")
          .eq("workspace_id", run.workspace_id)
          .eq("conversation_id", run.conversation_id)
          .lte("created_at", inbound.created_at)
          .order("created_at", { ascending: false })
          .limit(20),
        db
          .from("ai_recruiter_jobs")
          .select(
            "external_job_id,priority,sale_stage,company_name,job_title,candidate_type,location,japanese_level_min,japan_years_min,salary_range,process_summary,summary,selling_points,requirements,jd_link,avoid_reason_tags",
          )
          .eq("workspace_id", run.workspace_id)
          .eq("bot_id", run.bot_id)
          .eq("active", true)
          .order("priority")
          .limit(50),
        db
          .from("ai_recruiter_stages")
          .select("stage_key,stage_name,message_template,next_stage,wait_for_candidate,stop_bot,next_question_field,notes")
          .eq("workspace_id", run.workspace_id)
          .eq("bot_id", run.bot_id)
          .order("sort_order"),
      ]);
    const conversationKind =
      conversation?.metadata &&
      typeof conversation.metadata === "object" &&
      !Array.isArray(conversation.metadata) &&
      "conversationKind" in conversation.metadata
        ? String(conversation.metadata.conversationKind ?? "").toUpperCase()
        : "";
    if (
      !bot?.enabled ||
      !conversation ||
      conversationKind === "GROUP" ||
      state?.bot_paused ||
      state?.last_inbound_message_id !== run.inbound_message_id ||
      conversation.takeover_mode !== "BOT_ALLOWED"
    )
      throw new Error("BOT_NOT_ELIGIBLE");
    const resetAt =
      conversation.metadata &&
      typeof conversation.metadata === "object" &&
      !Array.isArray(conversation.metadata) &&
      "aiRecruiterResetAt" in conversation.metadata &&
      typeof conversation.metadata.aiRecruiterResetAt === "string"
        ? Date.parse(conversation.metadata.aiRecruiterResetAt)
        : Number.NaN;
    const contextMessages = (messages ?? [])
      .filter((message) => !Number.isFinite(resetAt) || Date.parse(message.created_at) >= resetAt)
      .reverse()
      .map((message) => ({ role: message.direction, text: messageContext(message) }));
    const priorProfile = recoverIntroMemory(contextMessages, object(state?.profile) ? state.profile : {});
    const priorRejectedCompanies = new Set(
      (Array.isArray(priorProfile.rejected_companies) ? priorProfile.rejected_companies : [])
        .filter((value): value is string => typeof value === "string")
        .map(normalizedMatchText),
    );
    const jobsForGeneration = (jobs ?? []).filter((job) =>
      eligibleRecruiterJobIds([job], priorRejectedCompanies, priorProfile.management_experience).has(job.external_job_id),
    );
    const inputSnapshot = {
      messageCount: contextMessages.length,
      jobCount: jobsForGeneration.length,
      excludedJobCount: (jobs?.length ?? 0) - jobsForGeneration.length,
      stageCount: stages?.length ?? 0,
      currentStage: state?.current_stage ?? null,
    };
    await db
      .from("ai_recruiter_runs")
      .update({ input_snapshot: { ...inputSnapshot, aiAttempt } })
      .eq("id", run.id);
    const anonymousOnly = String(bot.bot_type) === "RECRUITER" && missingIntroField(priorProfile) !== null;
    const cvEvidence = hasCvEvidence(inbound),
      latestText = candidateBurst(contextMessages) || messageContext(inbound),
      noCvYet = candidateExplicitlyHasNoCv(latestText),
      generated = await generateRecruiterReply({
        model: bot.model,
        bot,
        state: { ...state, profile: priorProfile },
        messages: contextMessages,
        jobs: jobsForGeneration,
        stages: anonymousOnly ? [] : (stages ?? []),
        latestInbound: { text: latestText, cvEvidence },
      });
    // A newer candidate message arriving during generation supersedes this run.
    const fresh = await db
      .from("ai_recruiter_conversation_states")
      .select("last_inbound_message_id,bot_paused")
      .eq("workspace_id", run.workspace_id)
      .eq("conversation_id", run.conversation_id)
      .maybeSingle();
    if (fresh.error || !fresh.data || fresh.data.bot_paused || fresh.data.last_inbound_message_id !== run.inbound_message_id)
      throw new Error("BOT_NOT_ELIGIBLE");
    const result = {
      ...generated,
      replyParts: [generated.replyParts.join("\n\n")],
      ...(noCvYet
        ? {
            handoffRequested: false,
            handoffReason: "",
            stopBot: false,
            conversationStatus: "DISCUSSING_PROCESS" as const,
            nextStage: state?.current_stage ?? generated.nextStage,
          }
        : {}),
    };
    if (result.profileUpdates.cv_received === true && !cvEvidence) throw new Error("AI_INVALID_OUTPUT");
    const normalizedLatest = normalizedEvidence(latestText);
    const supportedFacts = result.facts.filter(
      (fact) =>
        normalizedLatest.includes(normalizedEvidence(fact.evidenceQuote)) &&
        (fact.fieldKey !== "cv_received" || fact.value !== true || cvEvidence),
    );
    // Never trust free-standing profileUpdates from the model. A profile field is
    // persisted only when the model also supplies a verbatim evidence quote that
    // is present in the latest inbound message. This prevents a greeting such as
    // "hi em" from hallucinating a complete candidate profile and skipping the
    // guided recruiter questions.
    const profileBase: Record<string, unknown> = {
      ...priorProfile,
      ...Object.fromEntries(
        supportedFacts
          .filter(
            (fact) =>
              fact.value !== "" &&
              (!["candidate_type", "location", "japanese_level"].includes(fact.fieldKey) || typeof fact.value === "string"),
          )
          .map((fact) => [fact.fieldKey, fact.value]),
      ),
      ...(noCvYet ? { cv_received: false } : {}),
    };
    // Several places at once ("HN và Nhật cũng ok"): the first one is where to look first; the rest stay as preferences.
    if ((typeof profileBase.location !== "string" || !profileBase.location.trim()) && Array.isArray(profileBase.preferred_locations)) {
      const first = profileBase.preferred_locations.find((value): value is string => typeof value === "string" && value.trim() !== "");
      if (first) profileBase.location = first;
    }
    const offeredJobIds = Array.isArray(state?.offered_job_ids)
      ? state.offered_job_ids.filter((value): value is string => typeof value === "string")
      : [];
    const lastOfferedJob = (jobs ?? []).find((job) => job.external_job_id === offeredJobIds.at(-1));
    const rejectionKind = String(bot.bot_type) === "RECRUITER" ? recruiterRejectionKind(latestText) : "NONE";
    if (rejectionKind === "KNOWN_REASON" && lastOfferedJob?.company_name) {
      const rejected = Array.isArray(profileBase.rejected_companies)
        ? profileBase.rejected_companies.filter((value): value is string => typeof value === "string")
        : [];
      profileBase.rejected_companies = [...new Set([...rejected, lastOfferedJob.company_name])];
    }
    const rejectionOverride =
      String(bot.bot_type) === "RECRUITER"
        // First or second job offered (by how many were offered; the job data may not mark its sale stage).
        ? recruiterRejectionOverride({ text: latestText, lastSaleStage: offeredJobIds.length >= 2 ? "second_job" : offeredJobIds.length === 1 ? "first_job" : lastOfferedJob?.sale_stage })
        : null;
    const rejectedCompanies = new Set(
      (Array.isArray(profileBase.rejected_companies) ? profileBase.rejected_companies : [])
        .filter((value): value is string => typeof value === "string")
        .map(normalizedEvidence),
    );
    const validJobIds = new Set((jobs ?? []).map((job) => job.external_job_id));
    const eligibleJobIds = eligibleRecruiterJobIds(jobs ?? [], rejectedCompanies, profileBase.management_experience);
    let jobMatches = result.jobMatches
      .filter((match) => validJobIds.has(match.jobId) && eligibleJobIds.has(match.jobId))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(bot.max_jobs_to_offer, 3));
    const hasCoreProfile = missingIntroField(profileBase) === null;
    // Let the grounded model answer the candidate's request, rather than replacing
    // every reply with the next checklist question. Keep only the greeting guide.
    const guidedCollection =
      String(bot.bot_type) === "RECRUITER" && !rejectionOverride && !result.handoffRequested && !result.stopBot
        ? initialRecruiterOpening(contextMessages, profileBase)
        : null;
    const preferredPrimaryLocations = [
      ...(Array.isArray(profileBase.preferred_locations) ? profileBase.preferred_locations : []),
      profileBase.location,
    ]
      .filter((value): value is string => typeof value === "string")
      .map(normalizedMatchText)
      .filter(Boolean);
    const primaryJob =
      String(bot.bot_type) !== "RECRUITER" && offeredJobIds.length === 0 && hasCoreProfile
        ? (jobs ?? [])
            .filter(
              (job) =>
                job.sale_stage === "first_job" &&
                eligibleJobIds.has(job.external_job_id) &&
                preferredPrimaryLocations.some((location) => {
                  const jobLocation = normalizedMatchText(job.location);
                  return jobLocation.includes(location) || location.includes(jobLocation);
                }),
            )
            .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || a.external_job_id.localeCompare(b.external_job_id))[0]
        : null;
    let guidedPrimary: string | null = null;
    // Recruiter chatbot: the approved sample chat's fixed steps (core/recruiter-script.ts), unless the candidate asks
    // something else (process question, complaint, CV), which the model answers.
    const isRecruiter = String(bot.bot_type) === "RECRUITER";
    const scripted = isRecruiter && hasCoreProfile && !rejectionOverride && !result.handoffRequested && !result.stopBot &&
      !["process_question", "complaint", "cv_shared"].includes(result.intent);
    // Salary and start date are also read from the candidate's own words, so a step never depends on the model
    // having filed them as facts.
    const lastBotText = [...contextMessages].reverse().find((message) => message.role === "OUTBOUND")?.text ?? "";
    if (isRecruiter && lastOfferedJob) {
      const salary = supportedFacts.find((fact) => fact.fieldKey === "expected_salary")?.value ?? result.profileUpdates.expected_salary ?? salaryInText(latestText);
      if (typeof salary === "string" && salary.trim() && !supportedFacts.some((fact) => fact.fieldKey === "expected_salary")) {
        profileBase.expected_salary = salary.trim();
        supportedFacts.push({ fieldKey: "expected_salary", value: salary.trim(), confidence: "EXPLICIT", evidenceQuote: salary.trim() } as (typeof supportedFacts)[number]);
      }
      const start = startDateInText(latestText, lastBotText);
      if (start && !supportedFacts.some((fact) => fact.fieldKey === "availability")) {
        profileBase.availability = start;
        supportedFacts.push({ fieldKey: "availability", value: start, confidence: "EXPLICIT", evidenceQuote: start } as (typeof supportedFacts)[number]);
      }
    }
    const learnedNow = (key: string) => supportedFacts.some((fact) => fact.fieldKey === key);
    if (scripted && offeredJobIds.length === 0) {
      const job = nextScriptJob(profileBase, jobs ?? [], offeredJobIds, eligibleJobIds);
      if (job) {
        jobMatches = [{ jobId: job.external_job_id, score: 82, matchedReasons: [`Đúng định hướng ${String(profileBase.candidate_type ?? "")}`, `Đúng địa điểm ${String(job.location ?? "")}`], missingFields: [], riskFlags: [] }];
        guidedPrimary = jobIntroduction(job, profileBase);
      }
    }
    if (primaryJob) {
      jobMatches = [
        {
          jobId: primaryJob.external_job_id,
          score: 90,
          matchedReasons: ["Đủ hướng nghề nghiệp, địa điểm và năng lực tiếng Nhật"],
          missingFields: [],
          riskFlags: [],
        },
      ];
      const salary = primaryJob.salary_range ? `, range ${primaryJob.salary_range}` : "";
      guidedPrimary = `Em có vị trí ${primaryJob.job_title} của ${primaryJob.company_name}, làm việc ở ${primaryJob.location}${salary}. Anh xem hướng này có phù hợp với mình không nhé.`;
    }
    let guidedAlternative: string | null = null;
    // After the candidate said why the job does not fit: the next job (a second refusal stops the bot above).
    if (isRecruiter && hasCoreProfile && !rejectionOverride && rejectionKind === "KNOWN_REASON" && offeredJobIds.length === 1 && !result.handoffRequested && !result.stopBot) {
      const job = nextScriptJob(profileBase, jobs ?? [], offeredJobIds, eligibleJobIds);
      if (job) {
        jobMatches = [{ jobId: job.external_job_id, score: 78, matchedReasons: [`Đúng định hướng ${String(profileBase.candidate_type ?? "")}`, `Đúng địa điểm ${String(job.location ?? "")}`], missingFields: [], riskFlags: [] }];
        guidedAlternative = nextJobIntroduction(job);
      }
    }
    if (
      String(bot.bot_type) !== "RECRUITER" &&
      hasCoreProfile &&
      !rejectionOverride &&
      ["job_rejection", "job_interest", "answer"].includes(result.intent) &&
      jobMatches.length === 0
    ) {
      const preferredLocations = (Array.isArray(profileBase.preferred_locations) ? profileBase.preferred_locations : [])
        .filter((value): value is string => typeof value === "string")
        .map(normalizedMatchText)
        .filter(Boolean);
      const locationCandidates = [...preferredLocations.reverse(), normalizedMatchText(profileBase.location)].filter(Boolean);
      const candidateType = normalizedMatchText(profileBase.candidate_type);
      const alternative = (jobs ?? [])
        .filter(
          (job) =>
            eligibleJobIds.has(job.external_job_id) &&
            locationCandidates.some((location) => normalizedMatchText(job.location).includes(location)) &&
            (!candidateType || normalizedMatchText(`${job.job_title ?? ""} ${job.requirements ?? ""}`).includes(candidateType)),
        )
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))[0];
      if (alternative) {
        const needsManagement = isManagementRecruiterJob(alternative) && !profileBase.management_experience;
        jobMatches = [
          {
            jobId: alternative.external_job_id,
            score: needsManagement ? 72 : 82,
            matchedReasons: [
              `Đúng định hướng ${String(profileBase.candidate_type ?? "ứng viên")}`,
              `Đúng địa điểm ${String(alternative.location ?? profileBase.location ?? "")}`,
            ],
            missingFields: needsManagement ? ["management_experience"] : [],
            riskFlags: needsManagement ? ["Cần xác nhận kinh nghiệm quản lý dự án"] : [],
          },
        ];
        const salary =
          typeof alternative.salary_range === "string" && alternative.salary_range.trim()
            ? `, range ${alternative.salary_range.trim()}`
            : "";
        guidedAlternative = needsManagement
          ? `Em còn vị trí ${alternative.job_title} tại ${alternative.company_name} ở ${alternative.location}${salary}. Bên này cần kinh nghiệm quản lý dự án; anh chia sẻ giúp em phần này nhé.`
          : `Em còn vị trí ${alternative.job_title} tại ${alternative.company_name} ở ${alternative.location}${salary}. Anh xem hướng này có phù hợp với mình không nhé.`;
      }
    }
    // While the script runs, the model may talk about the job already offered but never brings in another one on its
    // own: the next job comes only after the candidate says why this one does not fit (above).
    if (scripted && lastOfferedJob && !guidedAlternative)
      jobMatches = jobMatches.filter((match) => match.jobId === lastOfferedJob.external_job_id);
    const learnedSalary =
      supportedFacts.some((fact) => fact.fieldKey === "expected_salary") || result.profileUpdates.expected_salary !== null;
    const selectedMatchJob = (jobs ?? []).find((job) => job.external_job_id === (jobMatches[0]?.jobId ?? result.selectedJobId));
    const guidedAvailability =
      String(bot.bot_type) !== "RECRUITER" && learnedSalary
        ? availabilityFollowup(profileBase.expected_salary, profileBase.availability, selectedMatchJob?.company_name)
        : scripted && lastOfferedJob && learnedNow("expected_salary") && !profileBase.availability
          ? salaryFollowup(profileBase.expected_salary, lastOfferedJob)
          : null;
    // Start date known (salary too) → the CV; experience told but no salary → the salary.
    const guidedCv = scripted && lastOfferedJob && learnedNow("availability") && profileBase.expected_salary && profileBase.cv_received !== true ? CV_REQUEST : null;
    const guidedSalary = scripted && lastOfferedJob && !profileBase.expected_salary && !learnedNow("expected_salary") &&
      ["brse_experience", "management_experience", "years_experience", "japanese_client_experience"].some(learnedNow) ? SALARY_QUESTION : null;
    const selectedJobId =
      guidedPrimary || guidedAlternative
        ? (jobMatches[0]?.jobId ?? null)
        : result.selectedJobId && validJobIds.has(result.selectedJobId) && jobMatches.some((match) => match.jobId === result.selectedJobId)
          ? result.selectedJobId
          : null;
    const replyParts = rejectionOverride
      ? [rejectionOverride.reply]
      : guidedPrimary
        ? [guidedPrimary]
        : guidedCollection
          ? [guidedCollection]
          : guidedAvailability
            ? [guidedAvailability]
            : guidedCv
              ? [guidedCv]
              : guidedSalary
                ? [guidedSalary]
            : guidedAlternative
              ? [guidedAlternative]
              : result.replyParts;
    const unsupportedOffer = (jobs ?? []).some(
      (job) => mentionsJob(replyParts.join(" "), job) && !jobMatches.some((match) => match.jobId === job.external_job_id),
    );
    const disclosureBlocked = String(bot.bot_type) === "RECRUITER" && !hasCoreProfile;
    // Collect the four introductory facts before offering even anonymous jobs.
    // Keep the approved opening and ground each subsequent question in known facts.
    const plannedIntro =
      disclosureBlocked && !rejectionOverride && !result.handoffRequested && !result.stopBot
        ? (guidedCollection ?? approvedIntroReply(profileBase, jobsForGeneration))
        : null;
    // Never send the same question twice in a row: if the candidate's answer was not understood, let the model's own
    // reply answer it (when it names no company, salary or JD), otherwise ask the missing point in other words.
    const lastOutbound = [...contextMessages].reverse().find((message) => message.role === "OUTBOUND")?.text ?? "";
    const sameAsLast = (text: string) => normalizedEvidence(withoutQuestionMarks(text)) === normalizedEvidence(withoutQuestionMarks(lastOutbound));
    const modelReply = result.replyParts.join("\n\n").trim();
    const introReply = plannedIntro && lastOutbound && sameAsLast(plannedIntro)
      ? (modelReply && !containsJobDisclosure(modelReply, jobs ?? []) && !sameAsLast(modelReply) ? modelReply : introductionQuestion(profileBase) ?? plannedIntro)
      : plannedIntro;
    // Mid-script, a reply that wandered to another job is replaced by the script's next question, not a generic one.
    const scriptNext = scripted && lastOfferedJob
      ? !profileBase.expected_salary ? SALARY_QUESTION
        : !profileBase.availability ? "Anh dự kiến có thể bắt đầu công việc mới từ thời điểm nào nhé."
        : profileBase.cv_received !== true ? CV_REQUEST : null
      : null;
    const gatedParts = introReply ? [introReply] : unsupportedOffer ? [scriptNext ?? clarificationReply(profileBase)] : replyParts;
    const shapedParts = (guidedCollection ? [guidedCollection] : shapeReply(gatedParts.map(humanizeRecruiterReply), run.id)).map(
      withoutQuestionMarks,
    );
    // The bot's first message to a candidate always greets (Recruiter chatbot).
    const safeReplyParts = String(bot.bot_type) === "RECRUITER" ? withFirstGreeting(shapedParts, contextMessages) : shapedParts;
    const verifiedResult = {
      ...result,
      ...(rejectionOverride
        ? {
            selectedJobId: null,
            jobMatches: [],
            replyParts: safeReplyParts,
            askedQuestion: !rejectionOverride.stopBot,
            stopBot: rejectionOverride.stopBot,
            handoffRequested: false,
            handoffReason: rejectionOverride.notification ?? "",
            conversationStatus: rejectionOverride.stopBot ? ("PAUSED" as const) : ("DISCUSSING_PROCESS" as const),
          }
        : {
            selectedJobId: unsupportedOffer ? null : selectedJobId,
            jobMatches: unsupportedOffer ? [] : jobMatches,
            replyParts: safeReplyParts,
          }),
      ...(disclosureBlocked
        ? {
            selectedJobId: null,
            jobMatches: [],
            ...(introReply
              ? {
                  askedQuestion: true,
                  conversationStatus: "COLLECTING_PROFILE" as const,
                  nextStage: `intro_${missingIntroField(profileBase)}`,
                }
              : {}),
          }
        : {}),
    };
    const profile = { ...profileBase, job_matches: verifiedResult.jobMatches };
    await db
      .from("ai_recruiter_runs")
      .update({
        status: "DRAFT_READY",
        output_json: verifiedResult,
        proposed_text_parts: safeReplyParts,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    const nextOfferedJobIds = verifiedResult.selectedJobId ? [...new Set([...offeredJobIds, verifiedResult.selectedJobId])] : offeredJobIds;
    await db
      .from("ai_recruiter_conversation_states")
      .update({
        status: verifiedResult.conversationStatus,
        current_stage: verifiedResult.nextStage,
        profile,
        offered_job_ids: nextOfferedJobIds,
        last_ai_run_id: run.id,
        bot_paused: verifiedResult.stopBot || verifiedResult.handoffRequested,
        pause_reason: verifiedResult.handoffReason || null,
        next_followup_at: verifiedResult.askedQuestion ? new Date(Date.now() + bot.reminder_1_minutes * 60000).toISOString() : null,
      })
      .eq("workspace_id", run.workspace_id)
      .eq("conversation_id", run.conversation_id);
    if (supportedFacts.length > 0)
      await db.from("ai_recruiter_candidate_facts").upsert(
        supportedFacts.map((fact) => ({
          workspace_id: run.workspace_id,
          bot_id: run.bot_id,
          conversation_id: run.conversation_id,
          field_key: fact.fieldKey,
          field_value: fact.value,
          confidence: fact.confidence,
          evidence_quote: fact.evidenceQuote,
          source_message_id:
            (messages ?? []).find(
              (message) =>
                message.direction === "INBOUND" &&
                normalizedEvidence(messageContext(message)).includes(normalizedEvidence(fact.evidenceQuote)),
            )?.id ?? run.inbound_message_id,
          source_run_id: run.id,
        })),
        { onConflict: "workspace_id,conversation_id,field_key" },
      );
    if (result.handoffRequested)
      await db
        .from("omnichannel_conversations")
        .update({ takeover_mode: "HUMAN_TAKEOVER" })
        .eq("workspace_id", run.workspace_id)
        .eq("id", run.conversation_id)
        .eq("takeover_mode", "BOT_ALLOWED");
    if (verifiedResult.askedQuestion && !verifiedResult.stopBot && !verifiedResult.handoffRequested)
      await db.from("ai_recruiter_scheduled_actions").insert({
        workspace_id: run.workspace_id,
        bot_id: run.bot_id,
        conversation_id: run.conversation_id,
        run_id: run.id,
        action_type: "REMINDER_1",
        due_at: new Date(Date.now() + bot.reminder_1_minutes * 60000).toISOString(),
        idempotency_key: `run:${run.id}:reminder:1`,
        payload: { stage: verifiedResult.nextStage },
      });
    const metadata =
      conversation.metadata && typeof conversation.metadata === "object" && !Array.isArray(conversation.metadata)
        ? conversation.metadata
        : {};
    const autoAuthorized =
      run.mode === "AUTO" && bot.mode === "AUTO" && String(metadata.aiRecruiterModeOverride ?? "").toUpperCase() === "AUTO";
    let autoCooldown = false;
    if (autoAuthorized) {
      const { data: recent } = await db
        .from("channel_outbound_actions")
        .select("id")
        .eq("workspace_id", run.workspace_id)
        .eq("conversation_id", run.conversation_id)
        .eq("dispatch_source", "AI_AUTOMATION")
        .eq("status", "SENT")
        .gte("updated_at", new Date(Date.now() - 20_000).toISOString())
        .limit(1)
        .maybeSingle();
      autoCooldown = Boolean(recent);
    }
    const terminalReply = Boolean(rejectionOverride?.stopBot);
    if (autoAuthorized && autoCooldown && !verifiedResult.handoffRequested && !verifiedResult.stopBot) {
      await db
        .from("ai_recruiter_runs")
        .update({ status: "QUEUED", safe_error_code: "AUTO_COOLDOWN", completed_at: null })
        .eq("id", run.id);
      return "QUEUED";
    }
    if (
      (run.mode === "DRAFT" || !autoAuthorized || autoCooldown) &&
      !verifiedResult.handoffRequested &&
      (!verifiedResult.stopBot || terminalReply)
    ) {
      for (const [index, part] of safeReplyParts.entries())
        await db.rpc("propose_ai_recruiter_draft_service", {
          p_workspace_id: run.workspace_id,
          p_run_id: run.id,
          p_text_content: part,
          p_part: index + 1,
        });
      if (autoCooldown) await db.from("ai_recruiter_runs").update({ safe_error_code: "AUTO_COOLDOWN" }).eq("id", run.id);
    }
    if (autoAuthorized && !autoCooldown && !verifiedResult.handoffRequested && (!verifiedResult.stopBot || terminalReply)) {
      let sent = true;
      for (const [index, part] of safeReplyParts.entries()) {
        const proposed = await db.rpc("propose_ai_recruiter_message_service", {
          p_workspace_id: run.workspace_id,
          p_run_id: run.id,
          p_text_content: part,
          p_part: index + 1,
        });
        if (proposed.error || typeof proposed.data !== "string") {
          sent = false;
          break;
        }
        const loaded = await loadChannelAdapterByAccountId(conversation.channel_account_id),
          registry = new ChannelAdapterRegistry();
        registry.register(loaded.adapter);
        const dispatched = await executeChannelOutboundAction(proposed.data, registry);
        if (dispatched.status !== "SENT") {
          sent = false;
          break;
        }
      }
      await db
        .from("ai_recruiter_runs")
        .update({ status: sent ? "SENT" : "QUEUED" })
        .eq("id", run.id);
      return sent ? "SENT" : "QUEUED";
    }
    return "DRAFT_READY";
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "AI_RECRUITER_FAILED";
    if (code !== "BOT_NOT_ELIGIBLE" && aiAttempt < 2) {
      await db
        .from("ai_recruiter_runs")
        .update({
          status: "PENDING",
          safe_error_code: code,
          input_snapshot: { aiAttempt: aiAttempt + 1 },
          started_at: null,
          completed_at: null,
        })
        .eq("id", run.id);
      return "RETRY_QUEUED";
    }
    if (code !== "BOT_NOT_ELIGIBLE" && (await sendGenerationFallback(run, code).catch(() => false))) return "SENT";
    await db
      .from("ai_recruiter_runs")
      .update({ status: code === "BOT_NOT_ELIGIBLE" ? "SKIPPED" : "FAILED", safe_error_code: code, completed_at: new Date().toISOString() })
      .eq("id", run.id);
    return "FAILED";
  }
}

export async function processPendingAiRecruiterRuns(limit = 10) {
  const db = createPrivilegedClient(),
    { data, error } = await db
      .from("ai_recruiter_runs")
      .select("id,workspace_id,bot_id,conversation_id,inbound_message_id,mode,input_snapshot")
      .eq("status", "PENDING")
      .order("created_at")
      .limit(Math.min(Math.max(limit, 1), 25));
  if (error) return { processed: 0, failed: 0 };
  let processed = 0,
    failed = 0;
  for (const run of data ?? []) {
    const result = await processRun(run);
    processed += 1;
    if (result === "FAILED") failed += 1;
  }
  return { processed, failed };
}

export async function resumeQueuedAiRecruiterRuns(limit = 10, runId?: string) {
  const db = createPrivilegedClient();
  let query = db
    .from("ai_recruiter_runs")
    .select("id,workspace_id,bot_id,conversation_id,inbound_message_id,mode,proposed_text_parts")
    .eq("status", "QUEUED")
    .eq("mode", "AUTO")
    .order("created_at")
    .limit(Math.min(Math.max(limit, 1), 25));
  if (runId) query = query.eq("id", runId);
  const { data, error } = await query;
  if (error) return { processed: 0, sent: 0 };
  let processed = 0,
    sent = 0;
  for (const run of data ?? []) {
    const claimed = await db
      .from("ai_recruiter_runs")
      .update({ status: "RUNNING" })
      .eq("id", run.id)
      .eq("status", "QUEUED")
      .select("id")
      .maybeSingle();
    if (!claimed.data) continue;
    processed += 1;
    const [stateResult, conversationResult, actionsResult, botResult] = await Promise.all([
      db
        .from("ai_recruiter_conversation_states")
        .select("last_inbound_message_id,bot_paused")
        .eq("workspace_id", run.workspace_id)
        .eq("conversation_id", run.conversation_id)
        .maybeSingle(),
      db
        .from("omnichannel_conversations")
        .select("channel_account_id,status,takeover_mode,metadata")
        .eq("workspace_id", run.workspace_id)
        .eq("id", run.conversation_id)
        .maybeSingle(),
      db
        .from("channel_outbound_actions")
        .select("id,status,idempotency_key,updated_at,safe_error_code")
        .eq("workspace_id", run.workspace_id)
        .eq("conversation_id", run.conversation_id)
        .like("idempotency_key", `ai-recruiter:${run.id}:part:%`)
        .order("updated_at", { ascending: false }),
      db.from("ai_recruiter_bots").select("enabled,mode").eq("workspace_id", run.workspace_id).eq("id", run.bot_id).maybeSingle(),
    ]);
    if ([stateResult, conversationResult, actionsResult, botResult].some((result) => result.error)) {
      await db
        .from("ai_recruiter_runs")
        .update({ status: "QUEUED", safe_error_code: "RESUME_READ_FAILED" })
        .eq("id", run.id)
        .eq("status", "RUNNING");
      continue;
    }
    const state = stateResult.data,
      conversation = conversationResult.data,
      actions = actionsResult.data,
      bot = botResult.data;
    const metadata = object(conversation?.metadata) ? conversation.metadata : {};
    if (!bot?.enabled || bot.mode !== "AUTO" || metadata.aiRecruiterModeOverride !== "AUTO") {
      await db
        .from("ai_recruiter_runs")
        .update({ status: "DRAFT_READY", safe_error_code: "AUTO_NOT_AUTHORIZED" })
        .eq("id", run.id)
        .eq("status", "RUNNING");
      continue;
    }
    if (
      !state ||
      state.bot_paused ||
      state.last_inbound_message_id !== run.inbound_message_id ||
      !conversation ||
      conversation.takeover_mode !== "BOT_ALLOWED" ||
      !["OPEN", "PENDING"].includes(conversation.status)
    ) {
      await db
        .from("ai_recruiter_runs")
        .update({ status: "SKIPPED", safe_error_code: "SUPERSEDED_OR_PAUSED", completed_at: new Date().toISOString() })
        .eq("id", run.id)
        .eq("status", "RUNNING");
      continue;
    }
    const latestSent = (actions ?? []).find((action) => action.status === "SENT");
    if (latestSent && Date.now() - Date.parse(latestSent.updated_at) < 65_000) {
      await db.from("ai_recruiter_runs").update({ status: "QUEUED" }).eq("id", run.id).eq("status", "RUNNING");
      continue;
    }
    const { data: recentSend, error: recentError } = await db
      .from("channel_outbound_actions")
      .select("id")
      .eq("workspace_id", run.workspace_id)
      .eq("conversation_id", run.conversation_id)
      .eq("dispatch_source", "AI_AUTOMATION")
      .eq("status", "SENT")
      .gte("updated_at", new Date(Date.now() - 20_000).toISOString())
      .limit(1)
      .maybeSingle();
    if (recentError || recentSend) {
      await db.from("ai_recruiter_runs").update({ status: "QUEUED" }).eq("id", run.id).eq("status", "RUNNING");
      continue;
    }
    const parts = Array.isArray(run.proposed_text_parts)
      ? run.proposed_text_parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      : [];
    let nextIndex = -1;
    for (let index = 0; index < parts.length; index++) {
      const base = `ai-recruiter:${run.id}:part:${index + 1}`;
      const related = (actions ?? []).filter(
        (action) =>
          typeof action.idempotency_key === "string" &&
          (action.idempotency_key === base || action.idempotency_key.startsWith(`${base}:retry:`)),
      );
      if (related.some((action) => action.status === "SENT")) continue;
      if (related.some((action) => action.status === "DELIVERY_UNKNOWN")) {
        nextIndex = -2;
        break;
      }
      if (related.length === 0) {
        nextIndex = index;
        break;
      }
      nextIndex = -2;
      break;
    }
    if (nextIndex === -1) {
      await db
        .from("ai_recruiter_runs")
        .update({ status: "SENT", safe_error_code: null, completed_at: new Date().toISOString() })
        .eq("id", run.id)
        .eq("status", "RUNNING");
      sent += 1;
      continue;
    }
    if (nextIndex < 0) {
      await db.from("ai_recruiter_runs").update({ status: "QUEUED" }).eq("id", run.id).eq("status", "RUNNING");
      continue;
    }
    const proposed = await db.rpc("propose_ai_recruiter_message_service", {
      p_workspace_id: run.workspace_id,
      p_run_id: run.id,
      p_text_content: parts[nextIndex],
      p_part: nextIndex + 1,
    });
    if (proposed.error || typeof proposed.data !== "string") {
      await db.from("ai_recruiter_runs").update({ status: "QUEUED" }).eq("id", run.id).eq("status", "RUNNING");
      continue;
    }
    try {
      const loaded = await loadChannelAdapterByAccountId(conversation.channel_account_id),
        registry = new ChannelAdapterRegistry();
      registry.register(loaded.adapter);
      const dispatched = await executeChannelOutboundAction(proposed.data, registry);
      await db
        .from("ai_recruiter_runs")
        .update({
          status: dispatched.status === "SENT" && nextIndex === parts.length - 1 ? "SENT" : "QUEUED",
          safe_error_code: dispatched.status === "FAILED" ? dispatched.safeErrorCode : null,
          completed_at: dispatched.status === "SENT" && nextIndex === parts.length - 1 ? new Date().toISOString() : null,
        })
        .eq("id", run.id)
        .eq("status", "RUNNING");
      if (dispatched.status === "SENT") sent += 1;
    } catch {
      await db
        .from("ai_recruiter_runs")
        .update({ status: "QUEUED", safe_error_code: "DISPATCH_UNAVAILABLE" })
        .eq("id", run.id)
        .eq("status", "RUNNING");
    }
  }
  return { processed, sent };
}
