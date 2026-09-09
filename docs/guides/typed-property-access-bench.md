# Typed property access and A1 resolution

This follows the [SUM range and streaming comparison](sum-aggregation-bench.md).
It removes ID serialization between native property callers and parses Office.js
range addresses once at the scripting boundary.

## Results

These measurements were captured at `f1b06b113`, before the subsequent PR
cleanup of unused mutation serializers and helpers. Raw samples and measured
binary/source hashes remain unchanged; this table is not a new timing run of
that cleanup.

Memory is live RSS in MiB; wall time is milliseconds. Before is the original
baseline, rerun under the same conditions. After includes the typed internal
calls and both SUM changes. The Properties row compares the original string-ID
path with the native-ID path now used by engine callers, using the same metadata
writes, owned reads, and assertions. The unchanged string-ID benchmark remains
a separate control below. The other six workloads retain their original entry
points.

| Workload | Memory before | Memory after | Change | Wall before | Wall after | Change |
|---|---:|---:|---:|---:|---:|---:|
| Blank + one write | 21.11 | 6.70 | -68.3% | 2.07 | 1.16 | -43.9% |
| Numeric 100k | 65.12 | 62.25 | -4.4% | 45.24 | 44.47 | -1.7% |
| XLSX 100k | 56.78 | 49.69 | -12.5% | 148.44 | 125.71 | -15.3% |
| Properties 100k (native engine path) | 29.44 | 21.88 | -25.7% | 32.67 | 29.35 | -10.2% |
| Formula chain 10k | 53.62 | 32.23 | -39.9% | 521.47 | 278.72 | -46.6% |
| SUM 100k | 66.62 | 63.44 | -4.8% | 232.90 | 66.93 | -71.3% |
| History 1k | 30.58 | 16.01 | -47.6% | 41.17 | 30.01 | -27.1% |

### Property access paths

The typed path changes only the ID representation passed into the property API.
It still creates and checks the same property-value strings and returns owned
property objects. The original binaries expose only the string-ID entry point.
This breakdown includes the compatibility string-ID control so its measured
slowdown remains visible alongside the migrated engine path.

| Version / access | Write ms | Read ms | Wall ms | CPU ms | Live MiB | Peak MiB |
|---|---:|---:|---:|---:|---:|---:|
| Original / strings | 14.874 | 10.231 | 32.67 | 32.19 | 29.44 | 29.34 |
| Previous SUM changes / strings | 15.385 | 10.277 | 32.18 | 32.01 | 21.93 | 21.91 |
| Current / strings | 16.614 | 10.864 | 37.39 | 36.82 | 21.87 | 21.73 |
| Current / native IDs | 14.049 | 8.833 | 29.35 | 29.18 | 21.88 | 21.72 |

All samples, ranges, phase timers, peak memory, CPU measurements, source hashes, and binary provenance are in the [raw measurements](benchmarks/typed-property-access-paired.json).

The native property path takes **29.35 ms**, compared with **32.67 ms** in the
original implementation (10.2% faster) and **32.18 ms** immediately before this
change (8.8% faster). Its retained memory is **21.88 MiB**, 25.7% below the
original 29.44 MiB and essentially unchanged from the previous storage layout.
Within the current binary, removing the ID round trip reduces the write phase
from 16.614 to 14.049 ms and the read phase from 10.864 to 8.833 ms.

The compatibility string adapter is **14.4% slower** than the original baseline
in this run. Its wall-time samples span 31.89–38.44 ms, versus 28.45–30.11 ms for
native IDs. The improvement applies to the migrated engine callers; this is not
a claim that callers retaining the string-ID API become faster.

The numeric SUM recalculation gain remains: 100 recalculations take
**187.30 ms original → 22.13 ms previous → 22.12 ms current**. Total SUM wall time
is 5.5% above the immediately previous build, mostly in setup/hydration, while
remaining 71.3% below the original baseline. Mixed-SUM wall time is 588.24 ms
previous versus 602.82 ms current (+2.5%), with overlapping sample ranges;
recalculation is 543.53 versus 557.95 ms. These runs do not establish an additional
SUM speedup from the identity changes.

The existing authored-numeric-read tradeoff also remains: the isolated 100k
read phase takes 3.80 ms original versus 6.63 ms current, although the complete
numeric workload is slightly faster and uses less memory. Those small total-time
differences should not be interpreted as a reliable additional speedup.

## Scope

Native property, formatting, protection, copy/fill, clear, and rendering calls
now pass `CellId` values. Their previous path formatted an existing 128-bit ID
as hexadecimal text and immediately parsed it back for a map lookup. Range
formatting and clearing also retain vectors of native IDs instead of temporary
hex strings. Existing string-ID entry points remain available as adapters for
Rust consumers and serialized boundaries.

The compute-api formatting facade uses native lookup/allocation results rather
than extracting an ID from a JSON mutation result. Allocation retains the same
history lifetime and blank-cell behavior. A read does not allocate identities.

Office.js still accepts A1 addresses exclusively. The host resolves each range
when its handle is created and retains its numeric rectangle for subsequent
loads and writes. Native entity lookups use typed IDs; range iteration uses
compact bounds so reading an empty or large range does not allocate an identity
for every grid position. Formula references retain their existing parsing and
binding rules. No entity-ID scripting API is added.

This change does not alter compact property records, introduce caches, or change
the two SUM optimizations. In the earlier options discussion, option 2 meant
reducing the separate allocations for a detailed record's header and payload.
That layout experiment is separate from this change. Owned property results
also retain their existing copy semantics; this comparison isolates ID handling.

## Measurement method

The original baseline remains `2a2f34cf48d99570c517b56033322692268586f6`.
The immediate comparison is `c2a94f64e37c91e59f33fe5415948f5e64aa535a`, with
both SUM optimizations. Their exact, previously verified release binaries are
rerun alongside the new build. The immediate comparison's captured source hash
also matches its committed source tree.

The original seven workloads retain their inputs, operations, and assertions.
An additional `properties_typed_100k` workload performs the same metadata writes,
owned reads, string checks, and checksum as `properties_100k`, but passes native
IDs directly. Both variants share one const-generic implementation; the legacy
variant still formats and parses IDs. This extra measurement shows the path now
used inside the engine, while the original workload remains a control. The
mixed-SUM workload also checks preservation of the streaming improvement.

Each supported variant/workload pair has one warmup and five measured repeats
in fresh processes. Runs alternate version order, use CPU 0 with
`RAYON_NUM_THREADS=1`, and start after builds and tests finish. Values are medians.
The typed and string property paths are interleaved within each repetition.
Wall time includes startup, setup, assertions, teardown, and the GNU time
wrapper; phase timers isolate reads, writes, and recalculation. Live RSS measures
retained memory while the store is alive; peak RSS includes transient allocations.
Small differences with overlapping ranges are not reliable speed changes.

Two earlier measurement series ran while a large Blender render was active on
the same machine. After the user stopped Blender, all comparisons were rerun
using the same verified binaries. Only that final series appears in the tables;
the contended series are retained under `excluded_contended_series` in the raw
artifact, together with the reason for excluding them.

The new diagnostic can be run with:

```sh
cargo build --release --locked -p compute-core --example storage_bench --target-dir /tmp/mog-properties-target
RAYON_NUM_THREADS=1 taskset -c 0 /usr/bin/time -f 'peak_rss_kib %M' /tmp/mog-properties-target/release/examples/storage_bench properties_typed_100k
```

## Verification

Verification covered `compute-core`, `compute-api`, and `mog`: **4,064 tests
passed, three ignored**, across the package suite and the final focused A1
range-reuse rerun. The package command was
`cargo test -p compute-core -p compute-api -p mog --locked --no-fail-fast`.
The final scripting regression loads values and formulas together and checks
reuse of the same absolute A1 range across three syncs.

New native tests cover zero and full-width 128-bit identities, imported style
metadata, preserving metadata while clearing formatting, and validation before
bulk format mutation. The API test checks formatting a blank cell and undo/redo
without changing its value. Existing formatting, copy/fill, protection, import,
history, and scripting regressions also ran. Changed Rust files pass rustfmt,
and `git diff --check` is clean.

The subsequent PR cleanup also passed
`cargo check --workspace --all-targets --locked` and
`cargo test -p compute-core -p compute-api -p mog -p compute-wire --locked --no-fail-fast -j 4`:
**4,161 passed, zero failed, 3 ignored**, across 154 targets. This includes
the retained viewport/CF coverage and malformed-ID validation through the
string adapters. The retired mutation protocol's tests and benchmarks were
removed with its implementation; no removal-only regression tests were added.
