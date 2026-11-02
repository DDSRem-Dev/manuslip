# Replay completed micromark events without splice scratch

`scripts/patch-micromark-replay.mjs` patches both exports of pinned
`micromark-util-subtokenize@2.1.0`. Root postinstall installs it; lint and desktop builds
verify it. Core declares the exact dependency directly.

| File | Original normalized-LF SHA-256 | Patched normalized-LF SHA-256 |
| --- | --- | --- |
| index.js | `a70e48d4652be4f956606dcda3e4c13707952dc74b86f6f71990eba88d4a1e79` | `df2b1bc175449dee8c63ddc13a5c00abe4810ddc2019947682f21734dc8dbaef` |
| dev/index.js | `a63cb1552428d205157690b7c052b9a8bd011f94a7420e5b2c8f4765d5d67603` | `e44df36efa2bbf3a6da8f89efb343e373974dcadc6fde4215f863e6b2fe27065` |

Upstream source: [micromark-util-subtokenize](https://github.com/micromark/micromark/tree/main/packages/micromark-util-subtokenize).
The installed MIT license and copyright notices remain intact. This is a local patch.
Both source hashes and the package version are validated before either export is written.
Unknown versions or edited sources fail closed; known partial installs, original CRLF
sources and repeated installs are supported. Check-only builds never repair dependencies.

After resolving subcontent, upstream copies the complete gap buffer to an intermediate
array, then replaces the caller's event array through chunked splice. Splice also allocates
removed-element arrays and insertion arguments. The patch copies each `events.get(index)`
directly into the caller's original array and sets its final length. It removes the unused
splice import. Event objects, token/context references, order, coordinates, public contexts
and original array identity remain intact. The gap buffer, cursor behavior, tokenizer,
grammar and compiler are unchanged; no array prototype is modified.

This equivalence applies to the parser-owned ordinary mutable event arrays used by the
application. Accessor/proxy arrays, custom array species, overridden intrinsics and immutable
event arrays are outside that contract. The patch does not claim to reproduce their splice
side effects. The replay reads from a separate gap buffer, so overwriting the destination
does not change unread source entries.

```sh
node test/benchmark/profiles/compare-parser-lifetimes.mjs --event-copy
npm test -- packages/core/test/unit/parser-lifetimes.test.ts
```

The comparison launches original/patched fresh processes under both default/development
export conditions. Node load hooks substitute only exact hash-verified original replay
sources; the paired tokenizer lifetime patch and other backports stay identical. Each
process checks 1,642 complete document/render hashes across both grammars, all 652 CommonMark
examples, extension/container cases, seeded combinations and the complete 1 MiB nested root.
Actual resolved export paths are asserted. Nine additional raw-event fixtures compare
complete token fields, coordinates and serialized slices, original array identity, complete
public contexts, and event identity/order across repeat postprocessing. A 1,500-item list
crosses the old 10,000-event splice chunk boundary. Isolated installation tests exercise
the actual installer, exact outputs, missing patches, unknown sources/versions, idempotence,
partial installations and CRLF. Reports stay in ignored `test/artifacts/logs/`.

The nested Node A/B diagnostic records sampled cumulative allocation of 1,249,965,264 bytes
before and 1,083,213,912 after (about 13% lower), with median parse 740.2 versus 708.1 ms.
These are diagnostic samples, not portable bounds. The actual minified Electron producer
still samples approximately 323/316 MB additional private commitment on first/repeated
nested admission. That comparison does not demonstrate a meaningful physical peak reduction.
Complete native parsing still precedes bounded encoding; native and aggregate physical
ownership, complete nested Live readiness and semantic transport activation remain open.
See the replay checkpoint in `docs/validation/implementation-history.md` for preserved evidence and final checks.
