# ADR 013: Separate local packaging from signing and publication

Status: Accepted.

## Context

Development and CI need reproducible native installers without signing credentials,
an update service or accidental publication. Release preparation may need those choices
later without changing ordinary builds.

## Decision

Ordinary native-host builds remain unsigned, with null publish configuration and
`--publish never`. Produce NSIS, DMG or AppImage for the host target. Reuse archived
application assets for built/packaged tests instead of rebuilding between checks.

Use the separate `package:release` profile for explicit signing or update metadata.
`--plan` inspects configuration without packaging or accessing credentials. `--signed`
requires environment-supplied credentials and mandatory signing; macOS also enables
hardened runtime and notarization. Plans/reports never serialize secret values.

`--updates` requires an admitted credential-free HTTPS directory and channel; macOS adds
the update ZIP target. Execution writes artifacts and checksums locally and never uploads.
There is no automatic-update client in version 0.1.0. Installing a newer package remains
the upgrade path; a future client needs its own signature, channel and recovery decision.

## Alternatives and consequences

Signing/publishing as a default build step would couple local development to credentials
and external side effects. Generating metadata alone cannot establish runtime update
delivery. Separate profiles keep ordinary builds usable while leaving signing,
notarization, hosting and publication explicit and independently verifiable.

See [distribution commands](../development/distribution.md),
[desktop package configuration](../../apps/desktop/package.json) and
[packaging verification](../testing/testing.md).
