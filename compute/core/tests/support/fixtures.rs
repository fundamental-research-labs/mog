//! Programmatic workbook builders for Classes I–IV.
//!
//! All builders produce a `WorkbookSnapshot` and the identifiers needed
//! to hydrate it and re-address cells through the engine. No XLSX
//! parsing lives here — Class V owns that surface.
//!
//! Stage 1 ships:
//! - `workbook_with_formula` — one-sheet workbook with a single
//!   dependent formula and arbitrary seed values.
//! - `workbook_with_topology` — topology-driven chain / fan-in /
//!   fan-out / diamond fixtures.
//!
//! Later stages will layer full-column / named-range / structured-ref
//! topologies on top.

use formula_types::{NamedRangeDef, Scope, TableDef};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

use super::matrix::DependentShape;

/// Sheet UUID (stable so tests can recompute `SheetId::from_uuid_str`).
pub const SHEET1_UUID: &str = "a0000000000000000000000000000001";

/// Deterministic cell-id generator matching the existing
/// `compute/core/tests/stress_engine_common/mod.rs` convention.
#[must_use]
pub fn cell_uuid(row: u32, col: u32) -> String {
    format!("c0000000{:04x}{:04x}0000000000000000", row, col)
}

/// Build a [`CellData`] from its (row, col, value, optional formula).
#[must_use]
pub fn make_cell(row: u32, col: u32, value: CellValue, formula: Option<&str>) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

/// Convenience: plain numeric cell.
#[must_use]
pub fn value_cell(row: u32, col: u32, n: f64) -> CellData {
    make_cell(row, col, CellValue::Number(FiniteF64::must(n)), None)
}

/// Convenience: pure formula cell (no pre-seeded value).
#[must_use]
pub fn formula_cell(row: u32, col: u32, formula: &str) -> CellData {
    make_cell(row, col, CellValue::Null, Some(formula))
}

/// Wrap a vector of cells into a single-sheet `WorkbookSnapshot`.
#[must_use]
pub fn one_sheet_snapshot(cells: Vec<CellData>) -> WorkbookSnapshot {
    // Default dims intentionally generous so we can write to high rows
    // (axis 3 `FarOutside`) without an off-by-one on the sheet bounds.
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100_000,
            cols: 100,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Build a workbook that contains:
/// - The given seed values at the cells specified.
/// - A single dependent formula at cell (row=0, col=col_for_formula).
///
/// The dependent formula string is inserted verbatim — the caller owns
/// the reference shape (e.g. `SUM(A1:A10)`, `SUMIF(A:A,">0",B:B)`).
///
/// Stage 1 wires this up for Class IV engine-mirror tests (which seed
/// a single cell and check engine vs. import round-trips). Stage 2
/// will use it for the Class I 1×2 exhaustive pass.
#[must_use]
pub fn workbook_with_formula(
    formula: &str,
    formula_pos: (u32, u32),
    values: Vec<(u32, u32, CellValue)>,
) -> WorkbookSnapshot {
    let mut cells: Vec<CellData> = values
        .into_iter()
        .map(|(row, col, v)| make_cell(row, col, v, None))
        .collect();
    cells.push(formula_cell(formula_pos.0, formula_pos.1, formula));
    one_sheet_snapshot(cells)
}

/// Seed a topology under test. Returns the cells (row, col) that
/// participate, in declaration order.
///
/// - `Chain(n)` → A1 (seed), A2 = A1 + 1, A3 = A2 + 1, ..., An+1.
/// - `FanIn(n)` → n seeds in col A, one dependent that sums them.
/// - `FanOut(n)` → one seed, n dependents each = seed * k.
/// - `Diamond` → A1 seed, B1 = A1+1, C1 = A1+2, D1 = B1 + C1.
pub fn workbook_with_topology(topology: DependentShape, seeds: &[f64]) -> WorkbookSnapshot {
    // Pick the scalar seed for shapes that need one.
    let seed_val = seeds.first().copied().unwrap_or(1.0);

    let cells = match topology {
        DependentShape::Chain => {
            // Default depth = max(len(seeds), 3) so a single-seed caller
            // still gets a meaningful chain. seeds[0] is A1; seeds[1..]
            // (if any) are injected as intermediate seeds.
            let depth = seeds.len().max(3);
            let mut out = Vec::with_capacity(depth);
            for i in 0..depth {
                if i == 0 {
                    out.push(value_cell(0, 0, seed_val));
                } else {
                    // Row i, col 0. Formula references the previous row.
                    // A2 = A1 + 1, A3 = A2 + 1, etc.
                    let prev_ref = format!("A{}", i); // A1, A2, ...
                    out.push(formula_cell(i as u32, 0, &format!("{}+1", prev_ref)));
                }
            }
            out
        }
        DependentShape::FanIn => {
            let n = seeds.len().max(3) as u32;
            let mut out = Vec::with_capacity(n as usize + 1);
            for i in 0..n {
                let v = seeds.get(i as usize).copied().unwrap_or((i + 1) as f64);
                out.push(value_cell(i, 0, v));
            }
            // Dependent at col B, row 0: SUM(A1:An).
            out.push(formula_cell(0, 1, &format!("SUM(A1:A{})", n)));
            out
        }
        DependentShape::FanOut => {
            // A1 is the single seed; B1, C1, D1 each reference A1.
            let mut out = Vec::new();
            out.push(value_cell(0, 0, seed_val));
            let fanout_cols: &[&str] = &["A1*1", "A1*2", "A1*3"];
            for (i, formula) in fanout_cols.iter().enumerate() {
                // cols 1..=3 → B, C, D
                out.push(formula_cell(0, (i as u32) + 1, formula));
            }
            out
        }
        DependentShape::Diamond => {
            // A1 seed; B1 = A1+1; C1 = A1+2; D1 = B1+C1.
            vec![
                value_cell(0, 0, seed_val),
                formula_cell(0, 1, "A1+1"),
                formula_cell(0, 2, "A1+2"),
                formula_cell(0, 3, "B1+C1"),
            ]
        }
    };

    one_sheet_snapshot(cells)
}

// ---------------------------------------------------------------------
// Stage-2 Track-4d — named-range / structured-table fixture builders.
//
// Exception to the append-only-to-fixtures rule: these are additive new
// builders, not edits to the existing ones. Class I / Class II runners
// consume them to drop the 60 FixturePending cases on `RangeType::NamedRange`
// (and, where engine support permits, `RangeType::StructuredTable`).
// ---------------------------------------------------------------------

/// A workbook populated with a 10-row × 3-col seed block on Sheet1
/// (`A1:C10` = 1..10 per column) and a single workbook-scoped named
/// range. The dependent formula is NOT inserted — callers layer their
/// own formula on top (via `extra_cells`).
///
/// Returns the snapshot. The caller is responsible for appending a
/// formula cell (in `extra_cells`) that references `name` (e.g.
/// `SUM(MyRange)` / `SUMIFS(MyRange,A:A,">0")`).
///
/// `range_expr` is passed verbatim to [`NamedRangeDef::from_expression`];
/// callers pick the reference shape (`"Sheet1!A:A"`, `"Sheet1!$A$1:$A$10"`,
/// etc.).
#[must_use]
pub fn workbook_with_named_range(
    name: &str,
    range_expr: &str,
    extra_cells: Vec<CellData>,
) -> WorkbookSnapshot {
    // Seed block: A1..A10 = 1..10, B1..B10 = 1..10, C1..C10 = 1..10.
    let mut cells: Vec<CellData> = Vec::with_capacity(30 + extra_cells.len());
    for i in 0..10u32 {
        cells.push(value_cell(i, 0, (i + 1) as f64));
        cells.push(value_cell(i, 1, (i + 1) as f64));
        cells.push(value_cell(i, 2, (i + 1) as f64));
    }
    cells.extend(extra_cells);

    let def =
        NamedRangeDef::from_expression(name.to_string(), Scope::Workbook, range_expr.to_string());

    let mut snapshot = one_sheet_snapshot(cells);
    snapshot.named_ranges.push(def);
    snapshot
}

/// A workbook with a `Table1`-style structured table covering
/// `A1:C<data_rows>` on Sheet1, header row on row 0, `data_rows`
/// data rows.
///
/// Returns the snapshot. The caller appends a formula cell (via
/// `extra_cells`) that references `Table1[Col]` etc.
///
/// **Engine support caveat.** `TableDef` lives on
/// `WorkbookSnapshot.tables` and survives `from_snapshot`. Whether the
/// structured-reference syntax (`Table1[Col]`) parses cleanly depends on
/// the formula frontend's support — if a Class I / Class II runner hits
/// a parse error, the case is recorded as `FixturePending` with a
/// structural-op ticket (documented in the structural-op Stage-2 handoff).
#[must_use]
pub fn workbook_with_table(
    table_name: &str,
    columns: &[&str],
    data_rows: u32,
    extra_cells: Vec<CellData>,
) -> WorkbookSnapshot {
    use cell_types::SheetId;

    assert!(!columns.is_empty(), "table must have at least one column");
    assert!(data_rows >= 1, "table must have at least one data row");

    let sheet_sid = SheetId::from_uuid_str(SHEET1_UUID).expect("valid sheet uuid");

    // Header row: text labels on row 0.
    let mut cells: Vec<CellData> =
        Vec::with_capacity(columns.len() * (data_rows as usize + 1) + extra_cells.len());
    for (c, name) in columns.iter().enumerate() {
        cells.push(make_cell(
            0,
            c as u32,
            CellValue::Text(std::sync::Arc::from(*name)),
            None,
        ));
    }

    // Data rows: numeric seeds 1..=data_rows in each column.
    for r in 1..=data_rows {
        for c in 0..columns.len() {
            cells.push(value_cell(r, c as u32, r as f64));
        }
    }

    cells.extend(extra_cells);

    let mut snapshot = one_sheet_snapshot(cells);
    snapshot.tables.push(TableDef {
        name: table_name.to_string(),
        sheet: sheet_sid,
        start_row: 0,
        start_col: 0,
        end_row: data_rows,
        end_col: (columns.len() as u32).saturating_sub(1),
        columns: columns.iter().map(|s| (*s).to_string()).collect(),
        has_headers: true,
        has_totals: false,
    });
    snapshot
}

/// Builds a single-sheet snapshot with `rows` f64 values (1.0, 2.0, ...) in column 0.
/// Used by Range baseline tests.
#[must_use]
pub fn numeric_column_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut cells = Vec::with_capacity(rows as usize);
    for row in 0..rows {
        cells.push(value_cell(row, 0, (row + 1) as f64));
    }
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Builds a single-sheet snapshot with f64 in col A, text in col B.
#[must_use]
pub fn two_column_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut cells = Vec::with_capacity(rows as usize * 2);
    for row in 0..rows {
        cells.push(value_cell(row, 0, (row + 1) as f64));
        cells.push(make_cell(
            row,
            1,
            CellValue::Text(std::sync::Arc::from(format!("row{}", row))),
            None,
        ));
    }
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}
