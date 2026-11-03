# Repository layout validation — 2026-11-04

Documentation now lives in topic directories under `docs/` with kebab-case filenames.
The [documentation index](../overview/index.md) links guides, design and product documents,
architecture decisions, dependency patch provenance, reviews and validation history.
Community entry points keep their standard root names, and upstream licenses stay with
their assets. Earlier submissions remain in the
[chronological implementation record](implementation-history.md).

Unit tests now live in their owning workspace's `test/unit/`; real native process/Pandoc
integration lives in `apps/desktop/test/integration/`. Correctness e2e, benchmarks and
packaging/installer checks live in `test/e2e/`, `test/benchmark/` and `test/packaging/`.
Vitest projects select each suite explicitly. Dependency installation checks were separated
from parser unit assertions. The shared CommonMark corpus and license moved into
`packages/core/test/fixtures/` without changing a byte.

Existing logs moved to `test/artifacts/logs/`, benchmark runs to `test/benchmark/results/`,
and installer/release evidence to `test/packaging/results/`. E2e screenshots and exported
samples now use `test.info().outputPath()` so they follow the configured output directory
and stay separate for each test and retry. The migration removed 1,039 UUID metadata files.
CI, scripts, TypeScript inputs, ignore rules and cleanup use the new paths.

Two diagnostic corrections were verified during the migration. Vite SSR drivers disable
automatic HTML entry discovery, which otherwise crawls archived HTML after moving logs
into the visible test tree. The packed extraction lifetime probe now instruments the
current native record and position construction sites. Its collection assertions remain
enabled. Production parser patch helpers stay in `scripts/`, where the installer needs them.

## Verification

| Check | Observed result on Windows |
| --- | --- |
| `npm run check` | Passed lint, layout/local links, runtime boundaries, patch guards, formatting and TypeScript; existing CSS specificity warning and literal-key suggestions remain |
| Unit projects | 267 files covered: 21,445 passed, one skipped; includes the separately verified eight native-object codec cases |
| `npm run test:integration` | One native child-process case passed; 12 optional real-Pandoc cases skipped |
| `npm run test:packaging` | All 35 Vitest installation cases and four Node release cases passed; five Linux-only launcher cases skipped |
| Default Vitest discovery | All 272 current test files discovered, with no omissions |
| E2e and packaged discovery | All 259 cases across 76 specs discovered |
| Benchmark discovery | All eight benchmark cases discovered, including the typing measurement moved from e2e; hardware-dependent budgets were not rerun |
| `npm run build:app` | Passed |
| Focused built Electron tests | 24 of 25 passed across CommonMark, shell, indexed reading and widget lifetime |
| Packaged shell | Passed after moving its screenshots into the test output directory |
| `npm run test:installer` | Install, installed editing/restart, hashes, native icons, registration and uninstall/restoration passed |
| Parser comparison driver | Both lifetime and replay comparisons matched 1,642 complete document digests per process across default/development and original/patched sources; replay also checks raw events |
| Packed extraction lifetime driver | All 33 probes collected their released native resources |
| Layout guard negative probes | Rejected misplaced documentation/tests, broken local links and UUID metadata |
| Migration inventory | Every original tracked file accounted for; CommonMark fixture data and license byte-identical |
| Test structure inventory | AST comparison across all 355 original unit/e2e/benchmark files preserved test and assertion call structure, including the split parser installation checks |

## Existing Unicode footnote failure

The indexed-reading case “Unicode footnote links reach offscreen definitions and return
within indexed and native language copies” still fails because the original-language
footnote backlink remains hidden after following the reference. The original test and
all original reading-memory fixtures from commit `4ca2f6b` reproduce the same assertion
failure; only their diagnostic output paths were changed for that comparison. Its other
two indexed-reading cases passed. This is an existing application behavior, and the
assertion remains enabled in the moved suite.

Local evidence is retained under `test/artifacts/logs/layout-*`, including the baseline
test/fixture hashes, original-run failure log and layout check output. Installer evidence
is in `test/packaging/results/windows-installer-bbec68ed-de36-49bb-8908-f15aaaec1971/report.json`.
These machine artifacts are ignored; this record and the [testing guide](../testing/testing.md)
describe the reproducible commands and limits.
