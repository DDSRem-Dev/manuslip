# Architectural decisions

ADRs preserve why the architecture takes its current shape and the constraints future
changes must respect. Read the [architecture guide](../architecture/desktop.md) for the
current system, then the relevant decision before changing its boundary or behavior.

| ADR | Decision | Status |
| --- | --- | --- |
| [001](001-initial-implementation-plan.md) | Local-first editor foundation | Superseded by 002 |
| [002](002-implementation-plan.md) | Source-owned documents and bounded services | Accepted |
| [003](003-semantic-snapshot-packing.md) | Owned snapshots and staged packed transport | Experimental transport; local preview integrated |
| [004](004-preload-contract-dependencies.md) | Parser-independent preload contracts | Accepted |
| [005](005-writing-modes.md) | Focus/typewriter retirement | Retired |
| [006](006-extended-markdown.md) | Positioned Markdown extensions and shared rendering | Accepted |
| [007](007-visual-tables.md) | Source-preserving table transactions | Accepted |
| [008](008-document-appearance.md) | Scoped typography and restricted CSS | Accepted |
| [009](009-presentation-image-export.md) | Captured snapshots for slides and images | Accepted |
| [010](010-optional-pandoc.md) | Optional, explicitly selected Pandoc | Accepted |
| [011](011-local-command-plugins.md) | Versioned commands in isolated plugin hosts | Accepted |
| [012](012-explicit-file-sync.md) | Explicit sync with durable recovery | Accepted |
| [013](013-local-distribution.md) | Separate packaging, signing and publication | Accepted |

## Maintaining decisions

Keep one substantial architectural choice per numbered record. Preserve existing IDs and
filenames so references stay valid. Each record states its status, context, decision,
alternatives and consequences, with links to current code or guides. Add an ADR when a
change affects ownership, process/trust boundaries, document semantics, persistence,
public contracts or a significant implementation strategy.

Use Proposed, Accepted, Experimental, Superseded or Retired deliberately. Acceptance records
the design choice; it does not certify every platform or performance target. Experimental
records must say what is active and what remains disabled. Keep superseded/retired records
short and link replacements or migration behavior so obsolete guidance is recognizable.

Clarify an existing record when its decision is unchanged. A material change to an accepted
decision gets a new numbered ADR linked in both directions; update this index and the current
architecture/usage guides in the same change. Keep numeric limits in authoritative source
and operational commands in guides. Keep temporary plans, review transcripts, benchmark run
logs and implementation journals out of ADRs.
