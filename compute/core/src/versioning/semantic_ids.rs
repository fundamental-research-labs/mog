pub(super) fn canonical_sheet_key(sheet_index: usize) -> String {
    format!("sheet#{sheet_index}")
}

pub(super) fn canonical_cell_key(sheet_key: &str, row: u32, column: u32) -> String {
    format!("cell:{sheet_key}:r{row}:c{column}")
}

pub(super) fn canonical_row_key(sheet_key: &str, row: u32) -> String {
    format!("row:{sheet_key}:r{row}")
}

pub(super) fn canonical_column_key(sheet_key: &str, column: u32) -> String {
    format!("column:{sheet_key}:c{column}")
}
