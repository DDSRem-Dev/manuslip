# Pinned dependency patches

Root `postinstall` applies the local patches below. Lint and application builds run their
`--check` guards. Each script validates pinned versions and complete normalized-LF source
hashes before writing; unknown content fails instead of being overwritten. Repeated and
known partial installs are supported. After an interrupted install, rerun `npm install`.
Keep upstream licenses and notices with the installed packages.

| Script under `scripts/` | Pinned dependency | Purpose |
| --- | --- | --- |
| `patch-micromark-edit-map.mjs` | `micromark-util-edit-map@1.0.0` | Preserve untouched event prefixes while replaying changed suffixes |
| `patch-unist-visit.mjs` | `unist-util-visit-parents@6.0.2` | Reuse a traversal function instead of allocating one per node |
| `patch-parser-lifetimes.mjs` | `micromark@4.0.3`, `mdast-util-from-markdown@2.1.0` | Release completed tokenizer state and provide private span/cooperative compiler paths |
| `patch-micromark-replay.mjs` | `micromark-util-subtokenize@2.1.0` | Copy resolved events into the original array without splice scratch |
| `patch-definition-list.mjs` | `micromark-extension-definition-list@2.0.2` | Preserve colon-prefixed GFM table rows and definitions nested in lists |

Original, accepted predecessor and patched hashes are maintained in the scripts. Both
default and development exports must be patched where they have separate implementations.
These are local changes to [micromark](https://github.com/micromark/micromark),
[mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown),
[unist-util-visit-parents](https://github.com/syntax-tree/unist-util-visit-parents) and
[definition lists](https://github.com/wataru-chocola/micromark-extension-definition-list).

## Contracts to preserve

Event patches preserve dense mutable parser arrays, event identity/order, token coordinates
and complete public contexts. Proxy/accessor arrays, custom species and overridden intrinsics
are outside that contract. The traversal patch preserves order, filtering, mutations,
reentrancy and action propagation; stack traces use a shared function name and omit reads
used only to decorate old debug names.

The lifetime patch pairs a source-only serializer with private compiler contexts. Public
micromark contexts stay complete. `_manuslipEventSpans` and cooperative compiler paths keep
one full-document parse, shared definitions, compiler context and whole-root transforms.
Span boundaries must respect forward-linked flow chains as well as balanced depth. Lists,
extension listeners and transforms must retain their original behavior. One container can
still span the whole input; batching does not establish a physical memory bound.

The private paths assume the application's pinned extension set. Adding or upgrading an
extension requires checking cross-span dependencies against the general compiler. The
definition-list patch admits tentative table headers as terms while preserving committed
table rows and list indentation. Strict CommonMark remains independent of these extensions.

## Verification

```sh
npm run lint
npm run test:packaging
npm test -- --project core --project editor --project renderer --project translate
```

Packaging tests execute the actual installers against original, patched, partial, CRLF,
unknown-version and unknown-content inputs. The parser equivalence helper runs fresh
original/patched processes under both export conditions and compares complete roots,
metadata, renders and public events. Core tests cover cancellation, cleanup, extension
semantics and the pinned CommonMark corpus. Run these checks whenever patch sources or
parser dependencies change; update hashes only after reviewing the changed upstream source.
