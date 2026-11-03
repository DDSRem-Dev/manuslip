# History reorganization — 2026-11-04

All 12 original submissions were amended in their existing chronological order, from the
first governance commit through the latest desktop implementation. Each revision contains
the documentation and test layout appropriate to its own files and features. The authors,
committers, author and commit dates, messages, and linear parent order are preserved.
Rewriting a tree or parent changes its commit ID.

## Changes applied to each relevant revision

Documentation uses topic directories and kebab-case filenames under `docs/`, with a
revision-specific index. Root community documents and GitHub templates retain their
standard discovery names; upstream licenses remain beside their assets. Documentation
links resolve within the revision where they appear.

Unit tests live in their owning package's `test/unit/`; desktop native integration uses
`apps/desktop/test/integration/`. Correctness workflows, benchmarks and packaging or
installer checks use `test/e2e/`, `test/benchmark/` and `test/packaging/`. The typing
measurement is a benchmark. Parser installation and upgrade checks are separated from
parser unit behavior, with all original test and assertion call structure retained.

Imports, fixtures, runners, TypeScript inputs, CI, cleanup and documentation commands use
the classified paths. Ignored output belongs to the owning test suite, with shared logs
and profiles under `test/artifacts/logs/`. Existing local logs, benchmark runs, installer
evidence and e2e output were migrated; 1,039 useless UUID metadata files were removed.
No UUID metadata remains in the source tree or any rewritten commit.

Impeccable metadata and screenshots are excluded from every rewritten revision. Their
local directory is ignored and has the Windows Hidden attribute. The useful workspace
design and navigation review are published under `docs/design/` and `docs/reviews/`.

Every production source blob retains its original Git object ID at the corresponding
revision. The test-only translation fixture was relocated. The CommonMark corpus and
license are byte-identical. Test inventories preserve each original revision's cases,
including historical cases and features that later commits removed or replaced.

## Commit-by-commit verification

| Original commit | Submission | Unit result on Windows | Layout and links |
| --- | --- | --- | --- |
| `fb752b2` | docs: add project governance and contribution guides | No application tests at this revision | Passed |
| `8ba46fe` | chore: add repository tooling and formatting configuration | No application tests at this revision | Passed |
| `8397413` | chore: extend gitignore for OS, IDE, and build artifacts | No application tests at this revision | Passed |
| `54e12a8` | ci: add dependency updates and continuous integration | No application tests at this revision | Passed |
| `43e5cf2` | docs: add GitHub issue and pull request templates | No application tests at this revision | Passed |
| `c2cda34` | docs: document Node 24 prerequisite and link project policies | No application tests at this revision | Passed |
| `a23f768` | docs: finalize tech stack decisions | No application tests at this revision | Passed |
| `422ce03` | feat: implement Manuslip desktop editor and rendering pipeline | 247 unit files; 19,890 cases passed, one skipped | Passed |
| `ba0442d` | feat: polish markdown render logic and settings | 252 unit files; 19,936 cases passed, one skipped | Passed |
| `70e1fe0` | feat: improve workspace navigation and live folder updates | 252 unit files; 19,946 cases passed, one skipped | Passed |
| `b66d15f` | feat: expand markdown conventions and editor rendering | 264 unit files; 21,414 cases passed, one skipped | Passed |
| `4ca2f6b` | feat: improve live Markdown editing and document rendering | 267 unit files; 21,445 cases passed, one skipped | Passed |

For each of the five application revisions, an isolated checkout passed `npm run check`,
all unit, integration and packaging suites, e2e and benchmark discovery, `build:app`,
and the built Electron shell test. Each checkout used its own workspace packages and
the parser patch from that revision, with private copies of patched dependencies.
Packaging included dependency installation and upgrade assertions, fresh-process parser
comparisons, and four Node release cases. Five Linux launcher cases were skipped on
Windows. Native integration passed its child-process case; 12 optional real-Pandoc cases
were skipped. Hardware-dependent benchmark budgets were not rerun.

Commit `70e1fe0` had a stale strict preload-bridge expectation: `closeWorkspace`
and `onWorkspaceChanged` already existed there, but its shell test learned those names
only in the next original commit. The original test and helper reproduced the failure.
The expectation is now patched into the revision that introduced those methods, and
its Electron shell test passes with the exact bridge comparison retained.

The final suite discovers 259 correctness cases in 76 specs and eight benchmark cases.
The earlier [layout validation](repository-layout.md) records installer validation,
diagnostic lifetime probes, and the known Unicode footnote e2e failure reproduced with
the original test and fixtures. That application assertion remains enabled.

## Recovery and evidence

The original branch and pending work are retained locally under
`refs/backup/docs-tests-layout/original-main` and
`refs/backup/docs-tests-layout/working-tree`. The old-to-new commit map, per-revision
static audits, runtime summaries and command logs are retained under
`test/artifacts/history/`. These recovery refs and machine artifacts are local. The
rewritten branch has not been pushed.

Use the [testing guide](../testing/testing.md) for commands and the
[repository layout policy](../development/repository-layout.md) for future changes.
