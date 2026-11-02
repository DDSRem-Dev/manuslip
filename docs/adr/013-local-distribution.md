# ADR013: Local deliverables and separate release hooks

Status: accepted on the Windows baseline for ADR002 item28 (VALIDATION.md, iteration104).

Ordinary builds remain unsigned with an explicit null publish configuration and
`--publish never`. They produce the native NSIS/DMG/AppImage targets. Existing CI
retains Windows x64, Linux x64 and macOS x64/arm64 build/desktop jobs, archives each
build once and reuses it for tests. Windows also installs, verifies exact runtime
bytes, edits/saves/reopens source in the installed app and checks uninstall restoration.

`package:release` is a separate native-host command. `--plan` reviews a configuration
without packaging or accessing credentials. Execution creates fresh ignored output
with an artifact hash manifest and report. It accepts no publishing flag, always uses
`--publish never`, and never uploads. `--signed` requires explicit environment-provided
credentials and forces code signing; macOS also enables hardened runtime and notarization.
Ordinary builds do not inherit this profile. Plans/reports do not serialize secrets.

Optional `--updates` requires an explicit credential-free HTTPS directory and a known
channel. It configures generic-server metadata, adds the macOS ZIP target and keeps
all upload/publishing separate. There is no installed automatic-update client in 0.1.0;
metadata generation does not claim runtime update delivery. Reviewed installer upgrades
are the current path. Future update-client work needs its own source/recovery, signature,
channel and installation acceptance.

The local deliverable is accepted only after the full current unit/packaged suite,
resource checks, bounded interface review and real Windows install/save/reopen/uninstall
test pass on the same retained ordinary package. Platform CI results, physical AT/IME,
interactive OS integration, public signing/notarization and publication remain separately
tracked under ADR002's delivery priority. See [distribution instructions](../development/distribution.md).
