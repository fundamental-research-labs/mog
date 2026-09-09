# SUM aggregation: range preparation and streaming

This follows the [storage memory and speed comparison](storage-model-bench.md).
It tests two changes independently and together, while retaining the storage
model introduced by `b3ffbd7215d8eea8006ee58f4291bd5f620fa96d`.

The original reference remains `2a2f34cf48d99570c517b56033322692268586f6`, the
same baseline used in the earlier report. The original release binary is run
again alongside the candidates so timings share the same measurement conditions.

## Results and selection

**Keep both options.** Option 1 removes the numeric SUM regression; option 2
provides a further improvement when a column contains mixed values. The retained
memory savings from the storage model remain intact across all seven original
workloads. These two changes chiefly improve speed: live and peak RSS remain
essentially unchanged relative to the storage-model version.

The original baseline was rerun, so its measurements differ from the
earlier table. It is the exact same original executable, verified by SHA-256.
Here, **before** means that original baseline and **after** means both options
on top of the storage model. Negative changes mean less memory or time.

### Memory

All values are MiB; changes compare medians.

| Workload | Live before | Live after | Change | Peak before | Peak after | Change |
|---|---:|---:|---:|---:|---:|---:|
| Blank + one write | 21.14 | 6.60 | -68.8% | 21.16 | 6.71 | -68.3% |
| Numeric 100k | 65.12 | 62.12 | -4.6% | 83.14 | 80.27 | -3.5% |
| XLSX 100k | 56.78 | 49.50 | -12.8% | 149.16 | 148.96 | -0.1% |
| Properties 100k | 29.45 | 21.94 | -25.5% | 29.34 | 21.91 | -25.3% |
| Formula chain 10k | 53.62 | 32.23 | -39.9% | 53.52 | 39.27 | -26.6% |
| SUM 100k | 66.63 | 63.44 | -4.8% | 84.44 | 81.40 | -3.6% |
| History 1k | 30.60 | 15.98 | -47.8% | 30.47 | 15.85 | -48.0% |

### Speed

Times are milliseconds; changes compare medians.

| Workload | Wall before | Wall after | Change | CPU before | CPU after | Change |
|---|---:|---:|---:|---:|---:|---:|
| Blank + one write | 1.92 | 1.10 | -42.8% | 1.84 | 1.01 | -45.4% |
| Numeric 100k | 45.66 | 43.73 | -4.2% | 45.47 | 43.47 | -4.4% |
| XLSX 100k | 137.26 | 119.08 | -13.2% | 136.76 | 118.72 | -13.2% |
| Properties 100k | 30.37 | 31.51 | +3.7% | 30.23 | 31.41 | +3.9% |
| Formula chain 10k | 524.20 | 279.59 | -46.7% | 523.76 | 278.90 | -46.7% |
| SUM 100k | 246.08 | 66.59 | -72.9% | 245.87 | 66.45 | -73.0% |
| History 1k | 41.67 | 30.40 | -27.0% | 41.56 | 30.30 | -27.1% |

SUM now takes 72.9% less total time than the original baseline. Its 100-edit
recalculation phase takes 23.620 ms instead of 201.846 ms, an 88.3% reduction.
Total SUM ranges are 235–253 ms before and 66–69 ms after.

**Properties remains a small regression:** 31.51 ms versus 30.37 ms (+3.7%),
with observed ranges of 31.42–35.27 ms and 29.78–31.25 ms respectively.
Neither option changes property storage or access; the immediate storage-model
baseline takes 32.01 ms and overlaps both options' ranges.

**Authored numeric reads also remain slower:** 6.446 ms versus 3.573 ms (+80.4%).
Faster hydration offsets this in the total numeric workload. The two aggregate
changes do not address that read path. Imported numeric reads retain their gain,
at 1.709 ms versus 5.815 ms.

### Operation timings

Times are milliseconds; phases exclude process startup and teardown.

| Workload / phase | Before | After | Change |
|---|---:|---:|---:|
| Blank + one write / `create` | 0.829 | 0.156 | -81.2% |
| Blank + one write / `write` | 0.066 | 0.046 | -29.7% |
| Numeric 100k / `hydrate` | 35.128 | 30.540 | -13.1% |
| Numeric 100k / `read_100k` | 3.573 | 6.446 | +80.4% |
| XLSX 100k / `parse_hydrate` | 128.976 | 114.999 | -10.8% |
| XLSX 100k / `read_100k` | 5.815 | 1.709 | -70.6% |
| Properties 100k / `write_properties` | 14.408 | 14.995 | +4.1% |
| Properties 100k / `read_properties` | 9.977 | 10.391 | +4.1% |
| Formula chain 10k / `hydrate_recalc` | 20.777 | 20.656 | -0.6% |
| Formula chain 10k / `recalc_10` | 496.638 | 254.064 | -48.8% |
| SUM 100k / `hydrate_recalc` | 36.789 | 35.732 | -2.9% |
| SUM 100k / `recalc_100` | 201.846 | 23.620 | -88.3% |
| History 1k / `write_1000` | 15.129 | 11.817 | -21.9% |
| History 1k / `undo_1000` | 11.631 | 8.346 | -28.2% |
| History 1k / `redo_1000` | 12.352 | 8.785 | -28.9% |

### Separating the two options

The immediate baseline below is the storage model at `b3ffbd721`, before either
option. This separate comparison attributes the aggregate improvements without
changing the original reference in the seven-workload tables above.

Recalculation times cover 100 input edits and SUM result checks, in milliseconds.

| Workload | Immediate baseline | Option 1 | Option 2 | Both |
|---|---:|---:|---:|---:|
| Numeric SUM 100k | 417.237 | 22.412 | 415.901 | 23.620 |
| Mixed SUM 100k | 962.698 | 612.987 | 899.608 | 571.047 |

Option 1 avoids preparing an unused 100,000-cell array on each numeric SUM edit.
Option 2 alone leaves that preparation in place, so it does not improve this
numeric case. The option-1 and combined numeric timing ranges overlap
(22.15–23.40 ms and 22.76–24.00 ms).

For the mixed column, option 1 reduces recalculation time by 36.3%; option 2
alone reduces it by 6.6%. Both reduce it by 40.7%, with a further 6.8% reduction
relative to option 1 alone. Combined mixed recalculation ranges from
556–585 ms, below option 1's 607–701 ms. The combined change therefore retains
option 1's main gain while also helping mixed-value aggregates.

Memory measurements for the same option comparison, in MiB:

| Workload / metric | Immediate baseline | Option 1 | Option 2 | Both |
|---|---:|---:|---:|---:|
| Numeric SUM / live | 63.50 | 63.44 | 63.38 | 63.44 |
| Numeric SUM / peak | 81.38 | 81.38 | 81.20 | 81.40 |
| Mixed SUM / live | 63.51 | 63.44 | 63.37 | 63.43 |
| Mixed SUM / peak | 81.40 | 81.39 | 81.38 | 81.39 |

Removing temporary range/tagged-value arrays does not produce a meaningful
change in whole-process RSS for these workloads. The initial workbook setup
and allocator retention still contribute to both measurements.

The [raw measurements](benchmarks/sum-aggregation-paired.json) include all five
variants, samples, ranges, CPU timings, memory metrics, and build provenance.

## Changes evaluated

**Option 1: defer unnecessary range arrays.** The scheduler previously prepared
an owned array for every statically referenced range before evaluating a
formula. Direct aggregates can instead use the existing numeric cache or borrow
a column. Their range arrays are now created only if evaluation requests one.
Other consumers of the same range retain their eager preparation, and dependency
tracking is unchanged. Evaluator and planner share the supported function names
and direct-range argument classification.

**Option 2: stream borrowed aggregate values.** The borrowed-column fallback
previously cloned values into a temporary tagged-value vector before reducing
them. It now reduces borrowed values directly. Both borrowed and evaluated
inputs use the same reducers, preserving value provenance, error order, and
the existing Kahan or double-double arithmetic. Aggregate operations are passed
explicitly instead of inferred from function-pointer addresses.

Neither option adds partial-sum caching, frequency tracking, or another
authoritative cell store. Complex expressions still use the existing evaluated
array path.

## Measurement method

The release benchmark validates all returned results. Each version runs in a
fresh process, pinned to CPU 0 with `RAYON_NUM_THREADS=1`. Each workload has one
warmup per version and five measured repeats, alternating version order. Builds
and tests finish before sampling. All versions use the same machine and Rust
toolchain (Linux aarch64, Rust 1.98.0), with a separate Cargo target directory
for each source worktree.
Immutable binary copies preserve each variant before the next change is built.
The run covers 39 supported variant/workload combinations and 234 processes,
including warmups; all result assertions passed.

The seven original workloads retain their inputs and assertions. An additional
`mixed_sum_100k` workload replaces the last numeric input with text and verifies
the resulting SUM after 100 input edits. This forces the borrowed-column
fallback and measures option 2 separately from the numeric cache. Its harness
is identical across the four storage-model variants; the original binary does
not contain this extra workload.

Live RSS measures memory retained while the engine is still alive. Peak RSS
includes temporary allocations. Total wall time includes setup, assertions,
teardown, and the measurement wrapper; Rust phase timers isolate hydration and
recalculation. Raw samples include medians, observed ranges, and source/binary
hashes. Small timing differences with overlapping ranges should not be treated
as reliable improvements.

The workload implementation is
[`storage_bench.rs`](../../compute/core/examples/storage_bench.rs). To run
either SUM workload from a fresh release build:

```sh
cargo build --release --locked -p compute-core --example storage_bench --target-dir /tmp/mog-sum-target
RAYON_NUM_THREADS=1 taskset -c 0 /usr/bin/time -f 'peak_rss_kib %M' /tmp/mog-sum-target/release/examples/storage_bench sum_100k
RAYON_NUM_THREADS=1 taskset -c 0 /usr/bin/time -f 'peak_rss_kib %M' /tmp/mog-sum-target/release/examples/storage_bench mixed_sum_100k
```

[`storage_bench.py`](../../scripts/bench/storage_bench.py) supplies the XLSX
fixture, sample collection, median calculation, and source fingerprinting used
in this comparison. For paired measurements, build each worktree separately
first, then alternate immutable binaries while keeping builds and tests idle.
Only the original baseline uses the legacy engine accessor spelling, and it
does not support the additional mixed workload. The four experiment variants
share an identical benchmark source hash.

## Correctness checks

The combined implementation passed
`cargo test --workspace --locked --no-fail-fast`: **19,481 passed, zero failed,
89 ignored**, across 300 test targets. The aggregate tests also passed with
`dd-precision` enabled, including preservation of the low component of a
double-double sum.

New regression coverage exercises all seven aggregate functions, mixed value
types and provenance, first-error ordering, omitted arguments, deferred arrays,
shared aggregate/array consumers, on-demand fallback, pending edits, formula
replacement, imported range overrides, and row insertion/deletion.
