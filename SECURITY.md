# Security Policy

Manuslip is local-first, but it still handles untrusted input every day: Markdown and raw HTML from other people, images, links, and responses from third-party translation providers. It also writes to your filesystem, shells out to optional tools, and stores API keys. Security reports are welcome, and this page explains what is in scope and how to send one.

## Supported versions

Manuslip has not reached 1.0. Until versioned releases exist, fixes land on the tip of `main` and in the newest published prerelease only.

| Version | Supported |
| --- | --- |
| Latest commit on `main` | Yes |
| Latest published prerelease | Yes |
| Older builds and older prereleases | No |

This table will be replaced with a versioned support matrix once regular releases start.

## Reporting a vulnerability

Use GitHub private vulnerability reporting. Open the repository's Security tab and choose "Report a vulnerability". Please don't open a public issue, pull request, or discussion for a security problem.

If private advisories are unavailable for any reason, email security@manuslip.example instead.

<!-- TODO: replace security@manuslip.example with the project's real security contact before publishing. -->

A useful report includes:

- The affected version, commit hash, or build you tested.
- Your operating system and, where relevant, the Electron version bundled with the build.
- Reproduction steps or a proof of concept. A minimal Markdown file or a short recording is often enough.
- Your assessment of impact: what an attacker gains, and what the user has to do for it to work.
- Any fix or mitigation you have in mind.

## What to expect

These are best-effort commitments from a volunteer project, not contractual service levels.

- Acknowledgement of your report within 3 business days.
- Initial triage, including a severity assessment and a decision on scope, within 7 business days.
- A coordinated disclosure timeline. The default is 90 days from the initial report. We can move faster or slower by mutual agreement, especially when a fix ships early or when users need time to update.
- Credit in the published advisory, unless you ask to stay anonymous.
- No bug bounty. Manuslip is a volunteer project and does not pay for reports.

## Scope

The following attack surfaces are in scope. Each line explains why it matters for this product.

- Markdown and HTML rendering: DOMPurify configuration, the strict Content Security Policy, raw HTML passthrough, link and autolink generation, and `data:` URIs. A gap here turns any opened document into script execution inside the app.
- Diagram and math rendering: Mermaid, MathJax, and the legacy `sequence` and `flowchart` blocks. Fenced blocks are untrusted input that reaches a renderer, so script injection through them counts.
- Renderer sandbox and IPC: escape from the sandboxed renderer, or abuse of the typed contextBridge API for path traversal, arbitrary file read or write, or shell and OS command execution.
- File handling: atomic save, file watching, workspace roots, writes to the asset folder, symlink handling, and encoding detection through iconv-lite and jschardet. These paths decide which files the app may touch.
- Optional Pandoc invocation: argument injection, process spawning, and PATH hijacking when a user has Pandoc installed.
- Translation providers: API key storage in Electron `safeStorage` (OS keychain) or `electron-store`, exfiltration of prompts or document content, malicious provider responses, and SSRF through configurable base URLs.
- Auto-update and packaging: update feed integrity, installer signing, and anything that lets a third party ship code as Manuslip.

Out of scope:

- Reports that require an already compromised machine or an attacker-controlled local configuration file.
- Missing hardening headers or best-practice deviations with no demonstrable impact.
- Dependency vulnerabilities with no reachable code path in Manuslip. Send those upstream to the dependency maintainers, and open a normal issue if Manuslip needs to bump the version.
- Social engineering of maintainers or contributors.
- Denial of service caused by opening an intentionally huge local file.

## Disclosure policy

We follow coordinated disclosure. Please don't publish details, a proof of concept, or a working exploit before a fix is available or before the agreed disclosure date, whichever comes first.

Advisories are published through GitHub Security Advisories (GHSA). When a report meets the usual thresholds, we request a CVE identifier as part of the advisory. The advisory credits the reporter unless anonymity was requested.

## Safe harbor

We consider good-faith security research authorized when it stays within this policy. Test against your own installs, your own documents, and your own provider credentials. Don't access other people's data, degrade the service for anyone else, or run tests against third-party infrastructure such as translation APIs or update servers. We will not pursue legal action for research conducted under this policy.
