# Desktop distribution

Ordinary builds produce unsigned native installers without selecting an update feed
or publishing. Targets are Windows x64 NSIS, Linux x64 AppImage and macOS x64/arm64 DMG.
Build and test on the target platform and architecture before release. Routine CI checks
source and builds application assets on Linux x64, Windows x64 and macOS x64/arm64.
Separate CI jobs run real Pandoc conversions and desktop export workflows on the same targets.
CI also packages and exercises the full desktop E2E suite on these targets. Interactive
OS integration and signing require their native platform checks.

All packages disable Node launch mode, `NODE_OPTIONS`, Node CLI inspection and extra
`file://` privileges, and require loading from ASAR. Windows/macOS validate embedded
ASAR integrity. Linux hardens the actual ELF executable before installing the shell
launcher; embedded ASAR validation is unsupported there. `npm run verify:package`
reads the packaged binary's fuse settings and rejects a weakened package.

[ADR 013](../adr/013-local-distribution.md) explains why local packaging, signing,
update metadata and publication remain separate operations.

## Ordinary local build

Use the pinned Node/npm versions, then run from the repository root:

```sh
npm ci
npm run check
npm test
npm run test:release
npm run build
npm run verify:package
npm run test:packaged
```

Installers are in `apps/desktop/release`. On Windows, `Manuslip Setup 0.1.0.exe` is
the installer and `win-unpacked/Manuslip.exe` is the corresponding portable test build.
Unsigned packages show the operating system's normal unidentified-publisher prompt.
Signing is a separate release operation described below.

Ordinary and release packages include generated `THIRD-PARTY-NOTICES.txt` files with
bundled dependencies' license text, including Mermaid's copyright and permission notice.
See [bundled dependency notices](assets.md#bundled-dependency-notices) for maintenance details.

Packaged verification first launches the original executable, opens/edits/saves a
Unicode file through the renderer and checks that injected Node environment options
are ignored. The subsequent Playwright suite needs Node inspection, so it instruments
a separate copy in `test/packaging/result/automation-*` and removes it afterwards.
The installer suite follows the same sequence after comparing installed runtime bytes.
Benchmarks also use a temporary instrumentation copy. These copies have modified
executables and must never be distributed or used to assess production signatures.

Run `npm run test:installer` on a Windows account without an existing Manuslip
installation or running Manuslip process. It installs into a fresh ignored `test/packaging/result`
directory, compares every installed runtime byte, launches the installed application,
edits/saves/reopens BOM/CRLF/Unicode source, checks icons/registrations/shortcuts, then
uninstalls and verifies restoration of the original association and shortcut state.
It adds an Open With choice while retaining the current default Markdown application.
It does not remove user documents or preferences. Interactive wizard/elevation and
physical Open With behavior remain separate checks.

To check a retained build elsewhere, set both `MANUSLIP_INSTALLER_PATH` and
`MANUSLIP_INSTALLER_UNPACKED` before running the same smoke check. The second path
must be the unpacked application corresponding to that exact installer.

## Separate release profile

The release command packages **existing application assets**. Build current assets
first, as with `package:dir`. Review the effective release configuration without
creating a package or accessing a certificate:

```sh
npm run build:app
npm run package:release -- --plan
npm run package:release -- --signed --plan
```

Remove `--plan` to execute the selected profile. Each execution creates a fresh
`test/packaging/result/releases/candidate-*/` directory containing `plan.json`, `builder.json`,
`report.json` and `artifacts/`. A successful build writes `artifacts/SHA256SUMS`
with the SHA-256 of every installer/archive/update metadata file. Keep the manifest
with the artifacts for review. Failure evidence remains in the same directory.
Release filenames include version, OS and architecture so matrix artifacts cannot
overwrite one another. A successful candidate also includes a CycloneDX dependency
SBOM covering runtime and build dependencies (including bundled Mermaid), and a binary
fuse report; signed profiles verify the native signatures
and macOS notarization ticket before producing successful release evidence.
The command always passes `--publish never`; it accepts no publishing or cross-host
arguments and does not upload anything. Use each platform's native CI/host.

`--signed` requires certificate credentials before packaging and enables
`forceCodeSigning` rather than silently falling back to unsigned output. Windows
uses `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` (or the corresponding `CSC_` variables).
macOS uses `CSC_LINK`/`CSC_KEY_PASSWORD`, hardened runtime, signed DMG and notarization.
Supply one complete Apple notarization credential set: API key/id/issuer, Apple
id/app-specific-password/team-id, or keychain/profile. Inject credentials using the
release environment; do not commit them. Plans and reports contain environment
variable names, never certificate/password values. Linux currently produces unsigned
AppImage artifacts and checksums; `--signed` is rejected on Linux.
See the pinned-version [code-signing documentation](https://www.electron.build/v26/docs/features/code-signing/)
and [Windows signing options](https://www.electron.build/v26/docs/win/#signexecutable).

## Optional update metadata hook

`--updates` is separate from signing and ordinary builds. Set `MANUSLIP_UPDATE_URL`
to an HTTPS directory URL without user information, query or fragment. Optionally set
`MANUSLIP_UPDATE_CHANNEL` to `latest` (default), `beta` or `alpha`, then review:

```sh
npm run package:release -- --updates --plan
```

Executing this profile emits generic-server update metadata and adds the ZIP target
on macOS. It still never publishes. Metadata identifies the chosen feed and artifacts;
review it alongside their checksums. Generic-server hosting requires a separate upload
of the artifacts and metadata. This follows the pinned-version
[publishing contract](https://www.electron.build/v26/docs/publish/).

This is a build hook: Manuslip 0.1.0 has no installed automatic-update runtime or
background update request. Installing a reviewed newer package is the current update
path. Before enabling automatic updates, implement and test the client, signature
verification, downgrade/channel rules and installation recovery on each platform.
Account-specific signing, notarization, hosting and public publication are separate
release actions; none is needed to review the unsigned local deliverable.

## GitHub release workflow

[Release](../../.github/workflows/release.yml) runs when a `v*` tag is pushed or when
dispatched with an existing tag. For manual runs, select that same tag under **Use
workflow from**, so GitHub's provenance identity binds to the release tag. The tag
must be a semantic version matching the root,
desktop and every workspace package, and its commit must belong to `origin/main`.
It checks out the validated commit for all jobs, reuses the complete CI workflow,
then builds on Windows x64, Linux x64 and macOS x64/arm64.

Before using it, configure these GitHub environments. Required reviewers and deployment
branch/tag restrictions are repository settings; creating a workflow file does not
enable them. Restrict release tags with a ruleset and require reviewed changes to `main`,
especially workflows, packaging scripts, lockfiles and Electron security code.

| Environment | Configuration |
| --- | --- |
| `release-signing` | Allow only reviewed `v*` tags, require a release maintainer, and store the secrets below. |
| `release` | Allow only release tags and require a release maintainer before creating the draft. |

| Environment secret | Purpose |
| --- | --- |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows signing certificate (base64 PFX or supported certificate link) and password. |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | macOS Developer ID Application certificate and password. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization credentials. |

Secrets are supplied only to their native packaging step. Missing credentials fail
the Windows/macOS candidate; there is no unsigned fallback. Linux artifacts use
checksums and build provenance. PR jobs have read-only repository access and receive
no signing credentials. Actions are pinned to reviewed commit hashes; Dependabot
maintains the references. Daily dependency auditing and CodeQL provide ongoing checks.
Enable GitHub secret scanning, push protection and private vulnerability reporting
in repository settings where the account supports them.

Signed macOS candidates notarize and staple both the app and the signed DMG. The DMG
blockmap is disabled because stapling changes its bytes after packaging. Checksums
and provenance cover the final stapled disk image.

After native signature checks and packaged security flows pass, the workflow attests
each installer, blockmap and SBOM through GitHub OIDC. The assembly job requires the
complete matrix, recomputes every checksum, rejects unsigned/modified/duplicate assets,
and verifies attestations against this repository, release workflow, tag and source
commit. It then creates a **draft**, preserving an existing release instead of replacing
its files. Review the draft and publish it through GitHub Releases. Automatic updating
remains unavailable in the application.

Artifact attestations require a supported GitHub plan (public repositories are supported
on current Free/Pro/Team plans). Signing, notarization, hosted runners and attestations
must pass on their actual services; local checks do not establish those results.

Recipients can verify a downloaded installer with:

```sh
gh attestation verify Manuslip-0.1.0-win-x64.exe --repo Nazumeki/manuslip --signer-workflow Nazumeki/manuslip/.github/workflows/release.yml
```

Also check the native platform signature and compare the download against `SHA256SUMS`.
