use super::*;

fn include_extent_pos(rows: &mut u32, cols: &mut u32, row: u32, col: u32) {
    *rows = (*rows).max(row.saturating_add(1));
    *cols = (*cols).max(col.saturating_add(1));
}

fn include_extent_cell_ref(rows: &mut u32, cols: &mut u32, cell_ref: &CellRef) {
    if let CellRef::Positional { row, col, .. } = cell_ref {
        include_extent_pos(rows, cols, *row, *col);
    }
}

fn include_extent_a1_ref(rows: &mut u32, cols: &mut u32, raw: &str) {
    match compute_parser::ParsedExpr::classify(raw) {
        compute_parser::ParsedExpr::Cell(node) => {
            include_extent_cell_ref(rows, cols, &node.reference);
        }
        compute_parser::ParsedExpr::Range(range) if range.range_type == RangeType::CellRange => {
            include_extent_cell_ref(rows, cols, &range.start);
            include_extent_cell_ref(rows, cols, &range.end);
        }
        _ => {}
    }
}

pub(super) fn is_style_only_cell(cell: &CellData) -> bool {
    cell.value.is_null()
        && cell.formula.is_none()
        && cell.style_id.is_some()
        && cell.cell_formula.is_none()
        && cell.cell_metadata_index.is_none()
        && cell.formula_result_type.is_none()
        && !cell.has_empty_cached_value
        && cell.formula_cache_provenance.is_absent_or_unknown()
        && cell.vm.is_none()
        && !cell.phonetic
        && cell.date_lexical_value.is_none()
        && cell.original_sst_index.is_none()
        && cell
            .original_value
            .as_ref()
            .is_none_or(|value| value.is_empty())
}

pub(super) fn is_styleless_blank_cell(cell: &CellData) -> bool {
    cell.value.is_null()
        && cell.formula.is_none()
        && cell.rich_string.is_none()
        && cell.style_id.is_none()
        && cell.cell_formula.is_none()
        && cell.cell_metadata_index.is_none()
        && cell.formula_result_type.is_none()
        && !cell.has_empty_cached_value
        && cell.formula_cache_provenance.is_absent_or_unknown()
        && cell.vm.is_none()
        && !cell.phonetic
        && cell.date_lexical_value.is_none()
        && cell.original_sst_index.is_none()
        && cell.original_value.is_none()
}

pub(super) fn explicit_blank_cell(row: u32, col: u32) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Null,
        rich_string: None,
        formula: None,
        array_ref: None,
        style_id: None,
        cell_formula: None,
        cell_metadata_index: None,
        formula_result_type: None,
        has_empty_cached_value: false,
        formula_cache_provenance: Default::default(),
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        original_sst_index: None,
        original_value: Some(String::new()),
        projection_role: domain_types::ImportedCellProjectionRole::Normal,
    }
}

pub(super) fn coalesce_style_only_points(points: &[(u32, u32, u32)]) -> Vec<AuthoredStyleRun> {
    if points.is_empty() {
        return Vec::new();
    }

    let mut points = points.to_vec();
    points.sort_unstable();
    points.dedup();

    let mut row_runs: Vec<AuthoredStyleRun> = Vec::new();
    for (row, col, style_id) in points {
        if let Some(last) = row_runs.last_mut()
            && last.start_row == row
            && last.end_row == row
            && last.style_id == style_id
            && last.end_col.saturating_add(1) == col
        {
            last.end_col = col;
            continue;
        }
        row_runs.push(AuthoredStyleRun {
            start_row: row,
            start_col: col,
            end_row: row,
            end_col: col,
            style_id,
        });
    }

    let mut rectangles: Vec<AuthoredStyleRun> = Vec::new();
    let mut active: std::collections::HashMap<(u32, u32, u32), usize> =
        std::collections::HashMap::new();
    for run in row_runs {
        let key = (run.start_col, run.end_col, run.style_id);
        if let Some(&idx) = active.get(&key)
            && rectangles[idx].end_row.saturating_add(1) == run.start_row
        {
            rectangles[idx].end_row = run.end_row;
            continue;
        }
        let idx = rectangles.len();
        active.insert(key, idx);
        rectangles.push(run);
    }

    rectangles.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    rectangles
}

pub(super) fn normalize_authored_style_runs(runs: &mut Vec<AuthoredStyleRun>) {
    runs.retain(|run| run.start_row <= run.end_row && run.start_col <= run.end_col);
    runs.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    runs.dedup();
}

pub(super) fn compute_sheet_extent(sheet: &FullParsedSheet) -> (u32, u32) {
    // Account for dimension data and structural anchors in addition to concrete
    // <c> cells. Comment-only anchors get durable identities during engine
    // hydration, but they must not inflate the logical sheet dimensions.
    let (mut rows, mut cols) = compute_dimensions(&sheet.cells);

    if let Some(dim_rows) = sheet.row_heights.iter().map(|rh| rh.row + 1).max() {
        rows = rows.max(dim_rows);
    }
    if let Some(desc_rows) = sheet.row_descents.keys().map(|&r| r + 1).max() {
        rows = rows.max(desc_rows);
    }
    if let Some(dim_cols) = sheet.col_widths.iter().map(|cw| cw.max).max() {
        // ColWidth::max is 1-based, so it already equals the required count.
        cols = cols.max(dim_cols);
    }

    for merge in &sheet.merges {
        include_extent_pos(&mut rows, &mut cols, merge.start_row, merge.start_col);
        include_extent_pos(&mut rows, &mut cols, merge.end_row, merge.end_col);
    }
    for hyperlink in &sheet.hyperlinks {
        include_extent_a1_ref(&mut rows, &mut cols, &hyperlink.cell_ref);
    }
    for run in &sheet.authored_style_runs {
        include_extent_pos(&mut rows, &mut cols, run.end_row, run.end_col);
    }
    for &(row, col) in &sheet.explicit_blank_cells {
        include_extent_pos(&mut rows, &mut cols, row, col);
    }

    (rows, cols)
}

pub(super) fn extend_sheet_data_extent(sheet: &mut SheetData) {
    let mut rows = sheet.rows;
    let mut cols = sheet.cols;

    for cell in &sheet.cells {
        include_extent_pos(&mut rows, &mut cols, cell.row, cell.col);
    }
    for row in &sheet.dimensions.row_heights {
        rows = rows.max(row.row.saturating_add(1));
    }
    for col in &sheet.dimensions.col_widths {
        cols = cols.max(col.col.saturating_add(1));
    }
    for row_style in &sheet.row_styles {
        rows = rows.max(row_style.row.saturating_add(1));
    }
    for col_style in &sheet.col_styles {
        cols = cols.max(col_style.col.saturating_add(1));
    }
    for run in &sheet.authored_style_runs {
        include_extent_pos(&mut rows, &mut cols, run.end_row, run.end_col);
    }
    for merge in &sheet.merges {
        include_extent_pos(&mut rows, &mut cols, merge.start_row, merge.start_col);
        include_extent_pos(&mut rows, &mut cols, merge.end_row, merge.end_col);
    }
    for hyperlink in &sheet.hyperlinks {
        include_extent_a1_ref(&mut rows, &mut cols, &hyperlink.cell_ref);
    }

    sheet.rows = rows;
    sheet.cols = cols;
}
