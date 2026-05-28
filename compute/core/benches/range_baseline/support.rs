use cell_types::{ColId, RowId};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

pub(crate) fn sheet_uuid(idx: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", idx as u64)
}

pub(crate) fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("{:08x}{:08x}{:08x}00000000", sheet_idx, row, col)
}

pub(crate) fn build_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<String>)>)>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula,
                    identity_formula: None,
                    array_ref: None,
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows,
                cols,
                cells: cell_data,
                ranges: vec![],
            }
        })
        .collect();
    WorkbookSnapshot {
        sheets: sheet_snapshots,
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

#[allow(dead_code)]
pub(crate) fn encode_f64_le(values: &[f64]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

pub(crate) fn range_uuid(idx: u32) -> String {
    format!("b0000000-0000-0000-0000-{:012x}", idx as u64)
}

pub(crate) fn yrs_row_id(row_index: usize) -> RowId {
    RowId::from_raw((row_index + 1) as u128)
}

pub(crate) fn yrs_col_id(sheet_rows: usize, col_index: usize) -> ColId {
    ColId::from_raw((sheet_rows + col_index + 1) as u128)
}
