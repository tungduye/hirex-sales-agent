# Phase 5 architecture

Phase 5 adds reusable private attachment metadata and an operational worker heartbeat. PostgreSQL stores metadata only; bytes live in the private `email-attachments` Supabase Storage bucket. Campaign steps reference attachments, and a database trigger freezes those references when a campaign leaves `DRAFT`.

The Gmail MIME builder remains the single outbound MIME boundary. Attachment bytes must be loaded server-side, bounded, and checked against stored size and SHA-256 before transport. A process-local bounded cache may reuse verified bytes during one worker invocation only.

Worker scheduling is operator-managed. The local PowerShell runner adds an exclusive file lock, while database claims remain the authoritative concurrency boundary.
