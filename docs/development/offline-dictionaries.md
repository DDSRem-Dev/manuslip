# Offline spelling dictionary

`en-US-10-2.bdic` is the unchanged American English dictionary from Electron
45.0.0's `hunspell_dictionaries.zip` release asset, retrieved 2026-10-23.

- Source: https://github.com/electron/electron/releases/download/v45.0.0/hunspell_dictionaries.zip
- Archive SHA-256: `8bb83d71a627b82d27133a668e4fc2c59e6d9a1fed123918f9ebb49f8bdf6322`
- Dictionary SHA-256: `b0d80e6b6c5491879365e176ecbd98074602a663429bcfcfb0a5a8375c051f13`
- Dictionary size: 451,982 bytes.

The archive checksum was checked against that release's `SHASUMS256.txt`.
Preserved `LICENSE` and `COPYING.MIT` come from the same archive.
`README_en_US.txt` contains the English dictionary's original SCOWL/Ispell
copyrights, permissions and attribution, copied verbatim from Chromium's
hunspell_dictionaries repository on the same date:
https://chromium.googlesource.com/chromium/deps/hunspell_dictionaries/+/refs/heads/main/README_en_US.txt

Copyright (c) J Ross Beresford 1993-1999. All Rights Reserved.
The UK Advanced Cryptics Dictionary attribution and complete notice are
preserved in `README_en_US.txt`, along with all other English wordlist notices.

The app verifies the dictionary's size and SHA-256 before seeding Chromium's
private `Dictionaries` cache. It overrides the CDN URL with the packaged local
directory and selects only en-US on Windows/Linux. macOS uses its native
system spellchecker. No runtime internet dictionary download is needed.

When upgrading Electron, check its dictionary filename/version, copy the exact
release artifact and notices, update the checksum/size in `main/spellcheck.ts`,
and run the packaged offline spelling test on every supported OS.
