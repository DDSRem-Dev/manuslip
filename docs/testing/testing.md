# Testing

Use the Node/npm versions pinned by `.nvmrc` and `package.json`, then run `npm ci`.
Run commands from the repository root.

| Suite | Location | Command |
| --- | --- | --- |
| Desktop/library unit tests | `apps/desktop/test/unit/`, `packages/*/test/unit/` | `npm run test:unit` |
| Native child processes and optional Pandoc | `apps/desktop/test/integration/` | `npm run test:integration` |
| Patch installation/equivalence, release and Linux launcher | `test/packaging/` | `npm run test:packaging` |
| Desktop workflows | `test/e2e/` | `npm run build:app`, then `npm run test:e2e` |
| Packaged workflows | `test/e2e/` | `npm run build`, then `npm run test:packaged` |
| Performance and resource gates | `test/benchmark/` | `npm run test:performance` |

`npm run check` covers lint, repository layout/local links, runtime boundaries,
dependency patch guards, formatting and types. `npm test` runs all Vitest projects,
including native integration and parser patch equivalence.

## Focused runs and fixtures

```sh
npm test -- --project core
npx vitest run packages/editor/test/unit/replace.test.ts
npm run test:e2e -- test/e2e/files.spec.ts
npm run test:e2e -- --list
```

Unit files use `*.test.ts`; browser workflows use `*.spec.ts`; Node packaging tests use
`*.test.mjs`. Keep fixtures with their owning suite. `test/helpers/` contains the shared
packaged-executable selector. Tests use isolated profiles and temporary files. Set
`MANUSLIP_PACKAGED_EXECUTABLE` to select another executable for desktop workflows.
Headless Linux Electron tests need Xvfb.

Set `MANUSLIP_TEST_PANDOC` to a trusted local Pandoc 3 executable to include real conversion
cases; they explicitly skip without it. Tests otherwise use local fake providers and dummy
keys. Paid translation accounts are not required.

The unmodified [CommonMark 0.31.2 corpus](../../packages/core/test/fixtures/commonmark-0.31.2/spec.json)
contains all 652 official examples from <https://spec.commonmark.org/0.31.2/spec.json>.
It is copyright John MacFarlane, CC-BY-SA 4.0; retain its adjacent `LICENSE`.
Tests compare normalized parser HTML, shared renderer structure and editor integration.
Application URL/HTML restrictions and Markdown extensions have separate checks. This data
is not bundled in the app.

## Performance gates

Build with `npm run build`, or `npm run build:app` followed by `npm run package:dir`.
Run benchmarks serially on a reference machine without competing builds or tests:

```sh
npm run test:performance
npm run test:performance -- --case single-paragraph --grep corpus
npm run test:performance -- --grep retained
npm run test:performance -- --grep "exact 50 MiB"
```

The runner selects the packaged executable for the current OS/architecture. Specs enforce
input/rendering latency, request backpressure, resource retention, cold widgets and exact
source-size boundaries. Budget assertions live beside their measurement methods in the
specs. Reports identify the hardware, runtime and executable/ASAR hashes. Input-to-frame
measurements estimate browser frame timing, not physical display presentation. Passing
correctness tests alone does not establish these hardware-dependent budgets.

Keep automated performance checks tied to explicit assertions. Use DevTools for exploratory
profiles; keep measurement-only specs and historical benchmark baselines out of test suites.

## Outputs and CI

| Output | Ignored location |
| --- | --- |
| E2E failures, traces and exports | `test/e2e/result/` |
| Benchmark runs and reports | `test/benchmark/result/<run-id>/` |
| Installer/release output | `test/packaging/result/` |
| Workspace-volume unit fixtures | `apps/desktop/test/unit/result/` |
| Native process fixtures | `apps/desktop/test/integration/result/` |

Use `test.info().outputPath()` for browser attachments so retries own their output.
Temporary inputs should be cleaned up by their tests. `npm run clean` removes build
output and generated result directories.

CI checks source and unit/integration/packaging suites, then builds on Windows x64,
Linux x64 and macOS x64/arm64. E2E jobs reuse the archived builds for built/packaged tests.
Windows additionally runs `npm run test:installer` in a clean account, checking install,
exact saved bytes, restart and uninstall restoration. See [distribution](../development/distribution.md).
Performance budgets and physical OS/IME/assistive-technology behavior require separate runs.
