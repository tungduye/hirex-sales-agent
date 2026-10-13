# HireX Sales Agent Platform — Roadmap

## Status (October 2026)

Status is derived from the code and migrations `001`–`068` present in the repository, not from live-environment verification. The phases were not delivered in numeric order.

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Architecture | Done | Revised Oct 2026 to match the running system |
| 1 CRM foundation | Mostly done | Companies, contacts, contact channels, notes, audit log. Opportunities and duplicate merge not implemented |
| 2 Security & operations | Partial | Workspace RBAC + RLS hardening (`029`–`034`), encrypted credentials. No CI, structured logging, tracing or tested backup/restore |
| 3 Conversations & unified inbox | Done | Canonical omnichannel conversations/messages (`021`) |
| 4 Jobs & workers | Replaced | Postgres-table queues + two Node workers + Windows scheduled tasks instead of Redis/BullMQ |
| 5 Gmail connector | Done | OAuth, initial + incremental sync on a 5-minute task |
| 6 Email sending & omnichannel foundation | Done | Idempotent send, ambiguous-send locking, reply sending |
| 7 AI drafting | Done | Inbox AI suggestions, AI Recruiter DRAFT mode |
| 8 Reply understanding | Partial | Intent classification only inside AI Recruiter |
| 9 AI reply suggestions | Partial | Grounded suggestions for AI Recruiter; general inbox suggestions are basic |
| 10 Campaigns | Done | Email and multichannel (Zalo, Facebook profile) campaigns with pacing, archiving, random content |
| 11 Follow-up sequences | Done for email | `016`, `068`; channel campaigns have reply completion (`037`) |
| 12 Tracking & analytics | Partial | Delivery report, reply counts, late-reply signal; no open/click attribution model |
| 13 Inbox & human takeover | Done | Assignment, tags, quick replies, takeover, preferences |
| 14 Facebook | Done | Official Page connector + reconciler; also an unofficial personal-profile bridge (see risks in ARCHITECTURE) |
| 15 WhatsApp | Not started | |
| 16 Zalo & Viber | Zalo done, Viber not started | Zalo through the Deplao bridge with personal accounts, multi-account pacing |
| 17 Lead research & scoring | Partial | CV scan and website scan; no scoring model |
| 18 Autonomous mode | **Delivered for AI Recruiter** | AUTO is an approved mode for AI Recruiter conversations only; see Phase 18 below |

Additional delivered work not in the original plan: AI Recruiter (four bots, `049`–`054`, `061`), Human documents Q&A, n8n monitoring, CV/website scan.

### Next priorities

1. Commit and back up the current state; keep `.gitignore` covering logs, build backups and `runtime/`.
2. Deploy migration `069` (database gate, audit attribution, mode-change audit), then close the remaining AUTO gaps in ARCHITECTURE §4.2 (volume caps, fallback metric).
3. Add a CI gate (lint, typecheck, `node:test` unit tests) and break up the largest server modules, starting with `process-ai-recruiter.ts`.
4. Decide the long-term plan for personal-account channels (Facebook profile, Zalo via Deplao) and for the single Windows host.

## Delivery principles

Each phase is independently reviewable, migration-driven, observable, and protected by workspace authorization. Outside AI Recruiter, `MANUAL` and `AI_ASSIST` are the only operating modes. AI Recruiter may run in `AUTO` within the gates documented in ARCHITECTURE §4.1. Channel adapters remain separate from Agent logic, and no AI-generated side effect bypasses the action policy/service layer, including AUTO sends.

## Phase 0 — Architecture

- Define system boundaries, canonical contact/channel model, AI action boundary, adapter contracts, security model, database design, and roadmap.
- Confirm Next.js App Router baseline and target stack.
- Produce documentation only; no application implementation, dependency installation, or database migration.

Exit: architecture decisions and Phase 1 scope are approved.

## Phase 1 — CRM Foundation

- Add Supabase PostgreSQL/Auth foundation, workspace membership, RLS, and migration workflow.
- Implement companies, contacts, contact channels, tasks, and opportunities.
- Provide search, filtering, ownership, validation, duplicate review/merge foundations, and CRM audit logs.
- Support only `MANUAL` operating mode in CRM workflows, while retaining the architecture field for `AI_ASSIST`.

Explicitly excluded from Phase 1: Gmail, OpenAI execution, campaigns, sequences, sent/delivered/open/click/reply tracking, Facebook, WhatsApp, Zalo, Viber, and autonomous mode.

Exit: a user can securely manage workspace-isolated CRM records and multiple channel identities per contact.

## Phase 2 — Platform Security and Operations Foundation

- Harden authorization, RLS tests, audit pipeline, structured logging, tracing, error handling, rate limits, secret handling, and backup/restore procedures.
- Establish Docker development/runtime topology and CI quality gates.
- Define durable outbox, idempotency, and retention primitives before external side effects.

## Phase 3 — Conversation and Unified Message Core

- Implement channel-neutral conversations, messages, participants/assignments, statuses, attachments, and canonical message contracts.
- Build Unified Inbox UI using internal/manual messages only; no external connector yet.
- Add human assignment and takeover-ready conversation states.
- Phase 3 product flow adds the Gmail Sales Inbox, bounded canonical reply-target resolution, editable AI draft generation, and human-approved idempotent REPLY sending through the reviewed Gmail executor. AI cannot send automatically; uncertain delivery is never retried automatically.

## Phase 4 — Job and Worker Infrastructure

- Introduce Redis, BullMQ, separate workers, queue contracts, retries, dead-letter handling, schedulers, and reconciliation.
- Add correlation IDs, idempotency keys, operational dashboards, and worker health controls.

## Phase 5 — Gmail Connector and Email Inbox

- Implement multi-account OAuth lifecycle, `channel_accounts`/`email_accounts`, least-privilege scopes, Gmail adapter, webhook/history synchronization, and token refresh.
- Normalize Gmail threads/messages into the conversation core.
- Keep all outbound email user-authored and policy-controlled.
- Reuse the bounded incremental History runner through a server-only internal endpoint; external scheduler configuration remains pending and automatic sync is not yet active.

## Phase 6 — Manual Email Sending and Delivery Policy

> Delivery update: the email-send policy work was completed in earlier Phase 2B
> slices. The current Phase 6 implementation expands HireX into an omnichannel
> foundation: canonical inbox, Facebook/Zalo adapter boundaries, operator
> controls, workflow proposals, channel suppression/reporting, and a separate
> multichannel campaign lifecycle. See `docs/PHASE_6_OMNICHANNEL.md`.

- Add composer, drafts, attachments, signatures, send-as selection, suppression/consent checks, rate limits, approval evidence, and idempotent delivery.
- Route every send through application service, policy engine, job queue, and Gmail adapter.
- Phase 2B.1 prepares the server-controlled send-request schema and OAuth scope strategy only; sending remains inactive.
- Phase 2B.2 explicit Gmail send consent is complete. Phase 2B.3A passed a controlled NEW plain-text send; Gmail replaced the requested Message-ID. Phase 2B.3B persists internal `X-HireX-Send-Request-ID` metadata without FK/uniqueness, and Phase 2B.3C verified preservation once. Phase 2B.3D adds a server-only read-only multi-signal evaluator. Phase 2B.3E adds the service-role-only transactional finalizer that independently revalidates canonical evidence. Phase 2B.3F adds the exact-request orchestrator; Phase 2B.3G adds bounded read-only discovery; and Phase 2B.3H adds the manual exact-request boundary. Phase 2B.3I-A adds local read-only list/inspect commands. Phase 2B.3I-B adds one explicit operator reconcile command requiring an exact request-derived confirmation and delegating once to 2B.3H. Phase 2B.4A adds a server-only, read-only evaluator for one exact canonical inbound Gmail reply target. Phase 2B.4B creates only one idempotent `PENDING` REPLY request from that revalidated target and persists only its canonical local message linkage. Phase 2B.4C adds a separate service-role-only transactional first-attempt claim from `PENDING` to `SENDING`. Phase 2B.4D adds read-only post-claim planning: it proves exact lock ownership, re-evaluates the target, compares persisted target/recipient/subject, and treats provider thread/RFC parent as current canonical evidence only. Phase 2B.4E builds only validated plain-text reply MIME and returns the current provider thread ID separately. Phase 2B.4F-A adds a separate exact-lock REPLY SENT finalizer that records Gmail provider IDs while intentionally leaving outgoing `rfc_message_id` null. Phase 2B.4F-B only extends the existing Gmail transport with an optional validated provider thread ID: NEW remains `{ raw }`, future REPLY is `{ raw, threadId }`, and the transport returns Gmail's actual thread ID for a future executor to compare before finalization. Phase 2B.4F-C1 adds a separate exact-lock REPLY FAILED finalizer with a closed deterministic-only taxonomy; ambiguous or post-acceptance uncertainty remains `SENDING`. Phase 2B.4F-C adds the server-only exact-one-request executor foundation: credentials precede claim, one internal lock flows through all boundaries, Gmail is called at most once, and only exact thread-matched acceptance may finalize SENT. Phase 2B.4G-A adds an explicit-ID, env-guarded operator preflight that only reuses the canonical evaluator and returns safe metadata; success neither creates a request nor authorizes sending. Phase 2B.4G-B adds a separate exact-input, exact-env-guarded operator command that delegates to Phase 2B.4B and may create or return only one idempotent `PENDING` REPLY request. Phase 2B.4G-FINAL adds the separately guarded manual flow `PREFLIGHT → CREATE → INSPECT PENDING → EXECUTE ONCE → INSPECT FINAL`; expected canonical fields are assertions only, the executor receives only exact local IDs, and terminal verification cannot trigger repair or resend. There is no automatic reconciliation, automatic retry, batching, stale-lock reclaim, reply scheduler, API, or UI. The real controlled live invocation remains a separate manual review action.

## Phase 7 — AI Foundation and Sales Email Drafting

- Introduce OpenAI integration in workers, prompt/model registry, structured outputs, evaluations, usage/cost capture, and redaction.
- Implement `agent_runs` and proposed `DRAFT_MESSAGE` actions.
- Enable `AI_ASSIST`: AI drafts; a human reviews and sends. AI has no provider credentials or direct send tool.

## Phase 8 — Reply Understanding and Intent Classification

- Classify reply intent, sentiment, objections, urgency, unsubscribe requests, and entity updates with confidence/evidence.
- Persist proposed classifications as agent actions and build human correction/evaluation workflows.
- Automatically enforce deterministic unsubscribe/suppression rules independently of model opinion.

## Phase 9 — AI Reply Suggestions

- Generate grounded reply drafts from conversation and authorized CRM context.
- Add tone/brand controls, citations to internal context, safety checks, prompt-injection defenses, and approval UI.
- Continue human approval for all sends.

## Phase 10 — Campaigns

- Add campaign drafts, audience definitions, exclusions, sender selection, previews, scheduling, pausing, and campaign reporting foundations.
- Require suppression, consent, account-health, and workspace-policy checks before dispatch.

## Phase 11 — Follow-up Sequences

- Implement versioned sequences, steps, enrollment, wait/task/message steps, scheduling, pause/stop rules, and reply-based termination.
- Re-evaluate policy and current contact state at every step.

## Phase 12 — Email Tracking and Analytics

- Normalize sent, delivered, bounced, opened, clicked, replied, complained, and unsubscribed events where providers support them.
- Add privacy-aware tracking settings, deduplication, attribution caveats, funnel metrics, and reconciliation.

## Phase 13 — Unified Inbox and Human Takeover

- Mature Unified Inbox with assignments, collision prevention, notes, SLA views, saved filters, and cross-channel timeline.
- Add explicit human takeover/release state; pause AI suggestions and automated sequence work when required.

## Phase 14 — Facebook Messenger Connector

- Add multi-account/page connection, Facebook adapter, webhook verification, inbound normalization, outbound policy execution, capability mapping, and provider-specific compliance handling.
- Reuse Contact, ContactChannel, Conversation, Message, and ChannelAccount models.

## Phase 15 — WhatsApp Connector

- Add WhatsApp adapter, business account/number support, templates and conversation-window policies, delivery events, opt-in enforcement, and multi-account operations.
- Preserve the same canonical models and action boundary.

## Phase 16 — Zalo and Viber Connectors

- Implement separate Zalo and Viber adapters behind the common channel interface.
- Add capability negotiation, account health, webhook/event normalization, policy constraints, contract tests, and operational runbooks.
- Do not introduce channel-specific customer tables.

## Phase 17 — Lead Research and Lead Scoring

- Add permission-aware research sources, provenance, freshness, deduplication, and human-verifiable enrichment suggestions.
- Implement explainable, versioned scoring with historical snapshots, bias/quality evaluation, and feedback loops.
- AI proposes CRM changes and scores; policy and human workflows control application.

## Phase 18 — Autonomous Mode (AI Recruiter: delivered; elsewhere: gated)

**Decision (October 2026):** AUTO is an official mode for AI Recruiter conversations. The direction is for AUTO to become the only AI Recruiter mode; DRAFT stays until the readiness criteria in ARCHITECTURE §4.3 are met.

Delivered for AI Recruiter:

- Two explicit switches (bot and conversation), deterministic policy rewrites after inference, service-role database function that re-checks state and suppression, idempotent outbound actions through the shared executor, human takeover and bot pause.

Remaining for AI Recruiter before DRAFT is removed (ARCHITECTURE §4.2–4.3):

- ~~Database gate requires both switches; AUTO actions carry no human approver; mode changes are written to `audit_logs`.~~ Done in migration `069` (pending deployment).
- Per-bot and per-account send caps plus a workspace kill switch enforced in the database function.
- Regression replay set for prompt/model/policy changes, daily AUTO metrics and alerts.
- Switch the conversation override from opt-in to opt-out.

Any other module (campaigns, Gmail replies, inbox suggestions) stays `MANUAL`/`AI_ASSIST`. Extending AUTO to it needs a separate decision with the same evaluation, budgets, kill switch, takeover and audit requirements:

- Treat autonomy as a new product/security capability, not a flag enabled by default.
- Require offline/online evaluations, scoped action budgets, allowlists, confidence thresholds, staged rollout, kill switches, anomaly detection, approval escalation, and incident runbooks.
- Permit only narrowly defined actions after policy authorization; connectors remain inaccessible to the model and side effects still flow through the action executor.
- Preserve immediate human takeover and complete auditability.

## Historical note — Phase 4AB (superseded)

The original review snapshot said migration 014 was unapplied and no campaign had been sent. That is no longer true: campaigns, sequences, attachments, HTML editing, pacing and reply tracking were delivered through migrations `014`–`068`.
