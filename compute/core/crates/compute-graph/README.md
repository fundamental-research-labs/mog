# compute-graph

CellId-keyed dependency graph for the Mog compute engine — cycle detection,
topological sort, and range-aware invalidation.

## What it does

Tracks formula dependencies in a spreadsheet:

- **Cell-to-cell edges**: `B1 = A1 + 1` → B1 depends on A1
- **Range-group edges**: `D1 = SUM(A1:A500)` → D1 depends on a rectangular region
- **Selectivity-aware cycle detection**: distinguishes aggregate (SUM) vs selective (INDEX) range access to avoid false cycles
- **Evaluation order**: position-aware topological sort with barrier nodes
- **Partial recalc**: given changed cells, compute the minimal affected set
- **Hypothetical cycle check**: test whether a proposed edit would create a cycle without mutating the graph

## Quick start

```rust
use compute_graph::{DependencyGraph, DepTarget};
use compute_graph::positions::CellPosition;
use cell_types::{CellId, SheetId, RangePos};

let mut graph = DependencyGraph::new();
let a1 = CellId::from_raw(1);
let b1 = CellId::from_raw(2);
let c1 = CellId::from_raw(3);

// B1 depends on A1; C1 depends on B1
graph.set_precedents(&b1, vec![DepTarget::Cell(a1)]);
graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);

// When A1 changes, find affected cells (with position-aware analysis)
let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
let affected = graph.affected_cells(&[a1], &null_resolver).into_value();
assert!(affected.contains(&a1));
assert!(affected.contains(&b1));
assert!(affected.contains(&c1));

// Cycle detection (also position-aware)
assert!(graph.detect_cycles(&null_resolver).into_value().is_empty());
```

## Public API

### Core types

- **`DependencyGraph`** — the main graph struct
- **`DepTarget`** — dependency target: `Cell(CellId)` or `Range(RangePos, RangeAccess)`
- **`RangeAccess`** — `Aggregate` (SUM, AVERAGE) vs `Selective` (INDEX, CHOOSE)
- **`GraphError`** — error enum (`CycleDetected` with core + downstream cells)

### Builders and batch operations

- **`GraphBuilder`** — bulk-load builder with deferred index construction
- **`BatchMutations`** — RAII guard for batching mutations with deferred range-index rebuilds

### Position-aware analysis

- **`PositionResolver`** — trait: `CellId → Option<CellPosition>`
- **`CellPosition`** — `{ sheet, row, col }` geometric position
- **`Analyzed<T>`** — result paired with `AnalysisCompleteness` (`Exact` | `Incomplete`)
- **`WithOverrides`** — wraps a resolver with caller-supplied position overrides
- **`HypotheticalDependencyEdit`** — describes a proposed edit for `would_create_cycle`

### Analysis methods

| Method | Purpose | Cycle contract |
|---|---|---|
| `affected_cells` | Dirty-set expansion from changed cells | Cycle-tolerant |
| `affected_cells_levels` | Dirty-set grouped by topological level | Cycle-tolerant, returns `(levels, cycle_cells)` |
| `evaluation_levels` | Full-graph topological ordering | Cycle-failing (`Result<_, GraphError>`) |
| `subset_levels` | Partial-recalc topo ordering | Cycle-tolerant, returns `(levels, cycle_cells)` |
| `detect_cycles` | Diagnostic cycle enumeration | Returns all cycle groups |
| `would_create_cycle` | Hypothetical edit-time cycle check | Boolean, infallible |

## Design

### Symbol-geometry separation

The graph is keyed by `CellId` — a stable symbolic identifier that never changes
when rows or columns are inserted or deleted. Geometric position information is
supplied on-demand via the `PositionResolver` trait, keeping the graph decoupled
from the coordinate system.

### Two-tier edge model

Small ranges (< 256 cells) are expanded to individual cell edges for
fine-grained invalidation. Large ranges are stored as `DepTarget::Range` entries
with coarse-grained invalidation via an augmented interval tree, bounding memory
usage regardless of range size.

### Range-aware topological sort

Range dependencies are modeled with virtual "barrier" nodes during topological
sort, reducing O(N×M) cross-product edges to O(N+M) per range. This keeps
sort cost linear in graph size even with many large-range formulas.

### Selectivity-aware cycle detection

`DepTarget::Range` carries a `RangeAccess` tag:

- **`Aggregate`** (SUM, AVERAGE) — reads every cell; barrier includes all contained cells
- **`Selective`** (INDEX, CHOOSE) — reads a dynamic subset; back-edge filtering
  excludes cells with back-edges to the dependent formula, preventing false cycles
  from whole-column INDEX patterns

### Completeness tracking

All position-aware analysis methods return `Analyzed<T>`, pairing the result
with an `AnalysisCompleteness` flag (`Exact` or `Incomplete`). When positions
cannot be resolved, the engine conservatively over-invalidates rather than
fabricating structure.

### Algorithms

| Operation | Cost |
|---|---|
| Cycle detection | O(V + E) DFS, selectivity-aware |
| Topological sort | O(V + E) Kahn's algorithm with barrier nodes |
| Partial recalc (dirty-set) | O(V + E) BFS + topo sort |
| Partial recalc (range-aware) | O(V + E + R) with barrier nodes |
| Range containment query | O(log R + K) via augmented interval tree |
| Max depth | O(V × D) with memoization |

### Safety

- `#![forbid(unsafe_code)]` — zero unsafe, enforced at compile time
- Iterative algorithms with explicit stacks (no stack overflow on deep chains)
- Static `Send + Sync` assertion for thread safety
- Precedent deduplication invariant maintained across all mutation paths

## Module structure

- **`error`** — `GraphError` enum (cycle detection errors with core + downstream classification)
- **`mutations`** — adding/removing edges, volatile marking, bulk operations, `BatchMutations`, `GraphBuilder`
- **`queries`** — precedent/dependent lookups, `EdgeStats`, range containment queries
- **`analysis`** — position-aware analysis: dirty-set expansion, leveled topo sort, cycle detection, hypothetical cycle check
- **`positions`** — `PositionResolver` trait, `Analyzed<T>`, `CellPosition`, `WithOverrides`, `HypotheticalDependencyEdit`
- **`topo`** — depth computation, Tarjan SCC, Kahn's sort helpers
- **`range_index`** — spatial index wrapping the interval tree
- **`interval_tree`** — augmented interval tree for point-in-range queries

## Testing

```bash
cargo test -p compute-graph         # 239 tests (unit + property + doc)
cargo bench -p compute-graph        # criterion benchmarks (1K–50K cells)
cargo run -p compute-graph --example spreadsheet_recalc
```
