# Semantic Worker failure evidence

The renderer records a local User Timing measure named `manuslip:semantic-failure`
when the window semantic service begins Worker recovery. The record is best effort:
unavailable User Timing measurement APIs must not break editing, accepted results or recovery.

Read the current window's records in DevTools:

```js
performance.getEntriesByName('manuslip:semantic-failure').map((entry) => ({
  atMs: entry.startTime,
  ...entry.detail,
}))
```

Each detail contains a fixed `reason`, `requestActive`, `requestAgeMs` and
`workerPresent`. Request age measures elapsed time since that request's `sentAt`,
before recovery clears the running slot. It is `null` when no request is running.
`workerPresent` reports whether the service has an adapter assigned; a packed port may
already have terminated its underlying Worker before notifying the service.
This helps distinguish a startup failure from the unchanged five-second watchdog.
The reason identifies the failure stage; it does not establish the underlying cause.

| Reason | Stage that started recovery |
| --- | --- |
| `worker-error` | The native or packed browser adapter received a Worker error event. |
| `message-error` | The browser adapter received a message deserialization error event. |
| `worker-failure` | An adapter reported failure without a recognized reason. |
| `worker-create` | The service's Worker factory threw, including adapter construction. |
| `worker-listener` | Installing the service's result/message/failure listeners threw. |
| `worker-post` | Posting the service's parse request threw. |
| `watchdog` | The running request reached the service watchdog timeout. |
| `native-response` | Validation of an ordinary Worker response failed. |
| `packed-result` | The service rejected the packed result identity. |
| `channel-post` | Sending a packed prepare command threw. |
| `slice-schedule` | Scheduling mandatory receipt or optional cache work threw. |
| `packed-response` | The packed port rejected response correlation or initial wire inspection. |
| `packed-receipt` | Advancing or accepting a complete packed receipt failed. |
| `packed-cache` | Creating or advancing optional packed cache work failed. |

The reason is checked against the fixed list at runtime. Error objects, exception
messages, source text, paths, document identifiers, response objects and callbacks are
not included in these measures. There is no network or persistent logging. Records
live in the current renderer's performance timeline; at 200 records the existing batch
is cleared before adding the next. Closing the window ends that timeline. Call
`performance.clearMeasures('manuslip:semantic-failure')` to clear it explicitly.

A valid `semantic-limit` or `semantic-parse` response follows the ordinary result path
and does not consume Worker recovery. A consumer exception after the service accepts a
response also keeps the existing recovery protections. Stale callbacks from a replaced
Worker cannot record another failure or terminate its replacement.

The production adapter still uses the ordinary semantic Worker. The experimental packed
port preserves reason information for its diagnostic and integration flows; this change
does not activate packed transport. Restart quotas, debounce, watchdog duration, native
grammar, payload limits and memory admission weights remain unchanged.

The earlier isolated startup restart remains unexplained. The preserved event predates
these records and cannot be assigned a reason retrospectively. A separately reproduced
diagnostic-API exception is fixed: local timing errors no longer turn healthy requests
or accepted results into Worker failures. Unit regressions and the packaged injected
timing-error flow verify that distinction.

Validation and release evidence are recorded in [VALIDATION.md](../validation/implementation-history.md),
`test/artifacts/logs/worker-failure-validation-check.json` and `test/artifacts/logs/verify-worker-failure.mjs`.

Experimental packed port construction also owns cleanup before the factory returns.
If runtime setup or channel listener registration throws, the constructor terminates
the channel and releases its reservation. Late registered callbacks observe a closed
port. Cleanup attempts all releases even if channel termination throws, preserving
the original setup exception. A channel that reports failure synchronously during
registration causes construction to fail rather than returning a closed port.
The Service records these factory failures as `worker-create` and applies its existing
restart policy. Independent old consumer captures survive replacement.

Actual Electron regressions inject three registration failures before a healthy
replacement. The preceding code leaves three Workers alive and three extra holds;
the corrected code leaves neither after disposal. Complete native output remains
identical. This is a controlled startup cleanup fix, separate from the earlier
unexplained event. Production still uses the ordinary adapter; all 237 rebuilt runtime
files match the existing release byte for byte. See the packed startup checkpoint in
[VALIDATION.md](../validation/implementation-history.md) and `test/artifacts/logs/packed-port-startup-validation.json`.

Root schema validation now finishes cleanup even when a nested array iterator's
`return()` throws. It attempts every remaining frame and releases the root workspace.
An earlier validation or observer failure takes precedence, including thrown `undefined`;
otherwise the first cleanup failure is reported after all cleanup attempts finish.
The original visitor, validation rules, budgets, geometry checks and scheduler yields
remain in place.

Four fault cases cover cancellation and observer failure with multiple cleanup failures.
With the preceding implementation, cancellation leaves three reader reservations,
139,528 bytes of reader staging charges and 141,064 additional retained ownership charges
until the capture is released. These are ledger weights, not measured physical allocation.
The corrected implementation restores the exact pre-validation stats and revokes the
saved nested scope. Closed tasks remain inert. Twelve additional GC probes hold closed
tasks, saved scopes and bound callbacks while observing actual source, revision and arena
objects; none of the 36 graph witnesses survives after disposal. This establishes scoped
cleanup/lifetime behavior, not portable memory admission or a physical peak.

This is a separate experimental-validator cleanup fix. It does not explain the preserved
startup event or activate the packed protocol. Current proof and rebuilt release evidence
are recorded in the root cleanup checkpoint in [VALIDATION.md](../validation/implementation-history.md) and
`test/artifacts/logs/root-cleanup-validation.json`.

Description/word validators and document baselines now apply the same cleanup rule.
Failure to close one metadata stream, word buffer, summary frame or active baseline
inspection cannot skip the remaining releases. An existing validation/observer failure
takes precedence; otherwise the first cleanup failure wins, including thrown `undefined`.
Baseline and reuse state is revoked before cleanup starts, so repeated closure is inert.
A closed metadata-reuse helper also drops its source/baseline references and rejects a
later prune instead of reopening readers.

Fourteen fault cases cover these paths; thirteen fail against the preceding code. A
separate lifetime diagnostic keeps 236 closed objects and bound callbacks alive through
explicit GC after disposal. All 84 actual source, arena and revision witnesses collect
across 28 probes. Exact ownership counters restore before final capture disposal; these
are scoped cleanup/lifetime checks, not physical-memory admission. Current integration,
release and remaining gate evidence is recorded in the validator cleanup checkpoint in
[VALIDATION.md](../validation/implementation-history.md) and `test/artifacts/logs/validator-cleanup-validation.json`.

The fused document/prose collector and exact projection-output validator now finish
their remaining releases after a close throws. The collector previously left one
reader, 205,186 bytes of staging charges and 205,698 additional retained ownership
charges until capture release when its word-buffer close failed. These are ledger
weights, not physical allocation measurements. Output validation could similarly skip
remaining HTML/layout streams or replace a comparison failure with a later close
error. A completed widget cursor could also be closed again during unwinding.

The corrected paths attempt every release and preserve the first relevant failure,
including thrown `undefined`. Completed widget cursors detach before fallible close.
All 22 new fault cases fail against the archived preceding modules; current ownership
stats restore exactly and closed tasks/scopes remain inert. Forty-four explicit-GC
probes keep 3,220 closed handles and bound methods while all 180 actual source, arena
and revision witnesses collect after disposal. This scoped cleanup fix does not explain
the separate preserved startup event, calibrate physical memory admission or activate
packed transport. Current release and remaining gate evidence is in
[VALIDATION.md](../validation/implementation-history.md) and `test/artifacts/logs/receipt-cleanup-validation.json`.

Array-inspector and projection-baseline cleanup now follow the same rule. A fallible lookup
close cannot skip its workspace release. A failed baseline classification cannot skip later
nested readers, layout readers or construction ownership, or replace its earlier error with
a cleanup failure. Baseline lifetime cleanup releases the metadata hold after a close throws.
Completed layout readers close before baseline ownership transfers, so failure cannot strand
an unpublished baseline and its lifetime task until capture release.

All twelve new fault cases fail against the archived preceding runtime modules. The corrected
paths restore exact pre-task counters and pass 125 focused tests. Twenty-four explicit-GC
probes retain 2,096 closed handles and bound methods while all 72 actual source, arena and
revision witnesses collect after disposal. These are scoped ownership/lifetime checks; they
do not calibrate physical admission, activate packed transport or explain the separate
preserved startup event. Current validation and remaining gates are recorded in
[VALIDATION.md](../validation/implementation-history.md) and `test/artifacts/logs/reader-baseline-cleanup-validation.json`.


Text comparison cleanup now attempts both decoder closures even when the first throws.
The existing read/comparison failure wins; otherwise the first cleanup error wins,
including thrown undefined. The outer text helper retains the first decoder until
second setup succeeds, preserving setup failure while closing that first decoder once.
After the handoff it does not close the first again. Ten real fault cases reproduce the
preceding skipped second closure, duplicate first closure and masked primary/setup error;
the corrected cases restore exact ownership and leave closed handles inert. Twenty held-
handle lifetime probes leave no surviving actual source/arena/revision witnesses after
disposal. This scoped fix neither identifies the separate preserved startup event nor
calibrates physical memory admission or activates packed transport. Current release and
remaining gates are recorded in VALIDATION.md and test/artifacts/logs/comparison-cleanup-validation.json.

Publisher and producer cancellation now completes all remaining owned cleanup after a
trusted child, metadata hold or output close throws. Previously a resync child close
could leave a capture/hold open and a producer close could retain a queued request and
non-idle phase. The first cleanup failure, including undefined, survives; shared
PackedWork precedence remains unchanged. Thirty-four fault cases, full unit checks,
126 actual Worker revisions and 34 observed collection probes pass. Production packed
activation is unchanged and this does not explain the separate historical startup
failure or establish physical admission. Current artifacts, 75 packaged UI flows,
installer results and performance limitations are in docs/validation/implementation-history.md and
test/artifacts/logs/publisher-cleanup-validation.json.
