# Registered workbook candidates

The native CLI can stage one candidate from an explicitly registered live
workbook. This protocol is intentionally conservative: `candidate_saved` is
not a completed task, and it never writes the declared final output. A host
must separately validate and publish the candidate before reporting success.

## Lifecycle

Use a new UUID for each task and a private `MOG_SESSION_DIR`. Register the
intended workbook when opening or creating its persistent session, before any
script runs:

```sh
mog --session --input input.xlsx \
  --output-task TASK_UUID --intended-output result.xlsx
```

Omit `--input` to create a blank workbook. `--output` remains the ordinary
session save path and can differ from the intended output. Subsequent commands
use the returned session ID. Registering another workbook for the same task
makes that task permanently ambiguous; the CLI never chooses a scratch file,
newest file, current directory entry, or first session as a fallback.

When the host is ready to finalize, before closing sessions:

```sh
mog --prepare-output TASK_UUID --output-request REQUEST_UUID --output-budget-ms 10000
```

The budget must be between 1 and 50000 milliseconds. Preparation freezes the
registered workbook actor, obtains edit evidence, writes a private temporary
XLSX beside the declared target, reopens it with Mog, and verifies its SHA-256.
Only then does it atomically create a separate, uniquely named candidate file
without overwriting an existing destination or using a copy fallback. The
receipt includes task, native workbook, request, checkpoint and revision
identities, plus the candidate path, size and digest. It does not claim Excel
readability, formula accuracy, financial correctness, or final publication.

Each task admits at most one preparation attempt. Repeating the same request
returns its receipt after rechecking the file digest; another request ID is
rejected. An interrupted attempt without a receipt stays unknown, rather than
retrying an export whose outcome is unknown. Staged partial files survive
export, validation or publication errors and are never promoted automatically.
A lost/closed worker without a completed receipt is unavailable, even if a
plausible workbook exists at another path.

`mog --cancel-output TASK_UUID` marks the task cancelled, independently of the
worker's request queue. Cancellation and candidate publication use the same
short registry lock. Deadline/cancellation checks surround export and parser
validation, run throughout hashing, and precede publication and the completed
receipt. The client wait is bounded. Native export/parser work is synchronous:
it may finish its private temporary file after the caller times out, but cannot
publish a candidate after observing expiry or cancellation. This is not a
hard CPU or filesystem I/O deadline. A busy registry lock fails explicitly.
The host must retain and inspect failures rather than treating them as success.

`mog --output-capabilities` advertises protocol version 1 and explicitly reports
`publishes_final_output: false`. The protocol is opt-in; ordinary CLI sessions
retain their existing save behavior.

## Edit evidence boundary

A checkpoint starts after input import and before the first task script. The
actor captures original logical cell values/formula text before the first
admitted write to each position, then compares against current logical state.
Formula caches and exported-byte differences do not count. No-op writes,
manual edit/revert cycles, and volatile recalculation do not establish an edit.
The actor identity cannot be reset or reused on another workbook. Freezing
rejects all later mutations, including writes through cloned handles.

The admitted mutation entrypoint is `Sheet::set_range_typed`, used by Office.js
range values and formulas. At most 100,000 positions are tracked. Failed typed
batches and failed CLI scripts invalidate evidence, including partial syncs.
Array/projection cells invalidate evidence before or after an admitted write,
including a temporary array that is later replaced. Coverage is deliberately
incomplete; `unavailable` is a supported result.

All other mutable facade calls go through `Dispatch::call_engine`, which
invalidates a checkpoint by default. This includes legacy single/bulk setters,
clear, copy, sort, fill, import/restore, undo/redo, row/column/sheet changes,
format/layout, names, tables, charts, comments, protections and settings.
Future mutable methods using that dispatcher also invalidate automatically.
Only audited recalculation and undo-group begin/end bookkeeping bypass this
invalidation, and these still reject writes after freezing. Read queries and
exports use immutable engine access. The core history implementation is
unchanged and history depth is never used as proof.

The registry is owned by the local OS user. Task identifiers and digests fence
accidental cross-task/workbook reuse; they are not an isolation boundary
against a same-user process deliberately modifying registry or workbook files.
The owner should remove its private registry and preserved candidates after
review. `--close-all --discard` closes workers without publishing final output.

## Verification

```sh
cargo test -p mog --locked --test edit_checkpoint --test output_candidate
cargo test -p mog -p compute-api --locked
```

The integration tests run actual native processes with private registries and
synthetic XLSX files. They cover value/formula edits, readable staged bytes,
reverts with volatile caches, unsupported mutations, frozen late writes,
identity/deadline rejection, bounded waiting behind a busy worker, ambiguous
registration, cancellation, atomic destination collisions, partial artifacts,
idempotent receipt validation, tampering, and unavailable closed sessions.
