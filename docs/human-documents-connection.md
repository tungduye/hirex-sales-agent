# Human documents: connection foundation

Routes: `/settings/human`, `/documents`. Both enforce workspace admin on the server; the save action independently repeats authorization.

The document screen supports an offline encrypted snapshot with admin-only search, folder filtering, pagination and sanitized status display. AI Q&A uses selected-document or library keyword retrieval, with source excerpts. It does not run a scheduler or download/read attachments.

## AI Q&A

Performance: authorized snapshot reads check filesystem version (inode, size, mtime, ctime) each time and reuse a per-workspace single-flight cache, capped at two entries with five-minute idle expiry. Failed/deleted/changed files invalidate the entry. A WeakMap keeps normalized text/chunks tied to the immutable snapshot array; replacement snapshots rebuild the index. No model-answer caching. Narrow local query grammar handles exact library counts, exact group-name/unique prefix-stripped group matches, and explicit title-substring search. Selected-document scope is respected. Unknown/complex conditions fall back to the existing AI path, which still requires explicit consent. Local lookup needs no provider consent and returns at most 20 document references, clearly labeled as local results.

Requires server-side `OPENAI_API_KEY`; optional `HUMAN_DOCUMENTS_AI_MODEL` overrides the existing default model. Each request independently authorizes the workspace admin and requires UI consent before sending the question and up to eight relevant 2,000-character status excerpts to OpenAI Responses. Requests use `store: false` (not a promise of zero provider retention). No full-library upload or persisted chat history. Strict structured output and exact-quote validation reject unknown document IDs and fabricated quotations; they do not prove every answer claim is correct. Users should check cited sources. Retrieval is lexical, not exhaustive, and long documents may only be partially represented. Each question is independent. Rate limiting is in-process (8/minute/user/workspace, one concurrent request), appropriate only for this single-host deployment. Upstream failures return redacted errors.

## Offline snapshot

`node scripts/import-human-snapshot.cjs <json-file> <workspace-uuid>` validates IDs and names, rejects duplicates and writes only an encrypted snapshot under `runtime/human-documents/<workspace-uuid>.enc`. Existing snapshots are never overwritten by this script. Back up the old snapshot before an explicitly authorized update. The source must be a complete JSON array or a response with a `data` array. No upstream Human connection is used. Snapshot files must stay outside public assets and Git, with service-account-only filesystem access. The page independently authorizes the current workspace admin before opening its file; it does not take workspace IDs from URLs.

## Prerequisites

- Operator sets `HUMAN_API_BASE_URL` to the verified Human HTTPS origin (no path/query/userinfo). Do not use the existing public HTTP endpoint or disable certificate validation. Redirects are rejected, including HTTPS-to-HTTP redirects.
- Existing Gmail credential encryption configuration must be available (`EMAIL_TOKEN_ENCRYPTION_KEY` and existing Gmail server config). Secrets are never returned to the client or logged by this integration.
- Use a dedicated Human read account; the login contract is inferred from supplied source, not yet verified against the deployed service.
- Store is single-host: encrypted per-workspace files under `runtime/human-connections`, outside build artifacts and public assets. On Windows, ensure the service account and administrators alone have access through NTFS ACLs; POSIX mode flags do not replace Windows ACLs. Back up encrypted files and encryption key separately. Multi-instance deployments need a shared secret store before use.

Saving sends credentials only to the operator-configured origin after explicit checkbox consent. A successful login is required before replacing the saved encrypted credentials. No token is persisted. UI never restores passwords. Upstream errors are intentionally redacted.

## Remaining integration work

Verify HTTPS and login on the actual deployment; implement bounded synchronization of `/document/all` (observed live) with workspace-scoped storage, single-flight locking and explicit completeness reporting. Do not assume pagination supported by the older ZIP source. Keep UI admin-only until HireX document permissions are explicitly configured.
