# Desktop distribution

Ordinary builds produce unsigned native installers without selecting an update feed
or publishing. Targets are Windows x64 NSIS, Linux x64 AppImage and macOS x64/arm64 DMG.
Build on the target platform and architecture. CI builds and tests each target;
interactive OS integration and signing require their own platform checks.

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
npm run test:packaged
```

Installers are in `apps/desktop/release`. On Windows, `Manuslip Setup 0.1.0.exe` is
the installer and `win-unpacked/Manuslip.exe` is the corresponding portable test build.
Unsigned packages show the operating system's normal unidentified-publisher prompt.
Signing is a separate release operation described below.

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
