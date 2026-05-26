use super::*;
use std::borrow::Cow;

use cell_types::SheetId;
use compute_graph::positions::{CellPosition, PositionResolver};
use compute_parser::{AbsFlags, CellRefNode, RangeRef};
use formula_types::{CellRef, RangeType};
use value_types::FiniteF64;

use crate::mirror::CellMirror;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};

mod test_cache_only;
mod test_detect_groups;
mod test_extract_pattern;
mod test_hashmap_exec;
mod test_sorted_range;
mod test_wrappers;

fn sheet_id_1() -> SheetId {
    SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap()
}

fn cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// No-op resolver for tests using Positional CellRefs.
/// Resolved CellIds won't appear in these tests, so this is never called.
struct NoopResolver;
impl PositionResolver for NoopResolver {
    fn resolve(&self, _: &CellId) -> Option<CellPosition> {
        None
    }
}

/// Map-based resolver for tests that use CellId -> position lookups.
struct MapResolver<'a>(&'a FxHashMap<CellId, (SheetId, u32, u32)>);
impl PositionResolver for MapResolver<'_> {
    fn resolve(&self, cell_id: &CellId) -> Option<CellPosition> {
        self.0
            .get(cell_id)
            .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
    }
}

/// Build a positional CellRef on sheet_id_1.
fn pos_ref(row: u32, col: u32) -> CellRef {
    CellRef::Positional {
        sheet: sheet_id_1(),
        row,
        col,
    }
}

/// Build a column range A:A style (ColumnRange) AST node.
fn col_range_node(col: u32) -> ASTNode {
    ASTNode::Range(RangeRef {
        start: pos_ref(0, col),
        end: pos_ref(0, col),
        abs_start: AbsFlags {
            row: false,
            col: true,
        },

        abs_end: AbsFlags {
            row: false,
            col: true,
        },
        range_type: RangeType::ColumnRange,
    })
}

/// Build a cell range A1:A100 style (CellRange) AST node.
fn cell_range_node(col: u32, start_row: u32, end_row: u32) -> ASTNode {
    ASTNode::Range(RangeRef {
        start: pos_ref(start_row, col),
        end: pos_ref(end_row, col),
        abs_start: AbsFlags {
            row: true,
            col: true,
        },

        abs_end: AbsFlags {
            row: true,
            col: true,
        },
        range_type: RangeType::CellRange,
    })
}

/// Build a dynamic (row-relative) cell reference, e.g. E1 where row changes.
fn dynamic_ref_node(col: u32, row: u32) -> ASTNode {
    ASTNode::CellReference(CellRefNode {
        reference: pos_ref(row, col),
        abs_row: false,
        abs_col: true,
    })
}

/// Helper: build a SUMIFS(C:C, A:A, E1, B:B, F1) AST node.
fn sumifs_node(row: u32) -> ASTNode {
    ASTNode::Function {
        name: Cow::Borrowed("SUMIFS"),
        args: vec![
            col_range_node(2),        // C:C (sum range)
            col_range_node(0),        // A:A (criteria range 1)
            dynamic_ref_node(4, row), // E1 (criteria 1)
            col_range_node(1),        // B:B (criteria range 2)
            dynamic_ref_node(5, row), // F1 (criteria 2)
        ],
    }
}

/// Build a CellMirror with data for testing aggregation.
///
/// Sheet layout (5 rows, 5 cols):
///   Col A (0): Category -- "X", "Y", "X", "Y", "X"
///   Col B (1): Region  -- "N", "N", "S", "S", "N"
///   Col C (2): Value   -- 10, 20, 30, 40, 50
///   Col D (3): unused
///   Col E (4): Criteria (output side) -- "X", "Y", ...
fn test_mirror() -> CellMirror {
    let sid = "00000000-0000-0000-0000-000000000001";

    let categories = ["X", "Y", "X", "Y", "X"];
    let regions = ["N", "N", "S", "S", "N"];
    let values = [10.0, 20.0, 30.0, 40.0, 50.0];
    let criteria = ["X", "Y", "X", "Y", "X"];

    let mut cells = Vec::new();
    let mut id_counter = 1000u128;

    for row in 0..5u32 {
        // Col A
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 0,
            value: CellValue::Text(categories[row as usize].into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 1,
            value: CellValue::Text(regions[row as usize].into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col C
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 2,
            value: CellValue::Number(FiniteF64::must(values[row as usize])),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col E (criteria for output lookup)
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 4,
            value: CellValue::Text(criteria[row as usize].into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_string(),
            name: "Data".to_string(),
            rows: 5,
            cols: 5,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    CellMirror::from_snapshot(snap).unwrap()
}

/// Build a CellMirror for sorted-range prepass tests.
///
/// Sheet layout (10 rows, 6 cols):
///   Col A (0): Date/range column -- 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000
///   Col B (1): Category -- "A", "A", "B", "A", "B", "A", "B", "A", "B", "A"
///   Col C (2): Status   -- 0, 0, 1, 0, 0, 0, 1, 0, 0, 0
///   Col D (3): Value    -- 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
///   Col E (4): Lower bound (output side) -- 200, 400, 100, 300, 500, ...
///   Col F (5): Upper bound (output side) -- 500, 800, 300, 600, 900, ...
fn sorted_range_mirror() -> CellMirror {
    let sid = "00000000-0000-0000-0000-000000000001";
    let range_vals = [
        100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0, 800.0, 900.0, 1000.0,
    ];
    let categories = ["A", "A", "B", "A", "B", "A", "B", "A", "B", "A"];
    let statuses = [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];
    let values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
    let lower_bounds = [
        200.0, 400.0, 100.0, 300.0, 500.0, 200.0, 400.0, 100.0, 300.0, 500.0,
    ];
    let upper_bounds = [
        500.0, 800.0, 300.0, 600.0, 900.0, 500.0, 800.0, 300.0, 600.0, 900.0,
    ];

    let mut cells = Vec::new();
    let mut id_counter = 2000u128;

    for row in 0..10u32 {
        // Col A -- range column
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 0,
            value: CellValue::Number(FiniteF64::must(range_vals[row as usize])),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B -- category
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 1,
            value: CellValue::Text(categories[row as usize].into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col C -- status
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 2,
            value: CellValue::Number(FiniteF64::must(statuses[row as usize])),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col D -- value to sum
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 3,
            value: CellValue::Number(FiniteF64::must(values[row as usize])),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col E -- lower bound
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 4,
            value: CellValue::Number(FiniteF64::must(lower_bounds[row as usize])),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col F -- upper bound
        id_counter += 1;
        cells.push(CellData {
            cell_id: CellId::from_raw(id_counter).to_uuid_string(),
            row,
            col: 5,
            value: CellValue::Number(FiniteF64::must(upper_bounds[row as usize])),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_string(),
            name: "Data".to_string(),
            rows: 10,
            cols: 6,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    CellMirror::from_snapshot(snap).unwrap()
}
