# Local command plugins — API 1

## Install and run

**Preferences → Plugins** installs a local `.manuslip-plugin.json`. Review its publisher,
description and requested access; grants start unchecked. Installation copies the bundle.
Updates and permission changes are explicit; editing the original does not update it.
Bundles have no signing or marketplace identity verification.

**Document actions → Plugin commands** runs against captured source, regardless of reading
language. Inspection returns plain text; transforms propose a complete replacement.
**Apply to document** requires the unchanged revision, enabled installation and write grant,
then creates one undoable edit. **Discard result** leaves source intact. Commands never
save automatically. Closing the dialog permits writing; reopen it to stop or review work.
Try [Writing tools](../../test/e2e/fixtures/plugins/writing-tools.manuslip-plugin.json).

## Bundle

UTF-8 JSON has exactly `manifest` and `code`; unknown fields/API versions are rejected.
Register one synchronous or asynchronous handler returning a string:

```json
{
  "manifest": {
    "apiVersion": 1,
    "id": "example.uppercase",
    "name": "Uppercase",
    "version": "1.0.0",
    "description": "Propose uppercase source.",
    "commands": [{ "id": "uppercase", "title": "Uppercase source", "kind": "transform" }],
    "permissions": ["document.read", "document.write"],
    "networkOrigins": []
  },
  "code": "manuslipPlugin.register(({ document }) => { if (!document) throw new Error('Read access required'); return document.text.toUpperCase(); });"
}
```

IDs use lowercase letters, digits, dots, underscores or hyphens, at most 80 characters.
Use semantic versions. Declare 1–20 uniquely identified commands, each with a title and
`inspect` or `transform` kind. Transforms declare `document.write`; handlers must tolerate
ungranted permissions. `code` is self-contained JavaScript; `manuslipPlugin.apiVersion` is `1`.

## Host API

The handler receives `{commandId, document}`. With `document.read`, `document` contains
`text` and `selections: [{anchor, head}]` using UTF-16 offsets. It is a detached capture;
mutating it cannot edit source. Paths, editor objects, translations and credentials are absent.

| Permission | Capability |
| --- | --- |
| `document.read` | Captured source and up to 256 selections. |
| `document.write` | Transform proposal; explicit review still required. |
| `files.read` | `await manuslipPlugin.readTextFile()` picks one UTF-8 file; cancellation returns `null`. |
| `files.write` | `await manuslipPlugin.writeTextFile(text)` picks a destination; cancellation returns `false`, publication `true`. |
| `network` | `await manuslipPlugin.fetchText(url, {method: 'POST', body: text})` returns text from a declared origin. |

File capabilities expose no paths. Atomic writes check destination changes and refuse open
documents. Invalid UTF-8/oversized files fail. Await each host call before another or before
returning; denied, revoked or cancelled calls reject.

Network needs a grant and 1–8 exact `networkOrigins`, e.g. `["https://api.example.org"]`.
Origins have no paths, credentials, queries or fragments. Require HTTPS except loopback HTTP
(`localhost`, `127.0.0.1`, `[::1]`). GET has no body; POST accepts text. Requests use fixed
headers, no cookies/application credentials or redirects. Direct fetch, WebSockets, remote
dependencies, images, navigation and popups are blocked.

## Limits and recovery

[Plugin contracts](../../apps/desktop/src/shared/plugin-contracts.ts) define limits:

| Resource | Limit |
| --- | --- |
| Bundle / code | 256 KiB / 128 KiB UTF-8 |
| Installations / registry | 32 / 8 MiB |
| Source, result or selected file | 2 MiB UTF-8 |
| Host calls | One pending, 16 per invocation |
| Network request / response | 64 KiB / 1 MiB |
| Load, registration and execution | 15 seconds combined |
| Execution | One outstanding command per window |

Each invocation uses a fresh isolated sandbox without Node, arbitrary IPC, npm imports or
persistent storage. Grants bind to manifest/code fingerprints. [ADR 011](../adr/011-local-command-plugins.md)
defines isolation and revocation.

Stop, permission changes, disable/update/removal, document closure and timeout revoke work.
Finish an outstanding native picker before another invocation; late responses cannot publish
cancelled work. Hung processes terminate without blocking the editor.

Storage failure retains the previous installation. Corrupt data keeps a recovery copy;
future schemas stay read-only. **Retry** reloads registry state before repeating the action.
Removal deletes the installed bundle/grants, preserving documents and the original file.
