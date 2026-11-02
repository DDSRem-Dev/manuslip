# ADR012: Explicit file sync with durable recovery

Status: accepted on the Windows baseline for ADR002 item27 (VALIDATION.md, iteration103).

A connection pairs one named saved document with one direct child of a user-selected
folder, or one exact WebDAV file URL. Document actions → Sync offers explicit review.
Main owns native paths, folder identity, settings, credentials and raw byte buffers.
The sandbox receives bounded metadata/previews and nine specific bridge methods.
Opening a document, the dialog or the app makes no network request.

The version-one atomic registry retains at most 32 connections, a raw SHA-256 common
baseline, last successful sync and optional interrupted-transfer intent. Malformed
settings retain a backup; future schemas remain read-only. Every folder action rechecks
canonical directory identity, the direct child filename and open-source aliases.
Writes use existing fingerprint/metadata-preserving atomic replacement or exclusive creation.

WebDAV uses GET and conditional PUT for one file, no redirects, cookies or ambient
browser credentials. Require HTTPS except loopback; reject URL credentials, queries and
fragments. Existing files require a strong ETag and If-Match; creation uses If-None-Match: *.
A 412 response requires fresh review. These decisions follow
[RFC9110 conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)
and [RFC4918 entity tags](https://www.rfc-editor.org/rfc/rfc4918.html#section-8.6), reviewed
on 2026-11-01. Servers without a strong ETag may be read, but their existing file cannot
be replaced. There is no collection creation, browsing or implicit deletion.

All differing versions require explicit send, receive or keep-local/export-remote/send.
Unknown initial divergence, both-side edits and a missing remote file are explained.
A five-minute review binds local disk fingerprint, remote bytes/version, connection and
owner. Saves, credential changes, disconnect, cancellation or closure invalidate stale work.
Capture and inbound replacement share ordinary file-session/save queues. Incoming bytes
notify the external-change flow: clean editors reload; newer dirty drafts and compositions
remain in the editor with explicit conflict controls. No late response blindly replaces source.
Raw documents and decoded source remain capped at 50 MiB. Filesystem prechecks cannot lock
unrelated applications; existing atomic verification and recovery boundaries still apply.

Before replacement, durably preserve the overwritten raw bytes, persist intent, publish
conditionally, verify and advance the baseline. A stopped transfer may already have
reached the server. Retry compares actual bytes; it never assumes no commit. Interrupted
intent remains visible until reconciliation. Offline failures retain the draft and previous
baseline. Transfer and retry are explicit, with no background loop.

Recovery holds up to 100 artifacts/512 MiB without eviction. Each copy has a bounded 4096-byte
header and streamed hash/length verification. Damaged and pending artifacts stay visible,
count against admission, block replacement and can be exported whole or explicitly removed.
Healthy export writes the original document bytes. Disconnect removes metadata and
credentials while retaining both files and every recovery copy.

Optional Basic credentials stay in main memory unless secure persistence is explicitly
selected. Electron async safeStorage supplies ciphertext; Linux basic_text is refused.
Key-store calls have a five-second user-visible deadline; transfers have a 60-second deadline.
One operation per window/local source is admitted. Native pickers and key-store work keep
that slot charged until actual settlement, including after caller cancellation or timeout.
Plaintext credentials never enter replies, registry JSON, checkpoints or diagnostic errors.

Acceptance covers both adapters, restart/offline retry, stale and conditional writes,
recovery export/removal, cancellation accounting, dirty/composition download races,
strict IPC/caps and the unchanged application suite. Both locales/themes, wide/narrow
layouts and the final Windows package passed bounded interface review. Public server
compatibility, macOS/Linux execution and release actions remain separate.
