# Sync a saved document

## Connect

Save your writing, resolve conflicts, then open **Document actions → Sync**.
Each connection pairs one saved path with one file:

| Adapter | Configuration |
| --- | --- |
| Folder | Enter a Markdown/text filename and select its destination folder. |
| WebDAV | Enter one file's full HTTPS URL in an existing collection; HTTP is loopback-only. No URL credentials, queries or fragments. |

Optional Basic credentials last for the session. **Remember securely on this device**
requires a working system key store. Save As needs a new connection.

## Review and transfer

**Review saved versions** reads the destination and displays byte counts, optional previews
and differences. Choose explicitly:

- **Send saved version:** create or replace the remote file.
- **Receive remote version:** replace the local saved file.
- **Keep local and save remote copy…:** export remote bytes, then send saved local bytes.
  Cancelling the picker cancels the transfer.

A changed disk/server version requires fresh review. Replacing existing WebDAV content
requires a strong ETag; servers without one can still supply content to receive.
Recovery bytes precede replacement; verification advances the baseline.

Opening the app/dialog never transfers or contacts the server. Work offline, save locally,
then reconnect and review. **Stop sync** cancels an attempt but cannot retract a committed
server write; retries inspect actual versions. Finish/cancel native pickers before retrying.
Incoming files preserve newer editor drafts through ordinary conflict controls.

## Recover and disconnect

**Recovery copies** survive restart/disconnect. **Export copy…** preserves exact encoding,
BOM and line endings and refuses open-document destinations. Export damaged/interrupted
artifacts for inspection or explicitly remove them; unresolved artifacts block replacement.
Storage holds at most 100 copies / 512 MiB without eviction; files are capped at 50 MiB.

**Disconnect** removes pairing and stored credentials, retaining both files and recovery.
For moved/missing files, use Save As/recovery and disconnect the old path before closing.
[ADR 012](../adr/012-explicit-file-sync.md) defines version review and durable recovery.
