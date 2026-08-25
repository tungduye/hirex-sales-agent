# HireX Sales Agent Platform — Roadmap

## Delivery principles

Each phase is independently reviewable, migration-driven, observable, and protected by workspace authorization. `MANUAL` and `AI_ASSIST` are the only operating modes before Phase 18. Channel adapters remain separate from Agent logic, and no AI-generated side effect bypasses the action policy/service layer.

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

## Phase 4 — Job and Worker Infrastructure

- Introduce Redis, BullMQ, separate workers, queue contracts, retries, dead-letter handling, schedulers, and reconciliation.
- Add correlation IDs, idempotency keys, operational dashboards, and worker health controls.

## Phase 5 — Gmail Connector and Email Inbox

- Implement multi-account OAuth lifecycle, `channel_accounts`/`email_accounts`, least-privilege scopes, Gmail adapter, webhook/history synchronization, and token refresh.
- Normalize Gmail threads/messages into the conversation core.
- Keep all outbound email user-authored and policy-controlled.
- Reuse the bounded incremental History runner through a server-only internal endpoint; external scheduler configuration remains pending and automatic sync is not yet active.

## Phase 6 — Manual Email Sending and Delivery Policy

- Add composer, drafts, attachments, signatures, send-as selection, suppression/consent checks, rate limits, approval evidence, and idempotent delivery.
- Route every send through application service, policy engine, job queue, and Gmail adapter.

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

## Phase 18 — Autonomous Mode (Future, Gated)

- Treat autonomy as a new product/security capability, not a flag enabled by default.
- Require offline/online evaluations, scoped action budgets, allowlists, confidence thresholds, staged rollout, kill switches, anomaly detection, approval escalation, and incident runbooks.
- Permit only narrowly defined actions after policy authorization; connectors remain inaccessible to the model and side effects still flow through the action executor.
- Preserve immediate human takeover and complete auditability.

Exit: only after explicit governance approval and demonstrated safety/reliability targets; otherwise remain in `MANUAL` or `AI_ASSIST`.
