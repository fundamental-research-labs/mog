# Storage model: memory and speed

This comparison measures the [storage model change](storage-model-plan.md)
against `2a2f34cf48d99570c517b56033322692268586f6`, the native-storage baseline.
Memory and speed are separate measurements: reducing resident memory does not
guarantee faster reads or recalculation.

The [SUM follow-up](sum-aggregation-bench.md) evaluates range preparation and
streaming improvements against the same original baseline. The results below
remain the historical comparison before those changes.

## Results

Retained memory decreased in all seven workloads. End-to-end timings improved
for blank creation, XLSX import, formula chains, and history; numeric hydration
plus reads and property operations were close to the baseline.

**There are material speed regressions:** reading 100,000 authored numeric
cells takes 6.09 ms instead of 3.69 ms (**64.8% longer**). Recalculating a SUM
over those cells 100 times takes 415.51 ms instead of 194.43 ms
(**2.14× as long**). Faster hydration partly hides the read regression in the
numeric workload total. Imported range reads improve from 7.12 ms to 1.70 ms.

Numeric and property workload wall-time ranges overlap between versions, so
their small median differences do not establish a reliable overall speed change.
The SUM ranges do not overlap: 236–263 ms before versus 446–486 ms after.

The [raw measurements](benchmarks/storage-model-paired.json) include all samples,
medians, observed ranges, binary and source hashes, and build provenance.

### Memory

All values are MiB; changes compare medians. Live RSS measures retained memory.

| Workload | Live before | Live after | Change | Peak before | Peak after | Change |
|---|---:|---:|---:|---:|---:|---:|
| Blank + one write | 21.12 | 6.67 | -68.4% | 21.14 | 6.84 | -67.6% |
| Numeric 100k | 65.12 | 62.23 | -4.4% | 83.13 | 80.27 | -3.4% |
| XLSX 100k | 56.78 | 49.69 | -12.5% | 149.16 | 148.97 | -0.1% |
| Properties 100k | 29.44 | 21.93 | -25.5% | 29.33 | 21.91 | -25.3% |
| Formula chain 10k | 53.62 | 32.23 | -39.9% | 53.52 | 39.27 | -26.6% |
| SUM 100k | 66.63 | 63.50 | -4.7% | 84.56 | 81.38 | -3.8% |
| History 1k | 30.56 | 16.05 | -47.5% | 30.45 | 15.88 | -47.8% |

### Speed

Times are milliseconds; a positive change means more time taken.

| Workload | Wall before | Wall after | Change | CPU before | CPU after | Change |
|---|---:|---:|---:|---:|---:|---:|
| Blank + one write | 1.54 | 0.74 | -52.1% | 1.48 | 0.68 | -54.2% |
| Numeric 100k | 44.70 | 43.45 | -2.8% | 44.55 | 43.25 | -2.9% |
| XLSX 100k | 147.45 | 126.94 | -13.9% | 146.96 | 126.74 | -13.8% |
| Properties 100k | 35.29 | 35.30 | +0.0% | 35.14 | 35.12 | -0.1% |
| Formula chain 10k | 532.16 | 306.21 | -42.5% | 531.82 | 305.88 | -42.5% |
| SUM 100k | 240.97 | 464.18 | +92.6% | 240.80 | 463.96 | +92.7% |
| History 1k | 41.37 | 30.42 | -26.5% | 41.23 | 30.29 | -26.5% |

### Operation timings

Times are milliseconds. These phases exclude process startup and teardown.

| Workload / phase | Before | After | Change |
|---|---:|---:|---:|
| Blank + one write / `create` | 0.766 | 0.142 | -81.5% |
| Blank + one write / `write` | 0.058 | 0.039 | -32.8% |
| Numeric 100k / `hydrate` | 34.407 | 30.997 | -9.9% |
| Numeric 100k / `read_100k` | 3.694 | 6.086 | +64.8% |
| XLSX 100k / `parse_hydrate` | 138.429 | 123.383 | -10.9% |
| XLSX 100k / `read_100k` | 7.120 | 1.701 | -76.1% |
| Properties 100k / `write_properties` | 15.243 | 16.341 | +7.2% |
| Properties 100k / `read_properties` | 11.419 | 11.009 | -3.6% |
| Formula chain 10k / `hydrate_recalc` | 21.926 | 22.737 | +3.7% |
| Formula chain 10k / `recalc_10` | 505.548 | 279.666 | -44.7% |
| SUM 100k / `hydrate_recalc` | 38.422 | 42.288 | +10.1% |
| SUM 100k / `recalc_100` | 194.427 | 415.515 | +113.7% |
| History 1k / `write_1000` | 15.130 | 11.877 | -21.5% |
| History 1k / `undo_1000` | 11.431 | 8.407 | -26.5% |
| History 1k / `redo_1000` | 12.326 | 8.876 | -28.0% |

The final source passed `cargo test --workspace --locked --no-fail-fast`:
19,473 tests passed, none failed, and 89 remained ignored by default.

## Method

Both versions use the release `compute-core` example
[`storage_bench.rs`](../../compute/core/examples/storage_bench.rs), built with
`cargo build --release --locked -p compute-core --example storage_bench`.
Each worktree has its own Cargo target directory. The baseline receives the
same benchmark workloads and assertions; only the renamed engine accessor
differs between harnesses.

Measurements run on Linux aarch64 with Rust 1.98.0, pinned to one CPU with
`RAYON_NUM_THREADS=1`. Each workload has one warmup per version, followed by
five fresh-process samples. Baseline/current order alternates between samples.
No builds or test suites run during sampling. Reported values are medians;
raw samples and minimum/maximum ranges accompany the report.

- **Live RSS** comes from `/proc/self/status` after the workload, while its
  engine or metadata store is still alive. It includes allocator retention.
- **Peak RSS** comes from GNU time and includes transient import allocations.
- **Wall time** includes process startup, setup, output assertions, teardown,
  and the GNU time wrapper. CPU time includes user and system time.
- **Phase times** use Rust `Instant` around the named engine operation. They
  help distinguish hydration, reads, edits, and recalculation from process
  overhead. Read phases include checking every returned value.

RSS counters are sampled differently and rounded by the OS; small discrepancies
between live and peak readings are not meaningful. Millisecond-scale process
timings are noisy. These are local measurements of seven workloads, not a
claim about every workbook or hardware platform.

The VM does not report a CPU model. These workloads do not request autofit,
screenshots, or pixel geometry; lazy font and layout costs are paid when those
features are used. Large structural edits are outside this benchmark set.

## Workloads

| Workload | Work performed and validated |
|---|---|
| Blank + one write | Create a 1,000-row, 26-column sheet; write and read A1. |
| Numeric 100k | Hydrate 100,000 authored numeric cells; read and verify every value. |
| XLSX 100k | Parse a deterministic 10,000 × 10 numeric XLSX file; read and verify every value. |
| Properties 100k | Write and read shared-string source indices and original text for 100,000 cells; verify checksum 5,000,050,000. |
| Formula chain 10k | Hydrate a 10,000-cell dependency chain; change its input ten times and validate its final cell each time. |
| SUM 100k | Hydrate 100,000 numeric cells plus a SUM formula; change an input and verify the sum 100 times. |
| History 1k | Make 1,000 edits, undo all, redo all; check history depths and cell values. |

## Interpretation

The detailed-property workload represents two populated metadata fields per
cell. The packed representation saves space for sparse properties; it uses
more space when five or more payload fields coexist. Formula-heavy and
format-heavy workbook distributions can therefore have different results.

The XLSX peak includes parser and input buffers. Lower retained engine memory
can coexist with a largely unchanged import peak.

The benchmark caught repeated compact-axis hashing on every authored read.
The final implementation caches compact identity spans per axis segment,
preserving compact storage while avoiding repeated hashing in cell lookups.
The remaining authored-read overhead is consistent with resolving two axis
identities and looking up a wider key. These measurements do not isolate every
contributing cost; this implementation does not claim a universal speedup.

## Reproducing a measurement

Build the example in both worktrees with separate `--target-dir` paths. Copy the
current `compute/core/examples/storage_bench.rs` into the baseline worktree and
change its single `.cell_store()` call to `.mirror()` so both versions execute
the same workloads. No baseline engine code needs changing.

Generate the XLSX fixture from the repository root:

```sh
python3 -c 'from pathlib import Path; from scripts.bench.storage_bench import dense_fixture; dense_fixture(Path("/tmp/dense_100k.xlsx"))'
```

For example, run each release binary as follows, choosing an available CPU:

```sh
RAYON_NUM_THREADS=1 taskset -c 0 /usr/bin/time -f 'peak_rss_kib %M' /path/to/release/examples/storage_bench sum_100k
RAYON_NUM_THREADS=1 taskset -c 0 /usr/bin/time -f 'peak_rss_kib %M' /path/to/release/examples/storage_bench xlsx_100k /tmp/dense_100k.xlsx
```

The binary prints phase times and live RSS, and exits unsuccessfully if an
output assertion fails. Use one warmup, alternate version order over five
fresh-process repeats, and compare medians. The Python helpers in
[`storage_bench.py`](../../scripts/bench/storage_bench.py) collect wall time,
CPU time, peak RSS, and phase timings into machine-readable samples.
