//! Criterion benchmarks for the compute-graph crate.
//!
//! Covers the hot paths: bulk loading, partial recalc, cycle detection, and
//! topological sorting at scales representative of real workbooks (1K–100K formulas).

use cell_types::{CellId, RangePos, SheetId};
use compute_graph::{
    CellPosition, DepTarget, DependencyGraph, GraphBuilder, HypotheticalDependencyEdit, RangeAccess,
};
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};

// ============================================================================
// Helpers
// ============================================================================

fn cell(id: u64) -> CellId {
    CellId::from_raw(u128::from(id))
}

const fn sheet() -> SheetId {
    SheetId::from_raw(1)
}

/// Build a linear chain: cell(1) <- cell(2) <- ... <- cell(n).
/// Each cell depends on the previous one.
#[allow(clippy::cast_possible_truncation)]
fn build_linear_chain(n: u64) -> DependencyGraph {
    let mut builder = GraphBuilder::with_capacity(n as usize);
    for i in 2..=n {
        builder.set_precedents(&cell(i), vec![DepTarget::Cell(cell(i - 1))]);
    }
    builder.build()
}

/// Build a fan-in graph: cells 1..n all feed into cell(n+1).
#[allow(clippy::cast_possible_truncation)]
fn build_fan_in(n: u64) -> DependencyGraph {
    let mut builder = GraphBuilder::with_capacity(n as usize + 1);
    let deps: Vec<DepTarget> = (1..=n).map(|i| DepTarget::Cell(cell(i))).collect();
    builder.set_precedents(&cell(n + 1), deps);
    builder.build()
}

/// Build a diamond graph: n layers, each cell depends on 2 cells from the previous layer.
#[allow(clippy::cast_possible_truncation)]
fn build_diamond(layers: u64, width: u64) -> DependencyGraph {
    let total = layers * width;
    let mut builder = GraphBuilder::with_capacity(total as usize);
    for layer in 1..layers {
        for col in 0..width {
            let id = layer * width + col;
            let dep1 = (layer - 1) * width + col;
            let dep2 = (layer - 1) * width + ((col + 1) % width);
            builder.set_precedents(
                &cell(id),
                vec![DepTarget::Cell(cell(dep1)), DepTarget::Cell(cell(dep2))],
            );
        }
    }
    builder.build()
}

/// Build a graph with range dependencies.
#[allow(clippy::cast_possible_truncation)]
fn build_range_deps(n_formulas: u64, range_size: u32) -> DependencyGraph {
    let sid = sheet();
    let mut builder = GraphBuilder::with_capacity(n_formulas as usize);
    for i in 0..n_formulas {
        let start_row = (i as u32) * range_size;
        let end_row = start_row + range_size - 1;
        let range = RangePos::new(sid, start_row, 0, end_row, 5);
        builder.set_precedents(
            &cell(i + 1),
            vec![DepTarget::Range(range, RangeAccess::Aggregate)],
        );
    }
    builder.build()
}

// ============================================================================
// Benchmarks: Construction
// ============================================================================

#[allow(clippy::cast_possible_truncation)]
fn bench_bulk_load(c: &mut Criterion) {
    let mut group = c.benchmark_group("bulk_load");

    for &size in &[1_000u64, 10_000, 50_000] {
        group.bench_with_input(BenchmarkId::new("linear_chain", size), &size, |b, &n| {
            b.iter(|| {
                let all_deps: Vec<(CellId, Vec<DepTarget>)> = (2..=n)
                    .map(|i| (cell(i), vec![DepTarget::Cell(cell(i - 1))]))
                    .collect();
                let mut builder = GraphBuilder::with_capacity(n as usize);
                builder.bulk_set_precedents(all_deps);
                builder.build()
            });
        });

        group.bench_with_input(
            BenchmarkId::new("set_precedents_loop", size),
            &size,
            |b, &n| {
                b.iter(|| build_linear_chain(n));
            },
        );
    }

    group.finish();
}

// ============================================================================
// Benchmarks: Topological Sort
// ============================================================================

fn bench_topo_sort(c: &mut Criterion) {
    let mut group = c.benchmark_group("topo_sort");
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };

    for &size in &[1_000u64, 10_000, 50_000] {
        let graph = build_linear_chain(size);
        group.bench_with_input(BenchmarkId::new("linear", size), &graph, |b, g| {
            b.iter(|| g.evaluation_levels(&null_resolver).unwrap());
        });
    }

    for &size in &[1_000u64, 10_000, 50_000] {
        let graph = build_diamond(size / 10, 10);
        group.bench_with_input(BenchmarkId::new("diamond", size), &graph, |b, g| {
            b.iter(|| g.evaluation_levels(&null_resolver).unwrap());
        });
    }

    group.finish();
}

// ============================================================================
// Benchmarks: Partial Recalc (Affected Cells)
// ============================================================================

#[allow(clippy::cast_possible_truncation)]
fn bench_partial_recalc(c: &mut Criterion) {
    let mut group = c.benchmark_group("partial_recalc");
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };

    // Linear chain: changing the first cell invalidates everything.
    for &size in &[1_000u64, 10_000, 50_000] {
        let graph = build_linear_chain(size);
        group.bench_with_input(
            BenchmarkId::new("linear_full_dirty", size),
            &graph,
            |b, g| {
                b.iter(|| g.affected_cells(&[cell(1)], &null_resolver).into_value());
            },
        );
    }

    // Fan-in: changing one leaf only invalidates the root.
    for &size in &[1_000u64, 10_000, 50_000] {
        let graph = build_fan_in(size);
        group.bench_with_input(
            BenchmarkId::new("fan_in_single_leaf", size),
            &graph,
            |b, g| {
                b.iter(|| g.affected_cells(&[cell(1)], &null_resolver).into_value());
            },
        );
    }

    // Range deps: change a cell inside a range.
    for &n_formulas in &[100u64, 1_000, 5_000] {
        let range_size = 500u32;
        let graph = build_range_deps(n_formulas, range_size);
        let sid = sheet();
        // Position resolver: formula cells are laid out at (formula_index * range_size, 0).
        // Data cell (cell(1)) is at (0, 0) — inside the first formula's range.
        let resolve = move |c: &CellId| -> Option<CellPosition> {
            let raw = c.as_u128() as u32;
            Some(CellPosition {
                sheet: sid,
                row: raw.saturating_sub(1) * range_size,
                col: 0,
            })
        };
        group.bench_with_input(
            BenchmarkId::new("range_deps_full", n_formulas),
            &graph,
            |b, g| {
                b.iter(|| g.affected_cells(&[cell(1)], &resolve).into_value());
            },
        );
    }

    group.finish();
}

// ============================================================================
// Benchmarks: Cycle Detection
// ============================================================================

fn bench_cycle_detection(c: &mut Criterion) {
    let mut group = c.benchmark_group("cycle_detection");
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };

    for &size in &[1_000u64, 10_000, 50_000] {
        let graph = build_linear_chain(size);
        group.bench_with_input(BenchmarkId::new("acyclic_linear", size), &graph, |b, g| {
            b.iter(|| g.detect_cycles(&null_resolver).into_value());
        });
    }

    // Incremental check on an acyclic graph.
    for &size in &[1_000u64, 10_000] {
        let graph = build_linear_chain(size);
        group.bench_with_input(
            BenchmarkId::new("would_create_cycle_miss", size),
            &graph,
            |b, g| {
                // Check whether connecting the last to the first would create a cycle.
                let edit = HypotheticalDependencyEdit {
                    cell: cell(size),
                    new_precedents: vec![DepTarget::Cell(cell(1))],
                };
                b.iter(|| g.would_create_cycle(&edit, &null_resolver).into_value());
            },
        );
    }

    // Detect actual cycles: build a graph with a cycle and time detection.
    for &size in &[1_000u64, 10_000] {
        let mut graph = build_linear_chain(size);
        // Close the cycle: cell(1) depends on cell(size)
        graph.set_precedents(&cell(1), vec![DepTarget::Cell(cell(size))]);
        group.bench_with_input(
            BenchmarkId::new("detect_actual_cycle", size),
            &graph,
            |b, g| {
                b.iter(|| g.detect_cycles(&null_resolver).into_value());
            },
        );
    }

    group.finish();
}

// ============================================================================
// Benchmarks: Interval Tree
// ============================================================================

#[allow(clippy::cast_possible_truncation)]
fn bench_interval_tree(c: &mut Criterion) {
    let mut group = c.benchmark_group("interval_tree");

    for &n_ranges in &[100u64, 1_000, 10_000] {
        let range_size = 100u32;
        let graph = build_range_deps(n_ranges, range_size);
        let sid = sheet();

        group.bench_with_input(BenchmarkId::new("point_query", n_ranges), &graph, |b, g| {
            let mid_row = (n_ranges as u32 * range_size) / 2;
            b.iter(|| g.get_range_dependents_at(sid, mid_row, 3));
        });
    }

    group.finish();
}

// ============================================================================
// Benchmarks: Statistics / Queries
// ============================================================================

fn bench_queries(c: &mut Criterion) {
    let mut group = c.benchmark_group("queries");

    let graph = build_linear_chain(10_000);
    group.bench_function("dep_edge_stats_10k", |b| {
        b.iter(|| graph.dep_edge_stats());
    });
    group.bench_function("edge_count_10k", |b| {
        b.iter(|| graph.edge_count());
    });
    group.bench_function("max_depth_10k", |b| {
        b.iter(|| graph.max_depth());
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_bulk_load,
    bench_topo_sort,
    bench_partial_recalc,
    bench_cycle_detection,
    bench_interval_tree,
    bench_queries,
);
criterion_main!(benches);
