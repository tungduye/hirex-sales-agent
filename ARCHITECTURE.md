# HireX Sales Agent Platform — Architecture

## 1. Scope and architectural goals

This document began as the Phase 0 target architecture and was revised in October 2026 to match the running system. Where the implementation still differs from the target, both are stated (see §2.1, §6 and §8).

Operating modes:

| Mode | Who sends | Where it applies |
| --- | --- | --- |
| `MANUAL` | A human writes and sends | Everywhere |
| `AI_ASSIST` (`DRAFT`) | AI drafts; a human approves each send | Inbox reply suggestions, AI Recruiter draft mode |
| `AUTO` | AI sends without per-message approval, inside the gates in §4.1 | **AI Recruiter conversations only** |

`AUTO` for AI Recruiter is an approved product capability, not an experiment. The product direction is for AUTO to become the only AI Recruiter mode once the readiness criteria in §4.3 are met. AUTO does not extend to campaigns, Gmail replies or any other module; widening it requires a separate decision.

Core invariants:

- `Contact` is the canonical person. Channel-specific identities belong to `ContactChannel`; never create models such as `email_customer` or `zalo_customer`.
- A contact may have many channel identities, and a workspace may connect many accounts for the same channel type.
- AI reasoning is independent from delivery channels.
- AI never calls Gmail, Facebook, WhatsApp, Zalo, or Viber APIs directly and never receives provider credentials. Its output becomes a durable `channel_outbound_actions` row that is executed by the channel executor, in AUTO as in every other mode.
- Every outbound side effect, including AUTO sends, passes through authorization, policy, validation, idempotency, and audit boundaries.
- A human can always stop AI for one conversation (takeover), one bot (disable or switch to DRAFT), or globally (stop the AI Recruiter worker).
- PostgreSQL migrations are the only way to change the database schema.
- Secrets are injected through environment variables or a managed secret store and are never committed.

## 2. System architecture

```text
Browser
  -> Next.js App Router (UI, Route Handlers, Server Actions)
       -> Authentication + workspace authorization
       -> Application services / use cases
            -> Domain modules
            -> PostgreSQL (Supabase)
            -> Job dispatcher -> Redis/BullMQ -> Workers
                                      |-> AI orchestration -> OpenAI API
                                      |-> Action execution service
                                             -> Policy engine
                                             -> Channel adapter registry
                                                  |-> Gmail adapter
                                                  |-> future channel adapters
       <- Provider webhooks -> verified ingress -> normalized events/messages

Cross-cutting: audit log, observability, encryption, idempotency, rate limits
```

The Next.js application is the control plane and user-facing web application. Long-running, retryable, scheduled, provider-facing, and AI workloads run in separate workers. The web and worker processes share domain contracts and application services but have separate entry points and deployment units.

### 2.1 Current runtime (October 2026)

The diagram above is the target. Production today is a single Windows host:

```text
Windows host (127.0.0.1:3000, published as app.hirexmkt.online)
  npm run start -> scripts/start-production.mjs
     |-> next start                         web UI, Server Actions, webhooks, /api/internal/*
     |-> facebook-page-reconciler.mjs       polls Graph API every 30s, replays missed messages
     |                                      into /api/webhooks/facebook (per-page backoff)
     |-> ai-recruiter-worker.mjs            POST /api/internal/ai-recruiter/process every 5s
  Windows Task Scheduler
     |-> Gmail incremental sync (5 min), email campaign scheduler (1 min),
     |   channel campaign scheduler, Deplao (Zalo) supervisor, Facebook profile bridge
  runtime/                                   local state: locks, scheduler logs, bridge state,
                                             encrypted Human document snapshots
Supabase (Postgres + Auth + RLS)             system of record
OpenAI Responses API                         called with fetch from server code only
```

Consequences of this topology:

- There is no Redis/BullMQ. Work queues are Postgres tables (`ai_recruiter_runs`, `channel_outbound_actions`, campaign recipient rows) claimed with conditional updates; schedulers are Windows tasks calling bearer-protected internal endpoints.
- Rate limits for Human documents Q&A and the AI Recruiter cooldown are in-process or per-row, which is only correct with one host.
- The host is a single point of failure, and `runtime/` plus the encryption keys must be backed up separately.
- Deployments swap build directories (`.next` ↔ `.next-<release>`); the previous build is kept as `.next-before-<release>` for rollback (`scripts/deploy-recruiter-tone.ps1`).

## 3. Module boundaries

| Module | Owns | Must not own |
| --- | --- | --- |
| Identity & tenancy | Supabase Auth integration, users, workspaces, membership and authorization | CRM or provider credentials |
| CRM | companies, contacts, contact channels, tasks, opportunities | Message delivery or AI execution |
| Conversations | canonical conversations and normalized messages | Provider-specific API logic |
| Channel accounts | connected account lifecycle and encrypted credential references | AI decisions |
| Channel connectors | provider adapters, webhook parsing, send/fetch operations | Business policy or prompt logic |
| Campaigns & sequences | audience, schedules, enrollment and step progression | Direct provider calls |
| Agent | runs, context assembly, model invocation, structured proposed actions | Direct side effects |
| Action policy & execution | action validation, approval, suppression, consent, rate limits, idempotent dispatch | Free-form AI reasoning |
| Jobs | queues, schedules, retries, dead-letter handling | Domain truth |
| Audit & observability | immutable event trail, correlation IDs, metrics and alerts | Operational decisions |

Modules communicate through typed application contracts and domain events. Provider payloads are translated at the connector boundary and are not allowed to leak into the core domain.

## 4. AI action boundary

An agent run reads an authorized, minimal context snapshot and produces structured output conforming to a versioned schema. Its output is persisted as one or more `agent_actions`, not executed inline.

```text
Trigger -> AgentRun -> proposed AgentAction
                        -> schema validation
                        -> authorization + policy evaluation
                        -> approval gate
                           MANUAL: human authors and sends
                           AI_ASSIST: AI may draft; human approves side effects
                        -> idempotent job
                        -> application service
                        -> channel adapter
                        -> provider
                        -> result + audit log
```

Initial action types should be narrow and explicit, for example `DRAFT_MESSAGE`, `CLASSIFY_INTENT`, `SUGGEST_TASK`, and later `REQUEST_SEND_MESSAGE`. Each action records model/prompt versions, input references, structured output, status, policy result, approver, execution reference, and error metadata.

Rules:

- The model receives no provider access token or database service credential.
- Tool access is allowlisted by use case and workspace policy.
- All model output is untrusted input and must be schema-validated.
- The executor re-loads current state before acting; it does not trust stale agent context.
- An approval cannot bypass suppression, authorization, consent, or channel-account health checks.
- Every run and action uses correlation IDs and supports replay-safe idempotency.

In the implemented AI Recruiter, the "approval gate" has a third branch:

```text
inbound message -> ai_recruiter_runs (PENDING, mode DRAFT|AUTO)
  -> worker claims run -> context + OpenAI (strict JSON schema) -> Zod validation
  -> deterministic policy rewrites (disclosure gate, job eligibility, rejection rules)
  -> DRAFT: propose_ai_recruiter_draft_service   -> human approves in Inbox -> executor
  -> AUTO:  propose_ai_recruiter_message_service -> APPROVED channel_outbound_action
            (dispatch_source = AI_AUTOMATION)    -> executeChannelOutboundAction -> adapter
  -> handoff/stop: conversation set to HUMAN_TAKEOVER or bot paused; nothing is sent
```

### 4.1 AUTO gates (as implemented)

A reply is sent automatically only if every check below passes. Any failure falls back to a draft or to no reply.

| Stage | Check | Code |
| --- | --- | --- |
| Enqueue | Bot bound to this channel account and enabled; message is inbound and newer than the binding; conversation is not a group, is `OPEN`/`PENDING`, `BOT_ALLOWED`, and the bot is not paused | `enqueue-ai-recruiter.ts` |
| Enqueue | Run mode is `AUTO` only when **both** the bot mode and the conversation override (`metadata.aiRecruiterModeOverride`) are `AUTO`; anything missing or unknown means `DRAFT` | `enqueue-ai-recruiter.ts` |
| Processing | 8-second debounce so a burst of candidate messages gets one reply; a newer inbound message supersedes the run | `process-ai-recruiter.ts` |
| Generation | OpenAI Responses with strict JSON schema, `store: false`, 45 s timeout, input capped at 90k characters; output re-validated with Zod | `process-ai-recruiter.ts` |
| Grounding | Candidate facts are stored only with a verbatim evidence quote from the candidate; `cv_received` requires a real CV attachment; offered jobs must exist, be active and pass eligibility (rejected companies, management experience); replies naming an unoffered company are replaced with a clarification question | `process-ai-recruiter.ts`, `ai-recruiter-job-policy.ts` |
| Disclosure | RECRUITER bot offers no job until the four intro facts (role, location, Japanese level, years in Japan) are known | `profile-disclosure-gate.ts` |
| Escalation | Model `handoffRequested` switches the conversation to `HUMAN_TAKEOVER`; `stopBot` pauses the bot; neither sends an AI reply | `process-ai-recruiter.ts` |
| Pacing | At most one AI send per conversation per 20 seconds; otherwise the run is `QUEUED` and resumed later | `process-ai-recruiter.ts` |
| Database | `propose_ai_recruiter_message_service` (service role only) re-checks run, bot, binding, conversation state, recipient (= latest inbound sender) and channel suppression, writes a 10-minute `channel_policy_decisions` row and an idempotent action keyed `ai-recruiter:<run>:part:<n>` | migrations `049`, `052` |
| Delivery | The shared executor applies account health, Zalo send slots and busy-defer, Facebook response window, and never retries an unknown delivery automatically | `execute-channel-outbound-action.ts` |
| Failure | Generation is retried twice; after that a deterministic template reply (no model text) is sent in AUTO | `sendGenerationFallback` |

Who can switch AUTO on: only workspace admins (`requireWorkspaceAdmin`), per bot and per conversation, at `/settings/ai-recruiter` and in the Inbox conversation view. From migration 069 every switch is written to `audit_logs` (`AI_RECRUITER_BOT_MODE_CHANGED`, `AI_RECRUITER_CONVERSATION_MODE_CHANGED`) with the admin as actor; changes made outside the app are logged with a null actor.

### 4.2 Known gaps in the AUTO path

These are differences between the intended rules and the code as of migration 068. Gaps 1–3 are fixed by migration `069_ai_recruiter_auto_gates.sql` together with the matching application change (deploy with `scripts/deploy-recruiter-tone.ps1 -MigrateDatabase`); gaps 4–5 remain open:

1. **[Fixed in 069] Database gate is weaker than the application gate.** Migration `052` lets `propose_ai_recruiter_message_service` proceed when the bot **or** the conversation is `AUTO`, while the TypeScript requires both. The SQL function should require both, so the last line of defence is at least as strict as the first.
2. **[Fixed in 069] Audit attribution.** AUTO actions set `approved_by` to the bot creator, so an AI send looks like a human approval. AUTO actions should carry no human approver (identify them by `dispatch_source = AI_AUTOMATION`).
3. **[Fixed in 069] Mode changes are not audited.** Switching a bot or a conversation to AUTO overwrites the setting without an `audit_logs` entry recording who did it and when.
4. **No volume ceiling.** There is a per-conversation cooldown, but no per-bot or per-channel-account hourly/daily cap and no workspace-level kill switch checked inside the database function.
5. **Fallback sends without a model.** After repeated generation failures a template reply is sent automatically. This is deliberate, but it should be visible as its own metric so a provider outage is noticed.

### 4.3 Readiness criteria before AUTO becomes the only mode

DRAFT is kept as a safety net until all of the following hold:

- The gaps in §4.2 are closed.
- A regression set of anonymised real conversations is replayed against every prompt, model or policy change before deployment, with pass/fail review.
- Daily metrics exist for AUTO sends, handoff rate, fallback rate, bot-stop rate and candidate complaints, with an alert on sudden changes.
- A workspace kill switch and per-bot send caps are enforced in the database function.

When DRAFT is removed, the per-conversation override becomes an opt-out (AUTO by default, an admin can switch one conversation off) instead of an opt-in. Human takeover remains available on every conversation.

## 5. Channel adapter architecture

The core uses a channel-neutral interface and normalized message model:

```ts
interface ChannelAdapter {
  validateWebhook(input: WebhookInput): Promise<VerifiedWebhook>;
  normalizeInbound(input: VerifiedWebhook): Promise<InboundEvent[]>;
  sendMessage(command: SendMessageCommand): Promise<SendResult>;
  syncHistory?(command: SyncHistoryCommand): Promise<SyncResult>;
  refreshConnection?(accountId: string): Promise<ConnectionResult>;
}
```

`SendMessageCommand` contains internal IDs, normalized recipients/content, an idempotency key, and policy evidence. It contains no AI prompt data. An adapter registry selects an implementation by channel type and account capability. Each adapter translates canonical commands to provider requests and provider events to canonical messages/events.

Provider-specific identifiers and metadata live in `channel_accounts`, `contact_channels`, `messages.provider_message_id`, and constrained JSON metadata. Gmail-specific mailbox settings extend `channel_accounts` through `email_accounts`; this does not change the canonical contact or conversation model.

Webhook ingress must verify signatures/state, store a deduplication key, acknowledge quickly, and enqueue normalization. Outbound delivery must be idempotent and handle provider rate limits, token refresh, retry classification, and account suspension without embedding those concerns in CRM or Agent modules.

### 5.1 Implemented adapters and their provider status

| Adapter | Transport | Provider status |
| --- | --- | --- |
| Gmail | Official Gmail API, OAuth | Official |
| Facebook Page | Official Graph API, signed webhooks, plus a polling reconciler for missed events | Official; Page messaging is limited to Meta's response window |
| Facebook profile | Local browser-automation bridge (`scripts/facebook-profile-bridge.mjs`) driving personal accounts | **Unofficial**; not covered by Meta's platform terms |
| Zalo | Local Deplao bridge (`scripts/deplao-realtime-supervisor.mjs`) using Zalo user accounts logged in to Deplao, not the Zalo Official Account API | **Unofficial**; not the Zalo Official Account API |

The two unofficial adapters sit behind the same contracts, policy and pacing as the official ones (shared send slots, busy-defer, per-account pacing in `059`, `064`–`066`). They still carry provider-side risk the code cannot remove: accounts can be restricted or banned, and bulk or automated messaging from personal accounts may breach provider terms. Campaign volume and AUTO replies on these channels should be sized with that risk in mind.

## 6. Background jobs

> **Current state:** Redis/BullMQ is not deployed. Queues are Postgres tables with conditional-update claims, driven by the two long-running Node workers and the Windows scheduled tasks described in §2.1. The design below remains the target if HireX moves beyond one host.

Redis and BullMQ provide transport and scheduling; PostgreSQL remains the system of record. Proposed queues:

- `channel.ingest`: normalize verified inbound events and deduplicate messages.
- `channel.sync`: incremental mailbox/channel synchronization.
- `message.send`: execute approved outbound commands through adapters.
- `agent.run`: assemble context and invoke approved AI workflows.
- `sequence.schedule`: evaluate due enrollments and create step jobs.
- `tracking.process`: normalize delivery/open/click/reply events.
- `maintenance`: token refresh, reconciliation, retention, and cleanup.

Every job includes `workspace_id`, correlation ID, schema version, idempotency key, attempt metadata, and a reference to durable database state rather than sensitive payloads. Workers use bounded exponential backoff with jitter, distinguish retryable from terminal failures, and send exhausted jobs to a dead-letter path with alerts. Database transitions and job dispatch should use an outbox/reconciliation strategy to avoid lost work.

The Gmail incremental runner is reusable by both manual controls and a server-only internal scheduler endpoint. The endpoint uses a dedicated bearer secret, bounded account/page processing, and the database lease as its concurrency boundary. It is driven every five minutes by the `HireX Gmail Incremental Sync` Windows task (`docs/WINDOWS_SCHEDULER.md`).

Phase 2B.1 prepares a server-controlled Gmail send-request schema. Phase 2B.2 explicit `gmail.send` consent is live-tested without damaging readonly sync. Phase 2B.3A has a controlled live-send PASS with durable idempotency, conditional execution claim, and fail-safe ambiguous-delivery locking. Gmail replaced the requested MIME Message-ID. Phase 2B.3B persists the internal custom-header candidate, and Phase 2B.3C verified its preservation in one controlled send plus History sync. This is not a universal provider guarantee or standalone proof: any future reconciliation requires independent workspace, account, request, Gmail `SENT`, sender, recipient, message-metadata, and provider-ID checks. Ambiguous sends remain locked without reconciliation or retry. Phase 2B.4 will add server-derived reply/thread sending.

## 7. Security

- Enforce workspace isolation in application authorization and PostgreSQL Row Level Security. Every tenant-owned record carries `workspace_id` directly or has an unambiguous tenant path.
- Treat Server Actions and Route Handlers as public mutation boundaries: authenticate, authorize, validate input, rate-limit, and audit each operation.
- Use least-privilege OAuth scopes. Store access/refresh tokens encrypted at rest or as references to a managed secret store; never expose them to browser or model context.
- Keep server-only secrets in environment variables. Commit only a documented `.env.example` with placeholders when implementation begins; never commit `.env*` containing secrets.
- Verify OAuth `state`/PKCE and webhook signatures. Protect against replay with timestamps, nonces, and unique provider event IDs.
- Encrypt sensitive fields, use TLS, rotate credentials, redact logs, and minimize retained message/model content.
- Apply prompt-injection defenses: separate trusted instructions from channel content, label untrusted content, use constrained tools, and require policy checks after inference.
- Record append-oriented audit events for authentication, data access of concern, configuration changes, approvals, sends, imports/exports, and credential lifecycle operations.
- Define retention and deletion policies per workspace and provider obligations. Backups require encryption and restore tests.

## 8. Proposed folder structure

> **Current state:** the code follows the `modules/<area>/{components,core,domain,server,types}` pattern rather than the separate `server/` and `workers/` trees below. Implemented modules: `access`, `ai-recruiter`, `campaigns`, `channels` (adapters: `facebook`, `facebook-profile`, `zalo`), `crm`, `cv-scan`, `human-documents`, `identity`, `inbox`, `integrations/gmail`, `integrations/n8n`, `website-scan`. Long-running workers live in `scripts/`. WhatsApp and Viber adapters do not exist yet.

This structure follows the installed Next.js 16 App Router conventions while keeping domain and worker code outside routing concerns:

```text
src/
  app/
    (auth)/
    (dashboard)/
    api/
      webhooks/[provider]/route.ts
      oauth/[provider]/route.ts
    layout.tsx
  components/
    ui/                       # shadcn/ui primitives
    shared/
  modules/
    identity/
    crm/
    conversations/
    channels/
      core/
      adapters/gmail/
      adapters/facebook/
      adapters/whatsapp/
      adapters/zalo/
      adapters/viber/
    campaigns/
    sequences/
    agent/
    actions/
    audit/
  server/
    auth/
    db/
    jobs/
    policy/
    observability/
  workers/
    main.ts
  lib/
    validation/
    errors/
    ids/
supabase/
  migrations/
  seed.sql                     # development-only, no secrets
tests/
  unit/
  integration/
  contract/
  e2e/
```

Route files remain thin transport adapters. Business mutations live in application services, and database access is centralized in a server-only data access layer.

## 9. Proposed dependencies

These were the Phase 0 recommendations. **Adopted:** Tailwind CSS, Radix, Zod, `@supabase/supabase-js` + `@supabase/ssr`, Supabase CLI, `google-auth-library`, Playwright. **Not adopted (yet):** BullMQ/Redis, the OpenAI SDK (OpenAI is called with `fetch` in several modules), Pino, OpenTelemetry/Sentry, Vitest (unit tests use `node:test`).

| Concern | Proposed choice | Notes |
| --- | --- | --- |
| UI | Tailwind CSS, shadcn/ui, Radix primitives | Accessible, composable UI |
| Validation/contracts | Zod | Validate request, job, webhook, and AI output schemas |
| Database/auth | `@supabase/supabase-js`, `@supabase/ssr` | PostgreSQL, Auth, SSR session integration |
| Migrations/local DB | Supabase CLI | Versioned SQL migrations |
| Queue | BullMQ, `ioredis` | Separate worker deployment; Redis transport only |
| AI | Official OpenAI JavaScript SDK | Structured Outputs; server/worker only |
| Gmail | `googleapis` or focused Google Auth/Gmail clients | OAuth and Gmail adapter only |
| Logging | Pino | Structured logs with mandatory redaction |
| Tracing/errors | OpenTelemetry, Sentry-compatible exporter | Correlate web, jobs, agent runs, provider calls |
| Testing | Vitest, Testing Library, Playwright | Unit, integration, contract, and end-to-end tests |
| Utilities | `date-fns` and a UUID implementation | UTC storage and stable identifiers |

Dependency versions must be selected and security-reviewed at implementation time. Provider SDKs belong only in their adapter packages.
