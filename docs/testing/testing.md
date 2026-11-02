# Tests and validation

Use the Node/npm versions pinned by `.nvmrc` and `package.json`, then run `npm ci`.
Run every command below from the repository root.

## Test ownership

| Kind | Location | Runner |
| --- | --- | --- |
| Desktop unit tests | `apps/desktop/test/unit/`, mirroring `src/` | Vitest project `desktop` |
| Library unit tests | `packages/<package>/test/unit/` | Vitest projects `core`, `editor`, `renderer`, `translate` |
| Native process and optional Pandoc integration | `apps/desktop/test/integration/` | Vitest project `desktop-integration` |
| Desktop end-to-end tests | `test/e2e/` | Playwright, `test/e2e/playwright.config.ts` |
| Benchmarks and profilers | `test/benchmark/`, `test/benchmark/profiles/` | Playwright, `test/benchmark/playwright.config.ts`; Node diagnostic drivers |
| Packaging, dependency patch installation and release tests | `test/packaging/` | Vitest project `packaging` and Node's test runner |
| Packaged app and Windows installer verification | `test/packaging/` | Explicit launcher and installer drivers |

Keep unit tests out of production `src/` directories. Name them `*.test.ts` and keep
their fixtures within the owning package's `test/fixtures/`. The official CommonMark
corpus is shared from `packages/core/test/fixtures/`; its license stays with the data.
Browser workflows use `*.spec.ts`. Node packaging tests use `*.test.mjs`.
Write e2e screenshots and exported samples through `test.info().outputPath()` so each test
and retry owns its evidence under the configured results directory.
Helpers and fixtures live with the suite that owns them. `test/helpers/` contains the
packaged executable selector shared by the benchmark and packaging runners.

Each Vitest project selects its own files explicitly. `npm test` runs all Vitest projects,
including native integration and patch installation checks. Tests using a real Pandoc
binary run only when `MANUSLIP_TEST_PANDOC` points to that executable. Unit fixtures use
temporary directories and clean up after themselves; the Windows inherited-ACL check
uses an ignored directory on the workspace volume.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Lint, repository layout and links, dependency patch guards, formatting, TypeScript |
| `npm test` | All Vitest projects |
| `npm run test:unit` | The five package unit projects |
| `npm test -- --project core` | One package's tests; substitute its project name |
| `npm run test:integration` | Native child-process and optional Pandoc tests |
| `npm run test:packaging` | Patch installation tests, release plans and platform-gated Linux launcher checks |
| `npm run build:app` | Build application assets for correctness e2e |
| `npm run test:e2e` | Correctness e2e against those assets |
| `npm run build` | Build application assets and local unsigned installers |
| `npm run test:packaged` | Reuse correctness e2e against the unpacked package |
| `npm run test:installer` | Windows install, installed-app verification and uninstall |
| `npm run test:performance` | Packaged hardware-dependent benchmark gates |
| `npm run test:performance -- --profile` | Diagnostic CPU/timeline capture |

Add `-- --list` to a Playwright runner to inspect discovery. Set
`MANUSLIP_PACKAGED_EXECUTABLE` to select an alternative executable for correctness e2e.
The packaged and performance drivers select the native build under `apps/desktop/release/`.
Use Xvfb for desktop runs on headless Linux. Benchmarks run serially on a reference machine
without competing builds or tests; see [benchmark methods](benchmarks.md) for budgets,
profilers and known limits. Passing correctness tests does not establish performance budgets.

SSR diagnostic drivers disable Vite's automatic HTML entry discovery so archived HTML
under the artifact directories is not crawled or optimized as application input.

Windows installer verification requires a clean account without Manuslip installed or
running. It uses a per-user temporary installation, verifies registration and exact saved
bytes, then uninstalls and checks the original OS state. See [distribution](../development/distribution.md).

## Artifacts and cleanup

| Evidence | Ignored location |
| --- | --- |
| Correctness traces, attachments and last-run state | `test/e2e/results/` |
| Optional e2e HTML report | `test/e2e/report/` |
| Benchmark reports and traces | `test/benchmark/results/<run-id>/` |
| Installer reports, screenshots and release candidates | `test/packaging/results/` |
| Diagnostic logs, CPU/heap profiles and archived evidence | `test/artifacts/logs/` |
| Package fixtures requiring the workspace volume | `<workspace>/test/artifacts/` |

Existing root logs and benchmark/e2e results have moved to these directories. Historical
files retain their recorded contents and bundle hashes. New evidence uses the same paths;
do not recreate root `.logs/`, `benchmark-results/` or `test-results/` directories. UUID
metadata files have no repository purpose and should be removed.

`npm run clean` removes build output and these generated test directories, including
archived evidence. Copy any evidence you need before cleaning. Source tests, fixtures,
licenses and documentation remain available.

CI checks the repository and all Vitest projects, runs packaging checks, and builds once
per OS/architecture. A separate job reuses the archived build for correctness and packaged
e2e, with Windows installer evidence uploaded from `test/packaging/results/windows-installer-*/`.
Benchmark gates and physical OS/IME/accessibility acceptance remain explicit platform runs.
Record results and remaining acceptance work in the
[validation history](../validation/implementation-history.md).
