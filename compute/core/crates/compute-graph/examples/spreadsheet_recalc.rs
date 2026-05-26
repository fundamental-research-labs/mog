//! Example: building a dependency graph and computing partial recalc order.
//!
//! Simulates a small spreadsheet where:
//!   - B1 = A1 + 1        (cell-to-cell)
//!   - C1 = B1 * 2        (cell-to-cell)
//!   - D1 = SUM(A1:A500)  (range dependency)
//!   - E1 = D1 + C1       (cell-to-cell, depends on both branches)
//!
//! When A1 changes, the graph computes the correct evaluation order.

use cell_types::{CellId, RangePos, SheetId};
use compute_graph::{CellPosition, DepTarget, DependencyGraph, RangeAccess};

fn main() {
    // Allocate stable CellIds (in production these come from the CRDT layer).
    let a1 = CellId::from_raw(1);
    let b1 = CellId::from_raw(2);
    let c1 = CellId::from_raw(3);
    let d1 = CellId::from_raw(4);
    let e1 = CellId::from_raw(5);
    let sheet = SheetId::from_raw(100);

    // Build the graph.
    let mut graph = DependencyGraph::new();

    // B1 = A1 + 1
    graph.set_precedents(&b1, vec![DepTarget::Cell(a1)]);

    // C1 = B1 * 2
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);

    // D1 = SUM(A1:A500) — large range, stored as range dependency
    let range_a = RangePos::new(sheet, 0, 0, 499, 0); // rows 0–499, col 0
    graph.set_precedents(&d1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);

    // E1 = D1 + C1
    graph.set_precedents(&e1, vec![DepTarget::Cell(d1), DepTarget::Cell(c1)]);

    // Print graph statistics.
    println!("Formula cells: {}", graph.formula_cell_count());
    println!("Cell edges:    {}", graph.edge_count());
    println!("Range deps:    {}", graph.range_dep_count());
    println!("Volatile:      {}", graph.volatile_count());
    println!();

    // === Partial recalc: A1 changed ===
    // Null resolver path (fast, only resolves cell-to-cell deps):
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let affected = graph.affected_cells(&[a1], &null_resolver).into_value();
    println!("Affected (null resolver): {affected:?}");
    // This will find: A1 -> B1 -> C1 -> E1 (but misses D1, which uses a range).

    // Full path with position resolution (catches range deps too):
    // In production, positions come from CellMirror. Here we hardcode A1's position.
    let resolver = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a1 {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 0,
            }) // A1 is at row 0, col 0
        } else {
            None
        }
    };
    let affected_full = graph.affected_cells(&[a1], &resolver).into_value();
    println!("Affected (full):           {affected_full:?}");
    // This correctly includes D1 because A1's position (0, 0) falls within A1:A500.

    // === Cycle detection ===
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    println!(
        "\nCycles: {}",
        if cycles.is_empty() { "none" } else { "found!" }
    );

    // === Full evaluation order ===
    match graph.evaluation_levels(&null_resolver) {
        Ok(levels) => {
            let order: Vec<CellId> = levels.into_value().into_iter().flatten().collect();
            println!("\nFull evaluation order ({} cells):", order.len());
            for (i, cell) in order.iter().enumerate() {
                println!("  {i}: {cell:?}");
            }
        }
        Err(e) => println!("Error: {e}"),
    }
}
