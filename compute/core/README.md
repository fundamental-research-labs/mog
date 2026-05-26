# compute-core

Native Rust compute engine for the Shortcut spreadsheet OS. All formula parsing,
evaluation, dependency tracking, recalculation, and data transforms run in this
crate (or its extracted sub-crates). TypeScript owns storage (Yrs CRDT), UI, and
structural operations; Rust owns compute. Communication crosses the IPC boundary
via Tauri commands (desktop) or WASM bindings (web).

```
TypeScript (owns storage + UI)              Rust (owns compute)
+---------------------------------+        +----------------------------------+
| Yjs Document (source of truth)  |        | compute-core crate               |
| Cell Identity Model             | -IPC-> | Cell Mirror (identity-keyed)     |
| UndoManager, EventBus          |        | Formula Parser (winnow)          |
| Structural ops, Canvas         | <-res- | AST Evaluator                    |
| React UI, Selection            |        | Function Library (508+)          |
| Formatting, Number display     |        | Dependency Graph (CellId)        |
+---------------------------------+        | Recalc Scheduler (rayon)         |
                                           +----------------------------------+
```

The compute-core workspace slice contains the root crate plus 28 extracted
sub-crates.


## Table of Contents

- [Architecture](#architecture)
- [Crate Catalog](#crate-catalog)
- [Type System](#type-system)
- [Re-export Strategy](#re-export-strategy)
- [Root Crate Modules](#root-crate-modules)
- [Dependency Graph](#dependency-graph)
- [Build and Test](#build-and-test)
- [Feature Flags](#feature-flags)
- [Wire Protocol](#wire-protocol)


## Architecture

The engine is split into a **root orchestration crate** (`compute-core`) and **28
extracted sub-crates** organized into type/support crates and domain crates.

### Design Principles

1. **Identity-keyed, not position-keyed.** All data structures use `CellId` (u128)
   as the primary key. Position (`row, col`) is ephemeral and resolved via index.
2. **Zero-copy at boundaries.** The wire protocol (`compute-wire`) serializes
   viewport data as flat `Vec<u8>` blobs read directly via `DataView` in
   TypeScript -- no JSON parsing per cell.
3. **Layered type crates.** Runtime type crates form a strict dependency DAG.
   Leaf crates depend only on the types they need, minimizing compile-time coupling.
4. **Native/WASM duality.** The `native` feature gates `rayon` (parallel recalc)
   and `parking_lot` (fast locks). WASM builds fall back to single-threaded eval.
5. **Extracted purity.** Sub-crates are pure computation with zero IO, zero
   global state, and no dependency on the root crate.

### Data Flow

```
Cell Edit (TS)
    |
    v
[IPC Boundary] -- WorkbookSnapshot (JSON) or CellEdit (bincode) -->
    |
    v
CellMirror (identity-keyed cell store)
    |
    v
compute-parser (winnow) --> ASTNode
    |
    v
DependencyGraph (compute-graph) --> topological levels + cycle detection
    |
    v
Scheduler (shared Evaluator + MirrorContext, four orchestration paths)
    |
    |   ┌── Incremental topo ──── small dirty set → subset_levels() → level eval
    |   ├── Full topo ─────────── pre-computed global levels → level eval
    +-->├── Cycle recovery ────── SCC seeding → single-pass or iterative convergence
    |   └── Data table prepass ── mutate-recalc-restore per (row,col) override
    |
    +---> Evaluator::evaluate() --> compute-functions (508+ pure fns)
    |     (single entry point)      compute-table (structured refs)
    |                               compute-cf (conditional formatting)
    |                               compute-pivot (pivot tables)
    |                               compute-schema (validation)
    |
    v
RecalcResult --> [IPC Boundary] --> MutationResult binary (compute-wire)
    |
    v
TypeScript renderer (zero-parse DataView reads)
```

> **Why four paths?** All share the same `Evaluator::evaluate()` and `MirrorContext`.
> The difference is orchestration: incremental vs full topo sort (performance),
> cycle recovery (correctness — SCC seeding + convergence), and data table prepass
> (correctness — mutate-recalc-restore requires per-write cache invalidation
> incompatible with level-batched eval). See `scheduler/mod.rs` for details.


## Crate Catalog

### Type and Support Crates (7)

Located under `crates/types/`. These form the foundation layer -- every domain
crate depends on one or more runtime type crates. The `finite-at-boundary*`
crates are boundary-audit support for the type layer.

| Crate | Path | Internal Deps | Purpose |
|-------|------|---------------|---------|
| **value-types** | `crates/types/value-types` | none | `CellValue`, `CellError`, `FiniteF64`, `Color`, `CellArray`, `date_serial`, `LambdaNode`, `KahanSum` |
| **cell-types** | `crates/types/cell-types` | none | `CellId`, `SheetId`, `RowId`, `ColId`, `CellPos`, `RangePos`, `SheetPos`, `col_to_letter` |
| **formula-types** | `crates/types/formula-types` | value-types, cell-types | `CellRef`, `RangeRef`, `StructuredRef`, `IdentityFormula`. Re-exports all of value-types and cell-types. |
| **pivot-types** | `crates/types/pivot-types` | value-types, cell-types | Pivot table type definitions shared across pivot, relational, domain, and XLSX code. |
| **snapshot-types** | `crates/types/snapshot-types` | value-types, cell-types, formula-types | `WorkbookSnapshot`, `RecalcResult`, `CellEdit`, `MutationResult`, `SheetSnapshot` |
| **finite-at-boundary** | `crates/types/finite-at-boundary` | none | Proc attribute marking intentional bare `f64` boundary fields. |
| **finite-at-boundary-walker** | `crates/types/finite-at-boundary-walker` | none | Test walker that enforces finite numeric boundary contracts. |

### Domain Crates (21)

Located under `crates/`. Pure computation modules, each independently testable.

| Crate | Path | Internal Deps | Purpose |
|-------|------|---------------|---------|
| **compute-parser** | `crates/compute-parser` | formula-types | Winnow-based formula parser: lexer, expression grammar, AST nodes, A1/R1C1 references, structured ref parsing, identity transforms, normalization |
| **compute-functions** | `crates/compute-functions` | value-types, cell-types, compute-formats, compute-solver | 508+ Excel-compatible pure functions: math, text, date/time, lookup, statistical, financial, engineering, database, logical, information |
| **compute-formats** | `crates/compute-formats` | value-types | Excel-compatible number format engine: locale, color, currency patterns, custom format codes |
| **compute-stats** | `crates/compute-stats` | value-types | Statistical primitives: aggregation, filtering, sorting, value semantics, descriptive stats, regression, KDE. Welford's (variance) + Kahan (summation) |
| **compute-graph** | `crates/compute-graph` | cell-types | CellId-keyed dependency graph: cycle detection, topological sort (Kahn's algorithm), range-aware invalidation |
| **compute-table** | `crates/compute-table` | value-types, cell-types, formula-types | Table engine: filters, sort, slicers, slicer-cache, structured refs, styles, visibility bitmaps, filter-resolve |
| **compute-pivot** | `crates/compute-pivot` | value-types, cell-types, compute-stats, pivot-types | Pivot table engine: aggregation, grouping (date/numeric), sorting, filtering, show-values-as transforms, expansion state |
| **compute-cf** | `crates/compute-cf` | value-types, cell-types, formula-types | Conditional formatting: rule evaluation (cell value, formula, top N, data bars, color scales, icon sets), cascade resolution |
| **compute-schema** | `crates/compute-schema` | value-types, cell-types | Schema engine: type validation, inference, coercion, constraint checking, editor resolution, format bridge |
| **compute-charts** | `crates/compute-charts` | compute-stats | Chart data transforms: statistics, regression, density, binning, stacking, grouping |
| **compute-solver** | `crates/compute-solver` | none | Numerical optimization: Nelder-Mead, BFGS, L-BFGS-B, Differential Evolution, root finding (bisection/Brent/Newton), auto dispatch |
| **compute-collab** | `crates/compute-collab` | none | Yrs sync protocol: state vector exchange, diff computation, update application (lib0 v1 wire format) |
| **compute-document** | `crates/compute-document` | formula-types, cell-types | CRDT document layer: Yrs schema definition, cell serde (hex encoding), identity mapping, undo support, observation hooks |
| **compute-wire** | `crates/compute-wire` | formula-types, value-types, cell-types, snapshot-types, compute-cf, compute-security | Binary wire protocol: viewport serialization, mutation patches, FormatPalette interning, TS codegen |
| **compute-fill** | `crates/compute-fill` | value-types, cell-types, formula-types | Autofill engine: pattern detection, series generation, formula reference adjustment |
| **compute-relational** | `crates/compute-relational` | value-types, cell-types, compute-stats, pivot-types | Relational compute engine: GROUP BY, aggregation, window functions over tabular data |
| **compute-coordinator** | `crates/compute-coordinator` | cell-types, compute-collab, compute-document | Multi-participant sync coordinator with sheet-level locking |
| **compute-layout-index** | `crates/compute-layout-index` | none | Spatial layout index: Fenwick tree over dimension deltas for O(log k) cell-to-pixel mapping |
| **compute-text-measurement** | `crates/compute-text-measurement` | none | Text measurement engine for autofit, PDF export, and server-side layout |
| **compute-screenshot** | `crates/compute-screenshot` | compute-wire, compute-layout-index, compute-text-measurement | Headless sheet screenshot rasterizer over `ViewportRenderData` |
| **compute-security** | `crates/compute-security` | value-types, cell-types | Privacy policy types and access-control engine for compute-core |

### Root Crate

| Module | Purpose |
|--------|---------|
| `compute-core` (root) | Orchestration: CellMirror, AST evaluator, recalc scheduler, identity model, Yrs storage, projection registry, data tables, what-if analysis, solver integration, bridge wrappers |

## Type System

The runtime type crates encode a deliberate separation of concerns:

```
                     +-----------+     +-----------+
                     |value-types|     |cell-types |
                     | (WHAT)    |     | (WHERE)   |
                     +-----+-----+     +-----+-----+
                           |                 |
                           +--------+--------+
                                    |
                              +-----v------+
                              |formula-types|
                              | (HOW)       |
                              +-----+-------+
                                    |
                              +-----v------+
                              |snapshot-types|
                              | (IPC)       |
                              +-------------+
```

| Crate | Role | Key Types | Rationale |
|-------|------|-----------|-----------|
| **value-types** | WHAT is the data? | `CellValue`, `CellError`, `FiniteF64`, `Color`, `CellArray` | Leaf crate. Every crate that touches cell values depends only on this. Zero internal deps. |
| **cell-types** | WHERE does data live? | `CellId`, `SheetId`, `RowId`, `ColId`, `CellPos`, `RangePos` | Leaf crate. `CellId` is `#[repr(transparent)]` over `u128` -- UUID bytes, `Copy`, single-instruction equality, zero-cost `FxHashMap` keys. |
| **formula-types** | HOW is data computed? | `CellRef`, `RangeRef`, `StructuredRef`, `IdentityFormula` | Re-exports `value-types::*` and `cell-types::*`. Adds formula-level abstractions: resolved vs positional refs, structured table references, OOXML compatibility. |
| **pivot-types** | HOW is pivot state shared? | `PivotTable`, `PivotField`, `PivotCacheDefinition` | Shared pivot contracts used by compute, domain, and file-IO code. |
| **snapshot-types** | IPC contracts | `WorkbookSnapshot`, `RecalcResult`, `CellEdit`, `MutationResult` | The serialization boundary between Rust and TypeScript. Two paths: JSON (string UUIDs) and bincode (raw u128). |

### u128 Identity Strategy

`CellId`, `SheetId`, `RowId`, `ColId` are newtypes over `u128` -- the raw bytes
of a UUID. This gives us:

- `Copy` semantics (no heap allocation)
- Single-instruction equality comparison
- Zero-cost hashing with `FxHashMap` (the 128-bit value IS the hash)
- UUID string parsing happens only at the IPC boundary

### CellRef: Resolved vs Positional

In the Cell Identity Model, `CellId`s are created lazily -- empty cells have
no identity. A formula `=A1+B1` where B1 is empty stores:
- `CellRef::Resolved(cell_id)` for A1 (has data, has identity)
- `CellRef::Positional(sheet, row, col)` for B1 (empty, resolved at eval time)

When the user types into B1, the positional ref gets promoted to resolved.


## Re-export Strategy

Extracted crates are re-exported from the root crate using `pub use ... as ...`
aliases, so that all downstream code can use `compute_core::X::*` paths without
knowing whether `X` is an inline module or an extracted crate:

```rust
// In compute/core/src/lib.rs:
pub use compute_functions as functions;   // compute_core::functions::*
pub use compute_graph as graph;           // compute_core::graph::*
pub use compute_formats as formats;       // compute_core::formats::*
pub use compute_charts as charts;         // compute_core::charts::*
pub use compute_cf as cf;                 // compute_core::cf::*
pub use compute_collab as collab;         // compute_core::collab::*
pub use compute_document as document;     // compute_core::document::*
pub use compute_pivot as pivot;           // compute_core::pivot::*
pub use compute_table as table;           // compute_core::table::*
pub use compute_schema as schema;         // compute_core::schema::*
pub use snapshot_types as snapshot;       // compute_core::snapshot::*
```

Key types are also re-exported at the crate root for convenience:

```rust
pub use formula_types::{CellError, CellId, CellRef, CellValue, ...};
pub use snapshot::{RecalcResult, WorkbookSnapshot};
```

This means extracting a module to its own crate requires zero import changes in
consuming code -- just add the `pub use` alias and update `Cargo.toml`.


## Root Crate Modules

These modules live in `compute/core/src/` and have NOT been extracted to separate
crates because they depend on multiple sub-crates or own mutable state:

| Module | Description |
|--------|-------------|
| `mirror` | **CellMirror** -- identity-keyed in-memory cell store. Dense columnar storage per sheet. The read-side data structure that the evaluator queries. |
| `eval` | **AST Evaluator** -- recursive descent evaluator that walks `ASTNode` trees. Two trait hierarchies: `EvalDataAccess` (async data reads) and `EvalMetadata` (sync positional/structural queries). Sub-modules: `core` (dispatch), `context` (traits), `cache` (multi-tier), `lookup` (INDEX/MATCH/XLOOKUP), `functions` (special dispatch), `coordination` (cycle detection, vectorized eval). |
| `scheduler` | **Recalc Scheduler** -- top-level `ComputeCore` struct. Owns the CellMirror, DependencyGraph, and AST cache. Processes edits by parsing, building the dep graph, and evaluating in topological order. Level-based parallel recalc with rayon (native) or sequential fallback (WASM). |
| `identity` | Per-sheet identity-to-position tracker. Maps `CellId <-> (row, col)` for the Cell Identity Model. |
| `storage` | Yrs-backed CRDT storage. Hybrid of `yrs::Doc` + `CellMirror`. Reads/writes cells, dimensions, properties, sheets. The persistence layer. |
| `projection` | Dynamic array projection registry. Spatial index tracking which cells are spill array members. |
| `domain_types` | Pure serializable data contracts for domain features (charts, ranges, etc.). |
| `what_if` | What-If Analysis -- scenario management (Goal Seek moved to solver, Data Tables to `data_table`). |
| `solver` | Solver module -- numerical optimization integration (root finding for Goal Seek, multi-variable via Python fallback). |
| `data_table` | Data Table -- parametric formula evaluation (one/two-variable data tables). |
| `bridge_pure` | Bridge Mode 1 wrappers -- zero-sized types with `#[bridge::api]` annotations for generating WASM/Tauri bindings for stateless functions (pivot, schema, parser, etc.). |
| `range_manager` | `pub(crate)` A1-style range parsing utilities, no Yrs dependency. |


## Dependency Graph

Arrows point from dependent to dependency. Type crates are at the bottom (leaves).

```
                          compute-core (root orchestrator)
                         /   |    |    |    \    \    \
                        /    |    |    |     \    \    \
                       v     v    v    v      v    v    v
              scheduler  eval  mirror  storage  bridge_pure  ...
                 |        |      |       |
    +------------+--------+------+-------+-----------+
    |            |        |      |       |           |
    v            v        v      v       v           v
compute-    compute-  compute- compute- compute-  compute-
parser      functions  table   graph    cf        pivot
    |            |        |      |       |           |
    |            |        |      |       |           |
    v            v        v      v       v           v
formula-    value-    formula- cell-   value-     value-
types       types     types    types   types +    types +
    |                                  cell-      compute-
    v                                  types      stats
value-types + cell-types + ooxml-types                |
                                                      v
                                                  value-types

Standalone domain crates with zero compute-core internal deps:
  compute-solver, compute-collab, compute-layout-index, compute-text-measurement

CRDT layer:
  compute-document --> formula-types + cell-types + yrs
  compute-coordinator --> cell-types + compute-collab + compute-document

Wire protocol:
  compute-wire --> formula-types + value-types + cell-types + snapshot-types
               --> compute-cf + compute-security

Charts:
  compute-charts --> compute-stats --> value-types

Rendering:
  compute-screenshot --> compute-wire + compute-layout-index + compute-text-measurement
```

### Layered View

```
Layer 4 (orchestration):  compute-core
Layer 3 (domain):         parser, functions, table, graph, cf, pivot,
                          schema, formats, charts, stats, solver, collab,
                          document, wire, fill, relational, coordinator,
                          layout-index, text-measurement, screenshot, security
Layer 2 (type bridge):    formula-types, pivot-types, snapshot-types
Layer 1 (leaf types):     value-types, cell-types
Layer 1 support:          finite-at-boundary, finite-at-boundary-walker
Layer 0 (external):       ooxml-types
```


## Build and Test

All commands run from the workspace root.

### Quick Check

```bash
# Type-check the root crate (lib only, skips integration tests)
cargo check -p compute-core --lib

# Type-check a specific sub-crate
cargo check -p compute-parser
cargo check -p compute-table
```

### Running Tests

```bash
# All tests for a sub-crate
cargo test -p compute-table          # 806 tests
cargo test -p compute-functions      # 825 tests
cargo test -p compute-cf             # 550 tests
cargo test -p compute-parser         # 484 tests
cargo test -p compute-pivot          # 405 tests
cargo test -p compute-stats          # 362 tests
cargo test -p compute-solver         # 326 tests
cargo test -p value-types            # 255 tests
cargo test -p compute-formats        # 247 tests
cargo test -p compute-schema         # 230 tests
cargo test -p compute-charts         # 181 tests
cargo test -p compute-graph          # 61 tests
cargo test -p formula-types          # 48 tests
cargo test -p cell-types             # 47 tests
cargo test -p snapshot-types         # 42 tests
cargo test -p compute-wire           # 33 tests
cargo test -p compute-document       # 33 tests
cargo test -p compute-collab         # 12 tests

# Root crate tests (unit + integration)
cargo test -p compute-core

# Run a specific test module
cargo test -p compute-table -- filter
cargo test -p compute-functions -- financial

# Run all workspace tests
cargo test --workspace
```

### Benchmarks

```bash
# Parser benchmarks
cargo bench -p compute-core --bench parser_bench

# Evaluator benchmarks
cargo bench -p compute-core --bench eval_bench

# Parser crate benchmarks
cargo bench -p compute-parser --bench parse_benchmark

# Pivot benchmarks
cargo bench -p compute-pivot --bench pivot_benchmarks
```

### Integration Tests

Integration tests live in `compute/core/tests/` and cover cross-crate scenarios:

```
tests/
  cross_sheet_tests.rs          # Cross-sheet formula evaluation
  formula_accuracy_*.rs         # Excel formula accuracy validation (7 files)
  recalc_*.rs                   # Recalc correctness (circular refs, dense aggregate, projection, vectorized)
  schema_*.rs                   # Schema editor, format bridge, validator
  bench_*.rs                    # Benchmark-style integration tests
  overflow_countifs_sumifs.rs   # Edge cases in aggregate functions
  cache_benchmark.rs            # Cache performance
```


## Feature Flags

Defined in `compute/core/Cargo.toml`:

| Feature | Default | Description |
|---------|---------|-------------|
| `native` | yes | Enables `rayon` (parallel recalc) and `parking_lot` (fast RwLock). Gates desktop-only code paths. |
| `power-query-full` | no | Enables full Power Query CRUD -- gates unwired functions. |
| `profile` | no | Enables `tracing` spans in eval hot paths. Zero overhead when off (single atomic load per span check). |

### WASM Target

WASM builds are detected via `#[cfg(target_arch = "wasm32")]` -- no explicit
feature needed. WASM-specific dependency overrides:

- `getrandom` with `js` feature (random number source for rand/nalgebra/statrs)
- `uuid` with `js` feature (v4 UUID generation)

### Workspace Profiles

| Profile | opt-level | LTO | debug | panic | Use |
|---------|-----------|-----|-------|-------|-----|
| `dev` | 0 | no | yes | unwind | Development |
| `release` | 3 | full | no | abort | Production |
| `crashtest` | 3 | full | no | unwind | XLSX crash testing (catch_unwind works) |


## Wire Protocol

`compute-wire` defines the binary serialization format for transferring viewport
data from Rust to TypeScript with zero JSON parsing overhead. See
[`crates/compute-wire/README.md`](crates/compute-wire/README.md) for the full
protocol specification.

### Viewport Protocol (summary)

```
[Header 32B][CellRecords N*24B][StringPool][Merges M*16B][RowDims][ColDims][FormatPaletteJSON]
```

- Cells: dense row-major, 24 bytes each (f64 value + string pool offsets + flags + format index)
- String pool: raw UTF-8 with offset/length pairs per cell
- Format palette: append-only interned table (typically 5-20 unique formats vs thousands of cells)
- Little-endian throughout

### Mutation Protocol (summary)

```
[Header 16B][SheetID UTF-8][CellPatches N*32B][StringPool][SpillSection?]
```

Patches individual cells into the existing viewport buffer without retransmitting
the full grid.

### TypeScript Codegen

Constants are generated from Rust to keep both sides in sync:

```bash
cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts
```


## Key External Dependencies

| Dependency | Version | Used By | Purpose |
|------------|---------|---------|---------|
| `winnow` | 0.6 | compute-parser | Formula parsing (nom successor, better errors) |
| `rayon` | 1.10 | compute-core (native) | Data-parallel recalculation |
| `rustc-hash` | 2 | many | FxHashMap -- ~5-10ns lookup with u128 keys |
| `chrono` | 0.4 | many | Date/time functions, serial date conversions |
| `statrs` | 0.17 | compute-functions | Statistical distributions (NORM.DIST, T.INV, etc.) |
| `nalgebra` | 0.32 | compute-functions | Linear algebra (MINVERSE, MMULT, LINEST) |
| `yrs` | 0.21 | compute-collab, compute-document, compute-core | Yjs CRDT port for collaborative editing |
| `bitvec` | 1 | compute-core | Null bitmaps in dense columnar store |
| `phf` | 0.11 | compute-core | Compile-time perfect hash for function registry |
| `stacker` | 0.1 | compute-core | Grow call stack on demand (deep dependency chains) |
| `serde` / `serde_json` | 1 | everywhere | Serialization at IPC boundary |
| `bincode` | 1 | compute-core | Fast binary serialization for large snapshots |
| `unicode-normalization` | 0.1 | compute-core | NFC normalization for sheet name keying |
| `regex` | 1 | compute-core, compute-schema | Structured ref patterns, formula updater |
| `dashmap` | 6 | compute-core | Lock-free concurrent hash map for parallel index building |
| `smallvec` | 1 | compute-core | Inline-optimized Vec for lookup index row lists |
| `ordered-float` | 4 | compute-core | Hashable f64 for exact-match lookup indexes |
| `rand` | 0.8 | compute-functions, compute-solver | Random number generation (RAND, RANDBETWEEN, DE) |
