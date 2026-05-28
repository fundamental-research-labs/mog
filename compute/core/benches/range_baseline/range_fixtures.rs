use super::support::{cell_uuid, range_uuid, sheet_uuid, yrs_col_id, yrs_row_id};
use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId};
use snapshot_types::{CellData, RangeData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

pub(crate) fn range_backed_snapshot(
    rows: u32,
    cols: u32,
    value_fn: impl Fn(u32, u32) -> f64,
    formula_cells: Vec<(u32, u32, String)>,
) -> WorkbookSnapshot {
    let sheet_rows = rows.max(1) as usize;
    let max_formula_col = formula_cells.iter().map(|(_, c, _)| *c).max().unwrap_or(0);
    let sheet_cols = (cols.max(1)).max(max_formula_col + 1) as usize;

    let mut payload = Vec::with_capacity(rows as usize * cols as usize * 8);
    for r in 0..rows {
        for c in 0..cols {
            payload.extend_from_slice(&value_fn(r, c).to_le_bytes());
        }
    }

    let row_ids: Vec<RowId> = (0..rows as usize).map(yrs_row_id).collect();
    let col_ids: Vec<ColId> = (0..cols as usize)
        .map(|i| yrs_col_id(sheet_rows, i))
        .collect();

    let range_data = RangeData {
        range_id: RangeId::from_uuid_str(&range_uuid(0)).unwrap(),
        kind: RangeKind::Data,
        anchor: RangeAnchor::Elastic {
            start_row: row_ids[0],
            end_row: row_ids[rows as usize - 1],
            start_col: col_ids[0],
            end_col: col_ids[cols as usize - 1],
        },
        encoding: PayloadEncoding::F64Le,
        payload,
        row_axis: None,
        col_axis: None,
        row_ids: row_ids.clone(),
        col_ids: col_ids.clone(),
    };

    let cells: Vec<CellData> = formula_cells
        .into_iter()
        .map(|(row, col, formula)| CellData {
            cell_id: cell_uuid(0, row, col),
            row,
            col,
            value: CellValue::Null,
            formula: Some(formula),
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: sheet_rows as u32,
            cols: sheet_cols as u32,
            cells,
            ranges: vec![range_data],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub(crate) fn range_backed_two_col_snapshot(
    rows: u32,
    formula_cells: Vec<(u32, u32, String)>,
) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        2,
        |r, c| {
            if c == 0 {
                (r + 1) as f64
            } else {
                ((r + 1) * 10) as f64
            }
        },
        formula_cells,
    )
}

pub(crate) fn range_sum_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        1,
        |r, _| (r + 1) as f64,
        vec![(0, 1, format!("SUM(A1:A{})", rows))],
    )
}

pub(crate) fn range_match_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        1,
        |r, _| (r + 1) as f64,
        vec![(0, 1, format!("MATCH({},A1:A{},0)", rows, rows))],
    )
}

pub(crate) fn range_index_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        1,
        |r, _| (r + 1) as f64,
        vec![(0, 1, format!("INDEX(A1:A{},{})", rows, rows / 2))],
    )
}

pub(crate) fn range_vlookup_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_two_col_snapshot(
        rows,
        vec![(0, 2, format!("VLOOKUP({},A1:B{},2,FALSE)", rows, rows))],
    )
}

pub(crate) fn range_countifs_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        1,
        |r, _| (r as f64) % 100.0,
        vec![(0, 1, format!("COUNTIFS(A1:A{},\">50\")", rows))],
    )
}

pub(crate) fn range_numeric_column_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(rows, 1, |r, _| (r + 1) as f64, vec![])
}
