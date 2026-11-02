# Reuse a single tree traversal function

`scripts/patch-unist-visit.mjs` applies a pinned local performance backport to
`unist-util-visit-parents@6.0.2`. Root postinstall applies it; lint and desktop builds verify
it. Full normalized LF SHA-256 checks accept only the original or reviewed patched source:

| File | Original SHA-256 | Patched SHA-256 |
| --- | --- | --- |
| `lib/index.js` | `8789a4f20d3e3c82bcaeec9628697752d662461bf6237ecfba61cfcc00f30bf7` | `d5a4f2c07e2f4de0c3deca5a976de5cf3323a0316ad4a21b2d4a6e800d39a733` |

Upstream: <https://github.com/syntax-tree/unist-util-visit-parents>.
The installed MIT license/copyright remain intact. The dependency version is unchanged and
declared directly by core. The export has one implementation across development/default
conditions. Installation is idempotent, accepts known original CRLF spelling and rejects
unreviewed versions or modified content instead of replacing it.

Upstream creates a closure for every node, assigns that function a descriptive debug name
with `Object.defineProperty`, then immediately calls it. The backport passes node, index
and ancestors to one recursive function per traversal. The body, ancestor array allocation,
matching, ordering, mutation behavior and action/index propagation remain unchanged. Each
traversal invocation retains its own visitor, predicate and direction, including reentrant
walks. Neither a callback nor consumer receives the internal traversal function.

**Observable diagnostic change:** stack traces use the shared `visit` function instead of
per-node decorated names. Removing those names also omits reads of `tagName`/`name` used
only for that decoration. Manuslip supplies ordinary parser/HAST data trees; accessor
side effects on externally supplied JavaScript nodes are outside this application contract.
Exceptions still propagate unchanged. This is a local performance patch, not a claim of
byte-identical error stacks or an upstream release.

An independent preorder oracle covers 600 seeded trees with early exit, skip and explicit
sibling indices. Tests cover forward/reverse order, filtered visitor overloads and predicate
arguments, retained ancestors, insertion/removal during callbacks, traversal of a removed
node's children, reentrancy and exception propagation. Isolated installation tests execute
the actual script against original and patched sources, missing-patch checks, CRLF,
idempotence, unknown versions/content and no replacement on failure.

Complete fresh-parser/renderer comparisons and Electron producer measurements are recorded
in `docs/validation/implementation-history.md`. Reduced cumulative allocation is not a simultaneous physical peak
bound. Packed transport, existing admission limits and full application acceptance remain
separate requirements.
