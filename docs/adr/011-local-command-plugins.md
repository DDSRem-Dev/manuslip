# ADR011: Versioned local command plugins

Status: accepted on the Windows baseline for ADR002 item26; broader platform acceptance remains separate.

Provide API 1 as a self-contained local JSON bundle, explicitly selected and reviewed
in Preferences. Immutable installed manifest/code bytes and their fingerprint bind
user-selected grants to the reviewed version. Updates require fresh permission review;
enable, disable, permission changes and confirmed removal are explicit. Atomic bounded
registry persistence retains old state on failure, detects outside changes, preserves
corrupt recovery copies and keeps future schemas read-only.

Run each invocation in a fresh sandboxed Chromium renderer with a distinct private
origin/session and verified process separation from the editor. Main serves only fixed
host HTML and captured JavaScript. A self-contained sandbox preload exposes register,
readTextFile, writeTextFile and fetchText. No Node or general application bridge reaches
plugin code. CSP, protocol admission and navigation/session policies deny direct network,
workers, frames, windows, arbitrary resources and permission requests. This follows the
[Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox),
[context bridge](https://www.electronjs.org/docs/latest/api/context-bridge) and
[webContents](https://www.electronjs.org/docs/latest/api/web-contents) APIs reviewed on
2026-11-01. Process separation is verified at runtime before sending captured input.

Document read grants expose only captured text/selections. Transform commands require
write permission and return inert replacement proposals. Apply rechecks installed
fingerprint, enabled state, grant, document identity and revision before one isolated
undoable source transaction. Inspection, failed commands and stale proposals never edit
source. The editor can remain in use while a command runs.

File grants use an owner-scoped native picker for every action and never expose paths.
Writes use existing atomic/fingerprint checks and reject all open document destinations.
Network grants allow only exact declared HTTPS origins or HTTP loopback, fixed GET/POST
text requests, no redirects/cookies/credentials, and streaming response limits. Host
authorization is rechecked after awaits and before publication. Responses are cancelled
even when authorization is revoked as fetch settles.

A 15-second deadline covers load, registration and execution. One command per owner,
one pending host call and 16 total calls bound admission. A command remains charged
through process cleanup and outstanding native picker settlement. Cancellation, owner
closure, permission changes, disable, update and removal revoke jobs; hung plugin
processes can be killed without terminating the editor. Limits and the complete authoring
contract are in [PLUGINS.md](../guides/plugins.md); a runnable bundle is in examples/plugins.

Validation covers actual native install/restart/update/removal, unchecked grant review,
denied and granted file/network access, redirect rejection, true hung-process isolation,
load timeout, pending picker cancellation, stale proposals, source CRLF and undo fidelity.
Both locales, themes and narrow management/result states require accessibility and visual
review. This contract includes no remote marketplace, identity signing, npm runtime,
automatic updates or public publication. Other-platform acceptance remains separate.
