# HireX Sales Agent Platform — Architecture

## 1. Scope and architectural goals

This document defines the target architecture. Phase 0 produces architecture only; it does not implement CRM, integrations, or AI execution. The first supported operating modes are `MANUAL` and `AI_ASSIST`. `AUTONOMOUS` is explicitly out of scope until a later, separately approved phase.

Core invariants:

- `Contact` is the canonical person. Channel-specific identities belong to `ContactChannel`; never create models such as `email_customer` or `zalo_customer`.
- A contact may have many channel identities, and a workspace may connect many accounts for the same channel type.
- AI reasoning is independent from delivery channels.
- AI creates proposed actions; it never calls Gmail, Facebook, WhatsApp, Zalo, or Viber APIs directly.
- Every outbound side effect passes through authorization, policy, validation, idempotency, and audit boundaries.
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

## 6. Background jobs

Redis and BullMQ provide transport and scheduling; PostgreSQL remains the system of record. Proposed queues:

- `channel.ingest`: normalize verified inbound events and deduplicate messages.
- `channel.sync`: incremental mailbox/channel synchronization.
- `message.send`: execute approved outbound commands through adapters.
- `agent.run`: assemble context and invoke approved AI workflows.
- `sequence.schedule`: evaluate due enrollments and create step jobs.
- `tracking.process`: normalize delivery/open/click/reply events.
- `maintenance`: token refresh, reconciliation, retention, and cleanup.

Every job includes `workspace_id`, correlation ID, schema version, idempotency key, attempt metadata, and a reference to durable database state rather than sensitive payloads. Workers use bounded exponential backoff with jitter, distinguish retryable from terminal failures, and send exhausted jobs to a dead-letter path with alerts. Database transitions and job dispatch should use an outbox/reconciliation strategy to avoid lost work.

The Gmail incremental runner is reusable by both manual controls and a server-only internal scheduler endpoint. The endpoint uses a dedicated bearer secret, bounded account/page processing, and the database lease as its concurrency boundary. Integration with an external scheduler is pending; background Gmail synchronization is not active until that scheduler is configured.

Phase 2B.1 prepares a server-controlled Gmail send-request schema and an explicit least-privilege OAuth upgrade strategy; sending is not active. Phase 2B.2 will add explicit `gmail.send` reconsent without damaging readonly sync, Phase 2B.3 will add a safe one-message send service, and Phase 2B.4 will add server-derived reply/thread sending.

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

These are recommendations only; Phase 0 installs nothing and does not change `package.json`.

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
