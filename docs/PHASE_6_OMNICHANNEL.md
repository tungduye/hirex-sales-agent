# Phase 6 — Omnichannel Foundation

## Product decision

HireX owns the CRM, canonical contacts, conversations, messages, campaigns,
automation, AI policy, consent, suppression, audit, and reporting layers.
Fchat is a product-reference source only and is not a runtime dependency.

Deplao may be studied for connector implementation patterns. Any reused code
must receive a separate license, security, provider-compliance, and maintenance
review. Provider sessions and credentials never enter the AI context.

## Delivery order

1. Channel-neutral contracts and adapter registry.
2. Migration-backed canonical channel accounts, conversations, messages,
   inbound events, outbound actions, assignments, tags, and consent state.
3. Official Facebook Page connector and signed webhook ingress.
4. Isolated Zalo bridge with explicit account-health and kill-switch controls.
5. Unified Inbox, assignment, quick replies, tags, and human takeover.
6. Keyword/workflow automation and multi-channel sequences.
7. Channel-aware tracking, attribution, consent, suppression, and reporting.
8. AI Assist proposals with mandatory policy and approval boundaries.

## Non-negotiable boundaries

- A person remains `Contact`; channel identities remain `ContactChannel`.
- Adapters translate provider payloads but do not decide campaign or AI policy.
- AI produces proposed actions and cannot access provider credentials.
- All sends require a durable action, current policy evidence, idempotency, quota,
  account health, audit, and a provider adapter.
- Unknown delivery is not retried automatically.
- Facebook and Zalo capabilities are negotiated per connected account; the core
  never assumes every channel supports files, receipts, templates, or reactions.

## Implemented foundation

The current foundation introduces:

- Pure TypeScript channel contracts and a fail-closed adapter registry.
- Canonical `channel_accounts`, server-only `channel_account_credentials`, `omnichannel_conversations`,
  `omnichannel_messages`, deduplicated inbound events, durable outbound actions,
  and conversation tags in migration 021.
- Human takeover and conversation automation eligibility policy.
- Keyword/workflow contracts that produce proposed internal actions only.
- Signed Facebook Page and Zalo bridge webhook adapters with normalized inbound
  persistence and provider transport isolated behind injected interfaces.
- Unified Inbox controls for assignment, tags, human takeover, quick replies,
  human proposal/approval, channel suppressions, and channel reporting.
- Separate multichannel campaign schema and bounded worker lifecycle in migration
  022. The established email campaign engine is not silently rewritten.
- Audited marketing-consent state on every contact channel. Multichannel claims
  require explicit `OPTED_IN` consent; unknown or opted-out identities are not
  eligible. Facebook Page campaign messages additionally require an open/pending
  conversation with inbound activity inside a conservative 23-hour response
  window before the adapter may use Meta's `RESPONSE` messaging type.
- Existing Gmail account/thread/message data is backfilled and maintained as a
  canonical read model by migration 021; Gmail ciphertext is never copied.

Migrations 021 and 022 are local, unapplied rollout artifacts. No OAuth flow,
provider login, webhook registration, external send, remote migration, or
scheduler activation occurred during implementation. Facebook and Zalo require
real provider app credentials plus a reviewed connection ceremony before their
routes can become operational. The Zalo bridge remains an isolation boundary;
HireX does not import Deplao code or depend on Fchat.
