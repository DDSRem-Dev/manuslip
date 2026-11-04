# ADR 004: Keep preload contracts independent of Markdown parsers

Status: Accepted.

## Context

The sandboxed preload needs settings, provider metadata and payload validation. Importing
them through parser-bearing package roots also initializes Markdown dependencies that the
bridge does not use. A narrow API alone does not prevent an unnecessarily broad runtime graph.

## Decision

Expose `@manuslip/translate/transport` for transport types, metadata and validators.
Shared translation and reading-export contracts use that entry point. Modules needing only
byte counting use `@manuslip/core/text`; AST types use type-only imports.

Re-export existing implementations so entry points share validator behavior and identity.
Keep parsing, extraction and reconstruction available through their existing public roots.
The preload build rejects emitted core parser/compiler, micromark, unified and
mdast-util-from-markdown modules, including paths with Windows separators.

## Alternatives and consequences

Importing a broad root and relying on tree shaking leaves the boundary dependent on
initializers and bundler behavior. Duplicating validators risks divergent IPC rules.
Explicit entry points plus a build guard make the intended runtime boundary checkable.

Preserve these imports when extending shared contracts. This decision changes dependency
ownership; it does not alter bridge permissions, parser semantics or resource caps.
See the [preload build guard](../../apps/desktop/electron.vite.config.ts) and
[architecture guide](../architecture/desktop.md).
