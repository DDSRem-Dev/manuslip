# ADR 011: Run versioned local commands in isolated plugin hosts

Status: Accepted.

## Context

Local extensions need document transforms and optional file/network access without
granting third-party JavaScript the editor's privileges or silently changing writing.

## Decision

API 1 uses explicitly installed, self-contained JSON bundles. Immutable code/manifest
bytes and their fingerprint bind grants to the reviewed version. Installation, updates,
permission changes, enable/disable and removal are explicit actions.

Run each invocation in a fresh sandboxed Chromium process with its own private origin
and session. Verify separation from the editor before sending input. Grant no Node or
general application bridge. Main mediates narrow file/network calls and rechecks grants
and ownership after awaits; native pickers expose capabilities rather than paths.

Commands receive captured source/selections. Transform output is an inert proposal;
Apply rechecks document revision, installation fingerprint, enabled state and write grant,
then creates one undoable transaction. Network access is limited to declared admitted
origins. Bound calls, queue admission and deadlines, including hung-process cleanup.
Revocation, owner closure, disable, update and removal cancel outstanding work.

## Alternatives and consequences

In-process plugins or a Node-enabled host could stall editing or inherit filesystem
authority. Automatic application of replacements could overwrite newer writing.
Isolation and explicit grants add process/capability lifecycle work, but contain failures
and leave the user in control. There is no marketplace, package runtime or automatic update
mechanism in this contract.

The [plugin guide](../guides/plugins.md) defines the complete bundle, API, permissions and
limits. [Plugin contracts](../../apps/desktop/src/shared/plugin-contracts.ts) validate the
application boundary; [security policy](../../SECURITY.md) describes host isolation.
