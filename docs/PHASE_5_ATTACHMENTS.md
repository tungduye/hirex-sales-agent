# Email attachments

- Private bucket: `email-attachments`; no public URLs.
- Limits: 10 files, 10 MiB each, 18 MiB raw total per step.
- Allowed: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, PNG, JPG/JPEG. Executables and scripts are rejected.
- Both extension and MIME type are validated. Object size and SHA-256 are rechecked before Gmail transport.
- Paths are server-generated: `workspace/campaign/attachment UUID/safe filename`.
- Draft associations can be added, removed, or reordered. They become immutable after launch.
- Sent references are retained; removal must not delete an object referenced by sent history. Orphan cleanup is an explicit operator action, never automatic in Phase 5.
- Storage integration tests require `HIREX_ALLOW_REMOTE_STORAGE_TESTS=1`; local regression uses deterministic fixtures.
- Duplicate semantics: the same SHA-256 is rejected within one step; the same content may be attached independently to another step. Identical names with different bytes receive different non-guessable object paths.
- The worker resolves attachments from the claimed delivery's exact step. Missing, invalid, oversized, or integrity-mismatched objects finalize the delivery as failed before the Gmail boundary; a configured attachment is never silently omitted.
