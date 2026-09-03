# Email Campaign Architecture

Campaigns use durable campaign, sender, recipient, suppression, and event rows. Recipients are normalized and unique per campaign; missing template variables render blank. Only plain-text templates are enabled. Each recipient owns one stable idempotency UUID forever.

Lifecycle: `DRAFT → SCHEDULED/RUNNING → PAUSED/RUNNING → COMPLETED/CANCELLED`. Recipient lifecycle is `PENDING → SENDING → SENT/FAILED/DELIVERY_UNKNOWN`; suppression produces `SUPPRESSED`, cancellation affects untouched recipients only.

The service-role-only claim RPC locks at most 25 eligible rows using `FOR UPDATE SKIP LOCKED`. In the same transaction it locks a least-used eligible sender plus the underlying account-global limit row, verifies `GMAIL`, `CONNECTED`, and `gmail.send`, assigns it durably, and reserves both campaign-level and global account UTC-day/UTC-minute capacity. Two campaigns therefore serialize on the same Gmail account limit. Defaults are conservative and configurable; they are not provider maximums. A crash consumes reservations conservatively. A 15-minute lease can reclaim only a claim whose `send_request_id` is still null; sender and stable idempotency key never change, and reclaim does not reserve again.

Only DRAFT campaigns may change templates, audience, senders, or caps. Server-side workspace/status checks are backed by database triggers to close transition races. Suppression precedence is `HARD_BOUNCE > UNSUBSCRIBED > MANUAL`; manual actions cannot downgrade stronger suppression evidence.

CSV/XLSX input is untrusted, bounded, formula-inert data. Templates support simple `{{key}}` substitution only—no expressions or code. Workspace suppression is checked before claim and again before send. Attachments, HTML transport, tracking, reply detection, stop-on-reply, bounce handling, and unsubscribe headers remain Phase 4C work.

## Worker and review boundary

Migration 014 is preparation only and must be reviewed, preflighted, applied, and rollback-tested before any campaign mutation or worker execution. The application includes authenticated draft/update/sender/audience/lifecycle controls, metrics and preview; a service-only bounded worker endpoint; and a guarded one-run operator. No campaign worker or send has been executed.

CSV/XLSX parsing is bounded to 5,000 data rows, 100 columns and 5 MB. XLSX uses `read-excel-file`, reads the first worksheet as values, and does not execute formulas or macros. Missing variables render blank and are reported by preview. Signed unsubscribe tokens expire and create an idempotent workspace suppression without revealing workspace data. The internal endpoint reuses `AUTOMATION_CRON_SECRET`, activates a bounded set of due campaigns, then processes at most 10 recipients. The CLI additionally requires `HIREX_ENABLE_CAMPAIGN_WORKER_OPERATOR=1`; neither surface offers run-until-complete. The existing NEW send engine remains the only Gmail transport.
