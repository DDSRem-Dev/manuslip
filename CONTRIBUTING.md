# Contributing to Manuslip

Thanks for taking a look. Manuslip is an early-stage, local-first Markdown editor built on Electron, React, CodeMirror, and a single mdast document model. Early development is the best time to shape direction, so design feedback, provider integrations, UI translations, and bug reports all matter as much as code.

Two documents sit next to this one and apply to every contribution: the [Code of Conduct](./CODE_OF_CONDUCT.md) and the [Security Policy](./SECURITY.md). Read both before you open an issue or a pull request.

Large changes should start as an issue. That includes new packages, new IPC channels, changes to the document model, and anything that touches the translation provider interface.

## Before you start

- Search open and closed issues and pull requests for the same problem. Someone may already be working on it.
- Open an issue for anything larger than a small fix. A typo correction or a one-line bug fix can go straight to a pull request.
- Discuss API and UX changes before writing code. The AST shape, the preload bridge, the provider interface, and the three rendering modes are all load-bearing, and a short conversation up front saves a rewrite later.

## Prerequisites

- **Node.js 24 LTS**, pinned in `.nvmrc`. Run `nvm use` or `fnm use` from the repository root before installing anything.
- **npm 11**, which ships with Node 24. npm workspaces is the only supported package manager. Do not add a pnpm or Yarn lockfile. Commit the generated `package-lock.json`; CI installs from it with `npm ci`.
- **Git**. Commit signing is not required. DCO sign-off is required, and it is covered under [Commit conventions](#commit-conventions).

Native modules need a platform toolchain. `better-sqlite3` is the main one, and it compiles during `npm install`.

| Platform | What you need |
| --- | --- |
| macOS | Xcode Command Line Tools: `xcode-select --install` |
| Windows | Visual Studio Build Tools with the "Desktop development with C++" workload, plus Python 3 on `PATH` |
| Linux | `build-essential` and `python3` from your distribution |

## Repository layout

The repository is an npm workspaces monorepo. The directories below are the intended layout. They do not all exist yet.

| Path | Responsibility |
| --- | --- |
| `apps/desktop` | Electron app: main process, preload bridge, windows, menus, packaging, and auto-update |
| `packages/core` | mdast document model, block hashing, block splitting, and document operations |
| `packages/editor` | CodeMirror 6 setup, keymaps, and live-preview decorations |
| `packages/renderer` | mdast to sanitized HTML, including MathJax, Mermaid, and code highlighting |
| `packages/translate` | Provider interface, block cache, glossary, and batching |
| `packages/ui` | Shared React components, themes, and design tokens |

## Getting started

```bash
git clone https://github.com/<your-org>/manuslip.git
cd manuslip
npm install
npm run dev
```

**Current state:** the repository is at the scaffolding stage. Workspace manifests are not checked in yet, so today only documentation and configuration checks exist. The commands above describe the intended workflow and will work once the manifests land. If you are reading this after that point, the note is stale and should be removed.

## Root scripts

These scripts are the contract for local development and CI. They live in the workspace root.

| Script | What it does | Runs in CI |
| --- | --- | --- |
| `npm run dev` | Starts electron-vite in development mode, with renderer HMR and live main/preload reload. | No |
| `npm run build` | Builds the desktop app and produces installers through electron-builder. | Yes |
| `npm run check` | Runs lint, format check, and typecheck in sequence. This is the pre-push gate. | Yes |
| `npm run lint` | Runs Biome lint across the workspaces. | No |
| `npm run format` | Runs Biome format and writes fixes in place. | No |
| `npm run typecheck` | Runs the TypeScript compiler in no-emit mode across the workspaces. | No |
| `npm test` | Runs the Vitest unit suite. | Yes |
| `npm run test:e2e` | Runs Playwright end-to-end tests against a built Electron app. | No |
| `npm run clean` | Removes build output and local caches. | No |

`npm run test:e2e` is not part of the default CI job. Run it locally when you change IPC, window behavior, or a full editing flow, and say so in your pull request.

## Architecture rules you must not break

These are not style preferences. Each one protects a property the product depends on.

- **One mdast AST, three projections.** Source, Live Preview, and Translated Preview all read from the same document model. Never keep parallel copies of document text, and never let a view own its own parse.
- **The renderer stays sandboxed.** All filesystem and OS access goes through the typed preload bridge. No `nodeIntegration`, no `enableRemoteModule`, and no direct `ipcRenderer` use inside React components.
- **Parsing and rendering stay off the critical path.** Per-block work is hashed and cached. If you add work on every keystroke, it needs an incremental path or a worker.
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

- Unit tests use Vitest and sit next to the code as `*.test.ts`.
- Parser and renderer changes need CommonMark or GFM fixtures plus cache-invalidation cases. A cache that returns stale HTML is a bug, not a speedup.
- UI flows and Electron IPC get Playwright coverage under `test/e2e/`.
- Bug fixes land with a regression test that fails before the fix and passes after it.

## Documentation expectations

`README.md` and `README.zh-CN.md` are kept in sync. When behavior, prerequisites, or commands change, update both in the same pull request.

User-facing strings go through i18next resources, not hardcoded literals in components. If you add a string, add the key to every locale you can, and leave the rest to translators.

## Security

Never commit API keys, access tokens, or personal absolute paths. Translation credentials live in the app's settings store at runtime, never in the repository.

Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md). Do not open a public issue for a security problem.

## License

Manuslip is released under the [MIT License](./LICENSE). Contributions are accepted under the same license, and by submitting a pull request you agree to license your contribution under it.
