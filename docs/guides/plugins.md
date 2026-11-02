# Local command plugins — API 1

In Preferences → Plugins, choose a local `.manuslip-plugin.json`, review its name,
description and requested access, then install with the permissions you select.
All permission checkboxes start unchecked. The file is copied into private application
settings; moving or editing the original does not update an installation. Install a
new version explicitly and review its permissions again. Preferences also provides
permission changes, disable/enable and confirmed removal.

Open a document, then Document actions → Plugin commands. Commands receive a captured
source revision, independently of the selected reading language. Inspection returns
plain text. A transform returns a proposed complete document: review it, then Apply to
document or Discard result. Apply is one undoable edit and requires the same document
revision, enabled installation and write grant. Continue editing by closing the dialog;
reopen it to stop a running command or review its result. A later source edit prevents
applying an obsolete proposal. Running a command never automatically saves the document.

Try [Writing tools](../../examples/plugins/writing-tools.manuslip-plugin.json): grant source
read/write access to count source words or propose trimming trailing spaces. It requires
no file or network access. Plugin-provided names, descriptions and results are displayed
as plain text. Check the publisher yourself; these bundles have no signing or marketplace
identity verification.

## Bundle and manifest

A UTF-8 JSON bundle has exactly two keys: `manifest` and `code`. `code` is a self-contained
JavaScript string that calls `manuslipPlugin.register` once. The example is a complete
working bundle. Unknown fields and API versions are rejected.

```json
{
  "manifest": {
    "apiVersion": 1,
    "id": "example.uppercase",
    "name": "Uppercase",
    "version": "1.0.0",
    "description": "Propose converting the captured source to uppercase.",
    "commands": [{ "id": "uppercase", "title": "Uppercase source", "kind": "transform" }],
    "permissions": ["document.read", "document.write"],
    "networkOrigins": []
  },
  "code": "manuslipPlugin.register(({ document }) => { if (!document) throw new Error('Read access required'); return document.text.toUpperCase(); });"
}
```

Use stable lowercase IDs containing letters, digits, dots, underscores or hyphens, up
to 80 characters, and a semantic version such as `1.0.0`. A manifest contains one to
20 commands with unique IDs; each command has a title and kind `inspect` or `transform`.
A transform must declare `document.write`. An installation can grant any subset of its
declared permissions; the handler must cope with denied access.

## Host API

The global `manuslipPlugin.apiVersion` is `1`. Register a synchronous or asynchronous
handler that returns a string:

```js
manuslipPlugin.register(async ({ commandId, document }) => {
  if (commandId !== 'inspect') throw new Error('Unknown command');
  return document ? `${document.text.length} source code units` : 'Source access denied';
});
```

`document` is present only with the `document.read` grant. It contains `text` and
`selections: [{anchor, head}]`, using UTF-16 source offsets. This is a detached capture;
changing it cannot edit the document. No file path, editor instance, translation,
credential, preference store or application bridge is exposed.

| Permission | Granted capability |
| --- | --- |
| `document.read` | Receive captured source text and up to 256 selections |
| `document.write` | Return a proposed replacement from a transform command; application still requires explicit review |
| `files.read` | `await manuslipPlugin.readTextFile()` opens a native picker for one UTF-8 text file; cancellation returns `null` |
| `files.write` | `await manuslipPlugin.writeTextFile(text)` opens a native save picker; cancellation returns `false`, publication returns `true` |
| `network` | `await manuslipPlugin.fetchText(url, {method: 'GET' | 'POST', body: ''})` returns UTF-8 text from a declared exact origin |

File choices apply to one action, without disclosing their paths. Writes are atomic,
check destination changes and refuse any currently open document. Invalid UTF-8 or
over-limit files fail. Host methods reject when access is denied, revoked or cancelled.
Await each method before making the next call or returning from the command.

Network access requires both a grant and one to eight `networkOrigins`, such as
`["https://api.example.org"]`. Origins contain no path, credentials, query or fragment;
scheme, host and port must match exactly. HTTPS is required except HTTP loopback
`localhost`, `127.0.0.1` or `[::1]`. Only GET and POST are supported, with fixed minimal
text headers, no cookies or application credentials, and no redirects. GET has no body.
Direct fetch, images, WebSockets, navigation, popups and remote dependencies are blocked.

## Isolation, limits and failures

Each explicit invocation creates a fresh sandboxed Chromium renderer, private session
and origin, in a process distinct from the editor. It has no Node, filesystem API,
arbitrary IPC, npm imports or persistent plugin storage. The host serves only its fixed
HTML and the installed JavaScript bytes. Results are bounded strings, never executable
HTML. Installation grants are bound to a fingerprint of both manifest and code.

| Resource | API 1 limit |
| --- | --- |
| Bundle / JavaScript | 256 KiB / 128 KiB, UTF-8 |
| Installed plugins / registry | 32 / 8 MiB |
| Captured source, result or chosen text file | 2 MiB, UTF-8 |
| Host calls | One pending, up to 16 per invocation |
| Network request / response | 64 KiB / 1 MiB, streamed and bounded |
| Load, registration and execution | 15 seconds combined |
| Execution | One outstanding command per application window |

Stop, disable, permission changes, update, removal, document closure and timeout revoke
the invocation. A hung plugin process is terminated while the editor remains usable.
An outstanding native file picker remains charged until it closes; its late response
cannot publish after cancellation. Exceptions and crashes produce a localized failure,
without exposing private paths, document text or plugin diagnostics in the message.

The versioned installation registry uses atomic writes and detects outside changes.
Failed persistence retains the previous installation. Corrupt data retains a recovery
copy; a future schema stays read-only. Choose Retry to reload installation state after
a storage error, then repeat the intended action. Removing a plugin deletes its stored
bundle and grants; it does not change documents or its original bundle file.

API 1 is a local command contract. It provides the documented text operations; richer
editor views, background services and automatic installation require a separately
versioned contract.
