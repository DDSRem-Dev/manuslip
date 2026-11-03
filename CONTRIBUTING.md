# Contributing to Manuslip

Thanks for taking a look. Manuslip is an early-stage, local-first Markdown editor built on Electron, React, CodeMirror, and a Markdown source document with an mdast semantic projection. Early development is the best time to shape direction, so design feedback, provider integrations, UI translations, and bug reports all matter as much as code.

Two documents sit next to this one and apply to every contribution: the [Code of Conduct](CODE_OF_CONDUCT.md) and the [Security Policy](SECURITY.md). Read both before you open an issue or a pull request.

Large changes should start as an issue. That includes new packages, new IPC channels, changes to the document model, and anything that touches the translation provider interface.

## Before you start

- Search open and closed issues and pull requests for the same problem. Someone may already be working on it.
- Open an issue for anything larger than a small fix. A typo correction or a one-line bug fix can go straight to a pull request.
- Discuss API and UX changes before writing code. The AST shape, the preload bridge, the provider interface, and the three rendering modes are all load-bearing, and a short conversation up front saves a rewrite later.

## Prerequisites

- **Node.js 24 LTS**, pinned in `.nvmrc`. Run `nvm use` or `fnm use` from the repository root before installing anything.
- **npm 11**, which ships with Node 24. npm workspaces is the only supported package manager. Do not add a pnpm or Yarn lockfile. Commit the generated `package-lock.json`; CI installs from it with `npm ci`.
- **Git**. Commit signing is not required. DCO sign-off is required, and it is covered under [Commit conventions](#commit-conventions).

Native modules need a platform toolchain. `@parcel/watcher` ships prebuilt binaries for supported platforms and compiles during `npm install` elsewhere. The root `postinstall` runs `electron-builder install-app-deps`, so Electron ABI rebuilds are not a manual step.

The root `postinstall` also installs Electron and applies the pinned
[`micromark-util-edit-map` backport](docs/patches/micromark-edit-map.md) and
[`unist-util-visit-parents` backport](docs/patches/unist-visit.md). Lint and desktop builds
verify the patched sources. After an interrupted install, rerun `npm install`; an unknown
dependency version or modified source requires reviewing the patch instead of skipping its guard.

| Platform | What you need |
| --- | --- |
| macOS | Xcode Command Line Tools: `xcode-select --install` |
| Windows | Visual Studio Build Tools with the "Desktop development with C++" workload, plus Python 3 on `PATH` |
| Linux | `build-essential` and `python3` from your distribution |

## Repository layout

The repository is an npm workspaces monorepo. Detailed documentation lives in
`docs/<topic>/` with lowercase kebab-case filenames; start at the [documentation index](docs/overview/index.md).

| Path | Responsibility |
| --- | --- |
| `apps/desktop` | Electron app: main process, preload bridge, windows, menus, packaging, and auto-update |
| `packages/core` | Markdown document model, block hashing, block splitting, document operations, and the mdast semantic projection |
| `packages/editor` | CodeMirror 6 setup, keymaps, and live-preview decorations |
| `packages/renderer` | mdast to sanitized HTML, including MathJax, Mermaid, and code highlighting |
| `packages/translate` | Provider interface, block cache, glossary, and batching |
| `docs/<topic>/` | Guides, architecture decisions, reviews, patch provenance and validation history |
| `apps/desktop/test/`, `packages/*/test/` | Unit tests, native integration tests and fixtures owned by each workspace |
| `test/e2e/` | Correctness workflows in the Electron app |
| `test/benchmark/` | Performance gates, profilers and their fixtures |
| `test/packaging/` | Dependency patch installation, release, launcher and installer checks |

## Getting started

```bash
git clone https://github.com/<your-org>/manuslip.git
cd manuslip
npm ci
npm run dev
```

**Current state:** the desktop app includes editing, file recovery, workspaces, export,
translation, plugins and explicit sync. See the [feature availability review](docs/reviews/feature-availability-review.md)
for supported flows, the [testing guide](docs/testing/testing.md) for current commands,
and the [validation history](docs/validation/implementation-history.md) for evidence and platform gaps.

## Root scripts

These scripts are the contract for local development and CI. They live in the workspace root.

| Script | What it does | Runs in CI |
| --- | --- | --- |
| `npm run dev` | Starts electron-vite in development mode, with renderer HMR and live main/preload reload. | No |
| `npm run build` | Builds the desktop app and produces installers through electron-builder. | Yes |
| `npm run icons` | Regenerates platform application icons from the shared SVG. `npm run icons -- --check` verifies their source/version/hash manifest; application builds run this check automatically. See [Application icons](docs/development/application-icons.md). | Check during build |
| `npm run check` | Runs lint, format check, and typecheck in sequence. This is the pre-push gate. | Yes |
| `npm run lint` | Runs Biome lint, layout/link checks, runtime boundaries and dependency patch guards. | Via `check` |
| `npm run check:layout` | Checks documentation names and links, test ownership and obsolete output paths. | Via `check` |
| `npm run format` | Runs Biome format and writes fixes in place. | No |
| `npm run format:check` | Runs Biome format checks without writing; used by `check`. | No |
| `npm run typecheck` | Runs the TypeScript compiler in no-emit mode across the workspaces. | No |
| `npm test` | Runs all Vitest projects: package unit tests, native integration and dependency patch installation. | Yes |
| `npm run test:unit` | Runs only the five package unit projects. | Via `npm test` |
| `npm run test:integration` | Runs native child-process and optional local Pandoc checks. | Via `npm test` |
| `npm run test:packaging` | Runs patch installation, release-plan and platform-gated Linux launcher tests. | Yes |
| `npm run test:e2e` | Runs Playwright end-to-end tests against an existing Electron build. | Dedicated three-OS E2E job, built and packaged launch |
| `npm run test:installer` | Installs the built Windows NSIS package, verifies installed editing and exact saved bytes, then uninstalls and checks restored OS registration. Requires a clean account without Manuslip installed or running. | Windows E2E job |
| `npm run test:performance` | Runs the hardware-dependent packaged corpus, cold-widget, stress and retained-resource gates. | No; manual reference-machine gate |
| `npm run clean` | Removes build output and local caches. | No |

Run `npm run build:app` before `npm run test:e2e`; the tests reuse its output. Run `npm run test:packaged` after `npm run build` for unpacked package testing. `MANUSLIP_PACKAGED_EXECUTABLE` can select a custom executable. Tests use temporary user-data directories and never the writing profile. The verify matrix builds installers once; a dedicated E2E matrix downloads and reuses the archived assets for built and packaged launch checks. Linux uses Xvfb, and macOS covers x64 and arm64 separately. No signing or publishing credentials are needed.

On Windows, `npm run test:installer` reuses the NSIS installer and unpacked files from
`npm run build`. It uses a fresh directory under ignored `test/packaging/results/`, an isolated writing
profile, and per-user installation. It checks runtime hashes, shortcuts, Open With
registration, unchanged file defaults, exact BOM/CRLF/Unicode saving and restart, then
uninstalls and compares registration state with the baseline. Reports and screenshots
remain under `/test/packaging/results/windows-installer-*/`; CI uploads them even when verification fails.
Wizard interaction, elevation, the native Open With chooser and physical IME/accessibility
checks remain separate platform acceptance work.

Performance runs use the platform's packaged executable produced by `npm run build` (or
`build:app` followed by `package:dir`). Run them without competing test/build jobs. Reports
record hardware, runtime and executable/ASAR hashes in distinct ignored `test/benchmark/results/`
run directories. `npm run test:performance -- --case single-paragraph --grep corpus` isolates
one corpus shape; `--profile` captures renderer CPU/timeline data for that case. The full corpus
currently has known failures; see [benchmark methods](docs/testing/benchmarks.md) and the latest
[validation record](docs/validation/implementation-history.md). Passing correctness E2E does not pass these budgets.

## Architecture rules you must not break

These are not style preferences. Each one protects a property the product depends on.

- **One mdast AST, three projections.** Source, Live Preview, and Translated Preview all read from the same document model. Never keep parallel copies of document text, and never let a view own its own parse.
- **The renderer stays sandboxed.** All filesystem and OS access goes through the typed preload bridge. No `nodeIntegration`, no `enableRemoteModule`, and no direct `ipcRenderer` use inside React components.
- **Parsing and rendering stay off the critical path.** Lezer handles incremental editor syntax. Unified/remark parses the whole document in the semantic worker (one running request, one latest pending); never splice independently parsed blocks into the semantic root. Keep global references intact, bound all derived caches, and reject stale generation/revision/configuration results. DOM sinks must sanitize render output.
- **Sanitize everything you render.** All HTML passes through the sanitizer with the project's DOMPurify configuration. Never call `dangerouslySetInnerHTML` with untrusted markup that skipped that step.
- **Translation is AST-level.** Never translate code blocks, inline code, math, URLs, frontmatter, or Mermaid source. Only translatable nodes go to a provider.

## Coding standards

- TypeScript strict mode. No `as any`, no `@ts-ignore`, and no `@ts-expect-error` to silence a real error. Fix the type or narrow the value.
- Biome is the single formatter and linter: 2-space indentation, single quotes, no semicolons, LF line endings, 100-column width. Run `npm run check` before pushing. Do not hand-format around the tool.
- Prefer named exports, pure functions inside `packages`, and explicit return types on exported APIs.
- Keep process boundaries typed. IPC channel names are shared constants, and every payload is validated at the boundary before it reaches main-process code.

## Commit conventions

Manuslip uses [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, `revert`.

Allowed scopes: `desktop`, `core`, `editor`, `renderer`, `translate`, `ui`, `deps`, `ci`, `docs`. Omit the scope when a change cuts across packages.

Subjects are imperative, lowercase, and have no trailing period:

```text
feat(editor): add inline math decorations
fix(core): invalidate parse cache on file reload
perf(renderer): reuse sanitized HTML for unchanged blocks
docs(translate): describe provider capability flags
```

Mark a breaking change with `!` after the type or scope, and explain it in a footer:

```text
feat(translate)!: require explicit provider capabilities

BREAKING CHANGE: custom providers must now declare which content types they accept.
```

Keep one logical change per commit, and keep every commit buildable. A commit that only exists to fix the previous commit should be squashed before review.

**DCO:** every commit must be signed off with `git commit -s`, which adds a `Signed-off-by` trailer. The sign-off certifies that you wrote the contribution or otherwise have the right to submit it, and that you agree to the Developer Certificate of Origin for this project.

## Branching and pull requests

Manuslip uses trunk-based development. Branch from `main`, keep branches short-lived, and rebase rather than merge `main` into your branch.

Branch name prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, `test/`.

- The pull request title must be a valid Conventional Commit subject, because pull requests are squash-merged and the title becomes the commit.
- Fill in the repository's pull request template. Don't delete the sections you think don't apply; write "not applicable" instead.
- Keep the pull request focused. Split unrelated cleanups into their own change.
- Include screenshots or a short recording for UI changes, and note before and after behavior for performance work.
- CI must be green: `npm run check`, `npm test`, and `npm run build`. A maintainer review is required before merge.

## Testing expectations

- Unit tests use Vitest under the owning workspace's `test/unit/` directory as `*.test.ts`.
- Parser and renderer changes need CommonMark or GFM fixtures plus cache-invalidation cases. A cache that returns stale HTML is a bug, not a speedup.
- UI flows and Electron IPC get Playwright coverage under `test/e2e/`.
- Bug fixes land with a regression test that fails before the fix and passes after it.

## Documentation expectations

`README.md` and `README.zh-CN.md` are kept in sync. When behavior, prerequisites, or commands change, update both in the same pull request.

User-facing strings go through i18next resources, not hardcoded literals in components. If you add a string, add the key to every locale you can, and leave the rest to translators.

## Security

Never commit API keys, access tokens, or personal absolute paths. Translation credentials live in the app's settings store at runtime, never in the repository.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md). Do not open a public issue for a security problem.

## License

Manuslip is released under the [MIT License](LICENSE). Contributions are accepted under the same license, and by submitting a pull request you agree to license your contribution under it.
