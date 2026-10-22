# Repository layout

Keep documentation in `docs/<topic>/` with lowercase kebab-case filenames.
Use `guides/`, `development/`, `testing/`, `architecture/`, `adr/`,
`design/`, `product/`, `reviews/`, `patches/`, `examples/` and `validation/`
according to the document's purpose. See the [documentation index](../overview/index.md).

The root README, contribution, conduct and security documents and GitHub's pull request
template keep their standard discovery names. Licenses and upstream notices stay beside
the assets they cover.

Unit tests belong to their workspace's `test/unit/`, with fixtures in `test/fixtures/`.
Native process integration belongs to the desktop workspace's `test/integration/`.
Use `test/e2e/` for application workflows, `test/benchmark/` for benchmarks and
profilers, and `test/packaging/` for dependency installation, packaging and installer checks.
Use explicit suite configurations and keep production code independent of test helpers.

Store generated correctness output in `test/e2e/results/`, benchmark output in
`test/benchmark/results/`, and installer or release output in `test/packaging/results/`.
Shared diagnostic logs and profiles belong to `test/artifacts/logs/`. These directories
and package-local `test/artifacts/` are ignored. Remove UUID metadata files.

Impeccable's `.impeccable/` directory is local design-tool state. Keep it ignored and
hidden in the file manager; publish useful prose under `docs/design/` or `docs/reviews/`.
