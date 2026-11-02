# Sync a saved document

Open **Document actions → Sync**. Save your latest writing and resolve any file conflict
first. A connection synchronizes one document with one other file.

Choose **Folder**, enter a Markdown/text filename, then select the destination folder.
It may be managed by another sync application. Or choose **WebDAV** and enter the full
HTTPS URL of one file in an existing collection. HTTP is allowed only for a loopback
server. URL credentials, queries and fragments are refused. Basic username/password
authentication is optional. Credentials stay in this session unless you check
**Remember securely on this device**, which requires a working system key store.

Select **Review saved versions** to contact the destination. The dialog shows saved local
and remote byte counts and optional text previews. Initial differences, changes on both
sides and a missing remote file are explained. Choose a direction explicitly:

- **Send saved version** creates or replaces the remote file.
- **Receive remote version** replaces the local saved file.
- **Keep local and save remote copy…** exports remote bytes to a file you choose, then
  sends the saved local version. Cancelling the picker cancels that transfer.

Manuslip keeps exact recovery bytes before replacement. The baseline advances after
verification. A newer disk/server version invalidates the review; review again before
choosing. Existing WebDAV content needs a strong server ETag for replacement. A server
without one can still supply a version to receive.

Continue writing offline, save locally, reconnect and review again. Opening the app or
dialog does not contact the server. **Stop sync** cancels the attempt; a server may
already have accepted a write, so retry checks actual versions. Finish or cancel an
outstanding native picker before starting another attempt.

**Recovery copies** remain after restart and disconnect. **Export copy…** writes original
bytes, including encoding, BOM and line endings, to a destination you choose. Export
refuses all open source destinations. Export a damaged/interrupted artifact for manual
inspection, or explicitly remove it. Such artifacts block new replacement until handled.
Recovery holds at most100 copies/512MiB without eviction. Each document is capped at50MiB.

**Disconnect** removes the connection and its stored credentials. Both files and every
recovery copy remain. Connections follow saved paths: Save As needs a new connection.
If a file moves or disappears, use ordinary Save As/recovery controls and disconnect
the old connection before closing its tab.

Sync handles saved files. If you type or compose while a download arrives, Manuslip
keeps your newer editor draft and shows ordinary file-conflict controls. Save a copy of
that draft or choose a version through those controls.
