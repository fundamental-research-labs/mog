# Yrs removal performance comparison

These measurements include native undo/redo. History records typed inverses for
user actions while the native sparse cell store remains authoritative. The
Office.js boundary remains `Excel.run` / `load` / `sync`; every mutating sync is
one undo action. See [undo and redo](undo-redo.md).

Measured on 2026-09-09 against public baseline
`f2edc322212d1e32edae1915892e406b33ca1d18`, on the same machine, after builds and
tests finished. Baseline production code is unchanged. Its detached worktree
contains benchmark harness additions and five test-only import fixes used to
reproduce existing parser failures; those fixes do not affect release code.

## Results with history enabled

Each entry is the median of five fresh processes after one warmup.
Process CPU includes construction, the named operations, assertions, and
destruction. Peak RSS includes all retained undo history.

| Workload | Baseline CPU ms | Native CPU ms | CPU change | Baseline peak MiB | Native peak MiB |
|---|---:|---:|---:|---:|---:|
| Blank workbook + one cell | 2.678 | 1.807 | -32.5% | 22.99 | 21.39 |
| 100k numeric cells from snapshot | 1920.547 | 44.426 | -97.7% | 286.03 | 83.07 |
| 10k formula chain + 10 edits | 726.873 | 555.077 | -23.6% | 78.64 | 53.59 |
| Dense XLSX import, 100k numeric cells | 139.961 | 166.984 | +19.3% | 148.97 | 148.79 |
| Office.js write/load 1k cells in one sync | 15.863 | 10.994 | -30.7% | 28.86 | 33.83 |
| SUM over 100k cells + 100 edits | 2210.316 | 299.982 | -86.4% | 287.11 | 84.40 |
| 1k separate writes, 1k undos, 1k redos | 236.001 | 102.663 | -56.5% | 30.32 | 32.04 |

Raw samples include wall time, user/system CPU, live RSS, phase timers,
fixture hash, source hash, and executable hashes:
[baseline](benchmarks/yrs-history-baseline.json) and
[native with history](benchmarks/native-history.json).
Source and harness inputs were checked before and after the release builds.
These samples precede PR review cleanup of unreachable delegation helpers and
unused imports. The measured storage, calculation, and history paths are
unchanged; the JSON hashes identify the measured source and executables.

The numeric snapshot CPU reduction remains about 98%, with about 71% less
peak memory. Recording history adds memory to editing workloads: Office.js
peak RSS is higher than baseline in this run, despite lower CPU time.

The phase timers below exclude snapshot construction and final destruction.
Edit timings include mutation, calculation, and a result assertion.

| Phase | Baseline wall ms | Native wall ms | Change |
|---|---:|---:|---:|
| Numeric snapshot hydration | 1884.889 | 34.430 | -98.2% |
| Chain initialization + first calculation | 53.756 | 25.138 | -53.2% |
| Chain: 10 subsequent edits/recalculations | 642.755 | 526.071 | -18.2% |
| Office.js runtime, write, sync, load | 14.581 | 9.640 | -33.9% |
| 1,000 individual writes | 46.523 | 38.773 | -16.7% |
| Undo all 1,000 writes | 95.782 | 28.874 | -69.9% |
| Redo all 1,000 writes | 101.288 | 37.849 | -62.6% |

## Interleaved verification and limits

The first import measurement increased by 19.3%, and the SUM timing also
varied from earlier observations. A quiet follow-up interleaved the same
executables, alternating their order, with one warmup and five samples each.
No source changes or rebuilds occurred between these runs. Raw samples are in
[history-paired.json](benchmarks/history-paired.json).

| Workload | Baseline CPU ms | Native CPU ms | Change |
|---|---:|---:|---:|
| Dense XLSX import, 100k numeric cells | 135.938 | 139.324 | +2.5% |
| SUM over 100k cells + 100 edits | 2187.478 | 240.591 | -89.0% |

The paired import result is 2.5% slower overall; parsing/hydration is
125.647 → 130.790 ms (+4.1%). This confirms a small import cost,
but does not reproduce the first run's 19.3% magnitude. Peak import memory is
essentially unchanged, and retained RSS is lower. Paired SUM initialization
is 1871.866 → 38.474 ms; its 100 subsequent edits/recalculations are
288.420 → 195.246 ms (32.3% faster).

These are local observations, not confidence intervals or a universal speedup.
Blank-workbook measurements are especially sensitive to process startup.

## Why snapshot and formula timings differ

Numeric snapshot construction previously populated Yrs per cell and then built
the evaluation mirror. Removing that duplicated hydration accounts for most
of its speedup. Dense XLSX import already used compact ranges in the baseline,
so it does not remove the same amount of work.

A formula harness that constructs `ComputeCore`/`CellMirror` directly also
bypasses the expensive workbook-storage path in the baseline. It primarily
measures dependency scheduling, aggregation prepasses, and formula evaluation.
The sparse store can add lookup work in those paths, even while removing large
storage and import costs elsewhere. Snapshot improvements therefore do not
predict formula-corpus improvements. Compare each workload to its own baseline
and keep initialization separate from repeated calculation.

## Method

- Linux aarch64, 18 logical CPUs, 48.99 GiB reported RAM; toolchain and kernel
  details are recorded in the JSON artifacts.
- Repository release profile: optimization level 3, full LTO, one codegen unit,
  stripping enabled, default native features and system allocator.
  Compilation is excluded from measurements.
- `RAYON_NUM_THREADS=1` for public benchmark samples. These results do not
  characterize scaling with multiple workers.
- GNU `time` measures the child's peak RSS. Python `wait4` supplies user/system
  CPU. Process wall and CPU include the small GNU `time` wrapper overhead.
  Rust `Instant` supplies internal phase timings.
- Live RSS is sampled from `/proc/self/status` while retaining the engine.
  Linux RSS accounting is approximate; independent medians can put live RSS
  slightly above peak RSS. Office.js drops its workbook before returning, so
  it reports peak RSS only.
- The deterministic XLSX fixture contains 10,000 rows × 10 columns, values
  `1..100000`, with fixed ZIP timestamps. Its SHA-256 is
  `41724da2e7d4a30d282611490d636e402120b00415eb71a38125f81cabb0e6c8`.
- Chain formulas are `A1=1`, `A2=A1+1`, …, `A10000=A9999+1`, with ten edits
  alternating A1 between 2 and 1. SUM uses `A1:A100000=1..100000` and
  `B1=SUM(A1:A100000)`, with 100 edits alternating A1 between 2 and 1.
- Every numeric/imported cell is checked. Chain and SUM check every edit.
  Office.js checks all 1,000 values and their sum. The history workload checks
  the undo depth, every reverted/restored value, and exhausted stack states.
  It measures 1,000 separate actions; grouped paste semantics are tested in
  the engine/API/Office.js suites.

## Verification

On the exact source used for the native release builds:

- `cargo test -p compute-core -p compute-api -p mog --locked -j4` passed:
  3,913 core tests, 153 API tests, and 13 Office.js tests (4,079 total).
  Three doctests are intentionally ignored.
- `cargo check --workspace --locked -j4` passed.
- History coverage includes existing undo/redo contracts, nested groups,
  failed operations, metadata, dimensions, merges, sorts, overlapping and
  cross-sheet moves, sheet lifecycle, selected-sheet imports, compact-range
  payload reuse, formula errors, dynamic spills, CSE selections, UI state,
  mutation/viewport output, security redaction, and Office.js sync grouping.
- All seven benchmark workloads passed assertions in warmup and all measured
  processes; both interleaved workloads also passed.

The earlier XLSX parser check passed 3,383 tests with two pre-existing chart
auxiliary-part failures, each reproduced on the pinned baseline:

- `write::from_parse_output::tests::charts::reconstructed_imported_chart_suppresses_stale_auxiliary_parts`
- `write::from_parse_output::tests::charts::stale_standard_chart_authority_suppresses_auxiliary_numbering_and_relationship_identity`

Both expect `xl/charts/style9.xml` to be absent from an exported archive.
They remain unresolved; the parser suite is not fully green. The command was
`cargo test -p xlsx-parser --lib --locked -j2 -- --test-threads=4`.

## Reproduce

The harness uses public Rust engine and Office.js entry points. It adds no
runtime dependency or product feature flag.

```bash
git worktree add --detach /tmp/mog-yrs-baseline f2edc322212d1e32edae1915892e406b33ca1d18
```

Copy these files into the same paths in the detached worktree:

- `compute/core/examples/storage_bench.rs`
- `compute/officejs/examples/storage_bench_officejs.rs`
- `scripts/bench/storage_bench.py`

In the baseline core example, use `YrsComputeEngine as Engine` and omit native
snapshot fields `identities: Vec::new()`, `row_axis: None`, and `col_axis: None`.
These are schema compatibility edits; workloads and assertions stay identical.
Run from the baseline worktree:

```bash
python3 scripts/bench/storage_bench.py --label yrs-history-baseline --output /tmp/mog-history-yrs-bench --runs 5
```

Then run from the native worktree:

```bash
python3 scripts/bench/storage_bench.py --label native-history --output /tmp/mog-native-history-bench --runs 5 --compare /tmp/mog-history-yrs-bench/results.json
```

The runner builds release examples by default, saves samples and provenance,
and rejects mismatched fixtures, compiler versions, or Rayon worker counts.
Use a local `CARGO_TARGET_DIR` if the shared filesystem stalls compilation.
Keep other CPU-intensive work stopped while measuring.
