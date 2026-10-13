// Structured output contract between the AI Recruiter model call and the deterministic policy code.
// resultSchema validates what the model returns; recruiterResultJsonSchema is the strict JSON schema
// sent to OpenAI. Keep the two in step.
import { z } from "zod";

export const factKeys = [
  "candidate_type",
  "current_role",
  "seniority",
  "primary_skills",
  "years_experience",
  "current_company",
  "location",
  "preferred_locations",
  "work_preference",
  "japanese_level",
  "english_level",
  "japan_years",
  "current_salary",
  "expected_salary",
  "availability",
  "motivation",
  "job_priorities",
  "applied_companies",
  "rejected_companies",
  "management_experience",
  "brse_experience",
  "japanese_client_experience",
  "email",
  "phone",
  "cv_received",
] as const;
const jobMatchSchema = z.object({
  jobId: z.string().max(160),
  score: z.number().int().min(0).max(100),
  matchedReasons: z.array(z.string().max(300)).max(5),
  missingFields: z.array(z.string().max(120)).max(8),
  riskFlags: z.array(z.string().max(300)).max(5),
});
export const resultSchema = z.object({
  intent: z.enum([
    "greeting",
    "answer",
    "job_interest",
    "job_rejection",
    "salary_question",
    "process_question",
    "cv_shared",
    "complaint",
    "other",
  ]),
  profileUpdates: z.object({
    candidate_type: z.string().max(120).nullable(),
    location: z.string().max(200).nullable(),
    japanese_level: z.string().max(50).nullable(),
    japan_years: z.number().min(0).max(80).nullable(),
    expected_salary: z.string().max(120).nullable(),
    cv_received: z.boolean().nullable(),
  }),
  replyParts: z.array(z.string().trim().min(1).max(2000)).min(1).max(3),
  nextStage: z.string().max(160).nullable(),
  conversationStatus: z.enum([
    "COLLECTING_PROFILE",
    "PROFILE_COMPLETE",
    "OFFERING_JOB",
    "DISCUSSING_PROCESS",
    "WAITING_RECRUITER",
    "COMPLETED",
    "PAUSED",
  ]),
  askedQuestion: z.boolean(),
  handoffRequested: z.boolean(),
  handoffReason: z.string().max(500),
  stopBot: z.boolean(),
  selectedJobId: z.string().max(160).nullable(),
  jobMatches: z.array(jobMatchSchema).max(3),
  facts: z
    .array(
      z.object({
        fieldKey: z.enum(factKeys),
        value: z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(300)).max(30)]),
        confidence: z.enum(["EXPLICIT", "STRONG_INFERENCE"]),
        evidenceQuote: z.string().trim().min(1).max(1000),
      }),
    )
    .max(20),
});

export type RecruiterResult = z.infer<typeof resultSchema>;

export const recruiterResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "profileUpdates",
    "replyParts",
    "nextStage",
    "conversationStatus",
    "askedQuestion",
    "handoffRequested",
    "handoffReason",
    "stopBot",
    "selectedJobId",
    "jobMatches",
    "facts",
  ],
  properties: {
    intent: {
      type: "string",
      enum: [
        "greeting",
        "answer",
        "job_interest",
        "job_rejection",
        "salary_question",
        "process_question",
        "cv_shared",
        "complaint",
        "other",
      ],
    },
    profileUpdates: {
      type: "object",
      additionalProperties: false,
      required: ["candidate_type", "location", "japanese_level", "japan_years", "expected_salary", "cv_received"],
      properties: {
        candidate_type: { type: ["string", "null"] },
        location: { type: ["string", "null"] },
        japanese_level: { type: ["string", "null"] },
        japan_years: { type: ["number", "null"] },
        expected_salary: { type: ["string", "null"] },
        cv_received: { type: ["boolean", "null"] },
      },
    },
    replyParts: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    nextStage: { type: ["string", "null"] },
    conversationStatus: {
      type: "string",
      enum: ["COLLECTING_PROFILE", "PROFILE_COMPLETE", "OFFERING_JOB", "DISCUSSING_PROCESS", "WAITING_RECRUITER", "COMPLETED", "PAUSED"],
    },
    askedQuestion: { type: "boolean" },
    handoffRequested: { type: "boolean" },
    handoffReason: { type: "string" },
    stopBot: { type: "boolean" },
    selectedJobId: { type: ["string", "null"] },
    jobMatches: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["jobId", "score", "matchedReasons", "missingFields", "riskFlags"],
        properties: {
          jobId: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          matchedReasons: { type: "array", maxItems: 5, items: { type: "string" } },
          missingFields: { type: "array", maxItems: 8, items: { type: "string" } },
          riskFlags: { type: "array", maxItems: 5, items: { type: "string" } },
        },
      },
    },
    facts: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fieldKey", "value", "confidence", "evidenceQuote"],
        properties: {
          fieldKey: { type: "string", enum: factKeys },
          value: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "array", items: { type: "string" }, maxItems: 30 },
            ],
          },
          confidence: { type: "string", enum: ["EXPLICIT", "STRONG_INFERENCE"] },
          evidenceQuote: { type: "string" },
        },
      },
    },
  },
};
