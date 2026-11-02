# Preserve micromark's untouched event prefix

`scripts/patch-micromark-edit-map.mjs` applies one local backport to
`micromark-util-edit-map@1.0.0` during the root `postinstall`. Lint and desktop builds verify
both exports before proceeding. Package version and normalized LF SHA-256 checks accept
only the original or the reviewed patched source. Already patched installs are idempotent;
unknown versions/content require explicit review. Both files are validated before either is
written, and interruption between writes can be repaired by rerunning installation.

Upstream: <https://github.com/micromark/micromark/tree/main/packages/micromark-util-edit-map>.
The installed package's MIT license and copyright remain intact; no dependency version changes.
The patch covers `index.js` and `dev/index.js` because build/test resolution can select either.

`EditMap.consume()` sorts edits and saves their changed suffixes while truncating the original
event array to the first edited index. Upstream then copies that untouched prefix, clears the
array and pushes every element back. The patch keeps the prefix in place and replays the same
suffix vectors. Event order, array/event identity, overlapping removals, accumulated additions,
`addBefore`, and clearing/reuse remain the same for the parser's dense event arrays. Sparse
arrays containing holes are outside this parser contract. No tokenizer, grammar, source range
or mdast compilation policy is changed.

The nested corpus causes 6,298 consume operations. The original prefix replay handles about
357.5 million elements; preserving the prefixes reduces replay to 37,788 elements in the
diagnostic. This removes repeated copying of all earlier containers as each new container
closes. Whole-document parsing and its other allocations still require memory admission and
performance acceptance; this patch does not activate packed transport or incremental parsing.

Verification includes an independent copy of the original suffix/prefix replay semantics,
randomized edits, collisions at the same index, overlap, dense arrays above the argument-count
limit, cleared-map reuse, all CommonMark cases and a separate archived-parser comparison.
Current runtime measurements and remaining gates are recorded in `docs/validation/implementation-history.md`.

| Export | Original SHA-256 | Patched SHA-256 |
| --- | --- | --- |
| `index.js` | `0a29b60e6299a7b17e57e3c185014ad9bfe5a0ad6fd1365ce14605d6d299cbf0` | `408969817f19a85e70fe86ec0d850d9398c128bbe4f9b6f093fa10228b24df67` |
| `dev/index.js` | `98048a86eeaf5d5b9c85715c124bd5865685a964cabe2a77e5039bf11d987017` | `d498191cc0fbd7e152e56704d7f2878703f28cae681b42312b2b3e9cfe9c4118` |
