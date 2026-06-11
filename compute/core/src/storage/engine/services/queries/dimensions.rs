use super::*;

// -------------------------------------------------------------------
// Dimension Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn is_row_hidden_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> bool {
    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();
    sheet_dimensions::is_row_hidden(doc, sheets, sheet_id, row)
        || !sheet_grouping::is_row_visible_by_groups(doc, sheets, sheet_id, row)
}

pub(in crate::storage::engine) fn is_col_hidden_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();
    sheet_dimensions::is_column_hidden(doc, sheets, sheet_id, col)
        || !sheet_grouping::is_column_visible_by_groups(doc, sheets, sheet_id, col)
}

pub(in crate::storage::engine) fn get_hidden_rows(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<u32> {
    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();
    let mut hidden = sheet_dimensions::get_hidden_rows(doc, sheets, sheet_id);
    hidden.extend(sheet_grouping::get_rows_hidden_by_structural_groups(
        doc, sheets, sheet_id,
    ));
    hidden.sort_unstable();
    hidden.dedup();
    hidden
}

pub(in crate::storage::engine) fn get_hidden_columns(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<u32> {
    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();
    let mut hidden = sheet_dimensions::get_hidden_columns(doc, sheets, sheet_id);
    hidden.extend(sheet_grouping::get_columns_hidden_by_structural_groups(
        doc, sheets, sheet_id,
    ));
    hidden.sort_unstable();
    hidden.dedup();
    hidden
}

pub(in crate::storage::engine) fn get_data_bounds(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Option<DataBounds> {
    let sheet = mirror.get_sheet(sheet_id)?;

    let mut min_row = u32::MAX;
    let mut max_row = 0u32;
    let mut min_col = u32::MAX;
    let mut max_col = 0u32;
    let mut found = false;

    // 1. Bounds from mirror cells (value / formula cells)
    for (cell_id, entry) in sheet.cells_iter() {
        if entry.is_ghost() {
            continue;
        }
        if let Some(pos) = sheet.position_of(cell_id) {
            found = true;
            min_row = min_row.min(pos.row());
            max_row = max_row.max(pos.row());
            min_col = min_col.min(pos.col());
            max_col = max_col.max(pos.col());
        }
    }

    // 2. Expand bounds with sheet extent (includes materialized values: pivot output, spill arrays).
    //    expand_extent() is called when writing to col_data, so sheet.rows/cols reflects the
    //    farthest materialized cell even though those cells have no CellId.
    if !sheet.col_data_is_empty() && sheet.rows > 0 && sheet.cols > 0 {
        found = true;
        min_row = 0;
        max_row = max_row.max(sheet.rows - 1);
        min_col = 0;
        max_col = max_col.max(sheet.cols - 1);
    }

    // 3. Expand bounds with format-only cells from CRDT properties.
    //    These cells have formatting but no value/formula, so they exist in
    //    the CRDT properties map but not in the cell mirror.
    use crate::storage::properties;

    let doc = stores.storage.doc();
    let sheets_map = stores.storage.sheets();
    let grid = stores.grid_indexes.get(sheet_id);

    for cell_id_hex in properties::iter_formatted_property_cell_ids(doc, sheets_map, sheet_id) {
        // Resolve position directly from the authoritative GridIndex.
        if let Some((row, col)) = resolve_pos_from_grid(grid, cell_id_hex.as_str()) {
            found = true;
            min_row = min_row.min(row);
            max_row = max_row.max(row);
            min_col = min_col.min(col);
            max_col = max_col.max(col);
        }
    }

    // 4. Expand bounds with merge-region footprints.
    //    A merged region is sheet structure (not just a view hint), so its
    //    bounding box must be part of the used range — matches Excel's
    //    `UsedRange` semantics. Walking merges here makes `get_data_bounds`
    //    a pure function of CRDT state: originator and receiver agree even
    //    though the receiver never runs `expand_extent` on merge-apply (the
    //    nulled non-origin corner cells look like ghosts to step 1).
    //
    //    Uses `merges::iter_merge_bounds`, which reads the inline
    //    `sr/sc/er/ec` fields from each merge entry. Crucially this is
    //    independent of the in-memory `GridIndex`: on a merge receiver the
    //    local `GridIndex` may not yet have the merge-origin cell IDs
    //    registered (hydration gap fixed in a separate round), but the
    //    Yrs merges map carries the rectangle directly.
    for (sr, sc, er, ec) in merges::iter_merge_bounds(doc, sheets_map, *sheet_id) {
        found = true;
        min_row = min_row.min(sr);
        max_row = max_row.max(er);
        min_col = min_col.min(sc);
        max_col = max_col.max(ec);
    }

    if !found {
        return None;
    }

    Some(DataBounds {
        min_row,
        min_col,
        max_row,
        max_col,
    })
}

// -------------------------------------------------------------------
// Dimension Off-Viewport Reads
// -------------------------------------------------------------------

/// Returns row height in **pixels** (for TypeScript bridge).
/// Reads canonical (points) from Yrs and converts.
pub(in crate::storage::engine) fn get_row_height_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> Pixels {
    let height_pt = sheet_dimensions::get_row_height(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        stores.grid_indexes.get(sheet_id),
    );
    if height_pt.0 == 0.0 {
        Pixels(0.0)
    } else {
        domain_types::units::points_to_pixels(height_pt)
    }
}

/// Returns column width in **pixels** (for TypeScript bridge).
/// Reads canonical (char-width) from Yrs and converts.
pub(in crate::storage::engine) fn get_col_width_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> Pixels {
    let width_cw = sheet_dimensions::get_col_width(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col,
        stores.grid_indexes.get(sheet_id),
    );
    if width_cw.0 == 0.0 {
        Pixels(0.0)
    } else {
        domain_types::units::char_width_to_pixels(width_cw, domain_types::units::platform_mdw())
    }
}

/// Returns default row height in **canonical units (points)**.
pub(in crate::storage::engine) fn get_default_row_height(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Points {
    properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)
        .map(|m| Points(m.default_row_height))
        .unwrap_or(sheet_dimensions::DEFAULT_ROW_HEIGHT)
}

/// Returns default column width in **canonical units (char-width)**.
pub(in crate::storage::engine) fn get_default_col_width(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> CharWidth {
    properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)
        .map(|m| CharWidth(m.default_col_width))
        .unwrap_or(sheet_dimensions::DEFAULT_COL_WIDTH)
}

/// Returns row heights in **pixels** (for TypeScript bridge).
pub(in crate::storage::engine) fn get_row_heights_batch(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Vec<(u32, Pixels)> {
    (start_row..=end_row)
        .map(|row| {
            let pt = sheet_dimensions::get_row_height(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                row,
                stores.grid_indexes.get(sheet_id),
            );
            (
                row,
                if pt.0 == 0.0 {
                    Pixels(0.0)
                } else {
                    domain_types::units::points_to_pixels(pt)
                },
            )
        })
        .collect()
}

/// Returns column width in **character-width units** (for TypeScript bridge).
/// Reads canonical (char-width) from Yrs directly — no pixel conversion.
pub(in crate::storage::engine) fn get_col_width_chars_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> CharWidth {
    sheet_dimensions::get_col_width(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col,
        stores.grid_indexes.get(sheet_id),
    )
}

/// Returns column widths in **character-width units** for a range.
pub(in crate::storage::engine) fn get_col_widths_batch_chars(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<(u32, CharWidth)> {
    (start_col..=end_col)
        .map(|col| {
            let cw = sheet_dimensions::get_col_width(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                col,
                stores.grid_indexes.get(sheet_id),
            );
            (col, cw)
        })
        .collect()
}

/// Returns column widths in **pixels** (for TypeScript bridge).
pub(in crate::storage::engine) fn get_col_widths_batch(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<(u32, Pixels)> {
    let mdw = domain_types::units::platform_mdw();
    (start_col..=end_col)
        .map(|col| {
            let cw = sheet_dimensions::get_col_width(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                col,
                stores.grid_indexes.get(sheet_id),
            );
            (
                col,
                if cw.0 == 0.0 {
                    Pixels(0.0)
                } else {
                    domain_types::units::char_width_to_pixels(cw, mdw)
                },
            )
        })
        .collect()
}

// -------------------------------------------------------------------
// Cell Iteration (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_current_region(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
) -> RectBounds {
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return RectBounds {
            start_row,
            start_col,
            end_row: start_row,
            end_col: start_col,
        };
    };
    let region = cell_iter::get_current_region(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        start_row,
        start_col,
    );
    RectBounds {
        start_row: region.start_row(),
        start_col: region.start_col(),
        end_row: region.end_row(),
        end_col: region.end_col(),
    }
}

pub(in crate::storage::engine) fn find_data_edge(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    direction: &str,
) -> CellPosition {
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return CellPosition { row, col };
    };
    cell_iter::find_data_edge(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
        direction,
    )
}

/// Find the last populated row in a column. Returns data and formatting edges.
pub(in crate::storage::engine) fn find_last_row(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    col: u32,
) -> ColumnEdge {
    let mut last_data_row: Option<u32> = None;

    // 1. Scan CellMirror cells (value / formula cells) for this column.
    if let Some(sheet) = mirror.get_sheet(sheet_id) {
        for (cell_id, entry) in sheet.cells_iter() {
            if entry.is_ghost() {
                continue;
            }
            if let Some(pos) = sheet.position_of(cell_id)
                && pos.col() == col
            {
                last_data_row = Some(last_data_row.map_or(pos.row(), |cur| cur.max(pos.row())));
            }
        }

        // 2. Scan col_data (spill arrays, pivot output, etc.) for this column.
        if let Some(col_slice) = sheet.get_column_slice(col) {
            for (row, val) in col_slice.iter().enumerate() {
                if !val.is_null() {
                    last_data_row =
                        Some(last_data_row.map_or(row as u32, |cur| cur.max(row as u32)));
                }
            }
        }
    }

    // 3. Scan CRDT format properties for this column.
    let mut last_format_row: Option<u32> = None;
    {
        use crate::storage::properties;

        let doc = stores.storage.doc();
        let sheets_map = stores.storage.sheets();
        let grid = stores.grid_indexes.get(sheet_id);

        for cell_id_hex in properties::iter_formatted_property_cell_ids(doc, sheets_map, sheet_id) {
            if let Some((row, c)) = resolve_pos_from_grid(grid, cell_id_hex.as_str())
                && c == col
            {
                last_format_row = Some(last_format_row.map_or(row, |cur| cur.max(row)));
            }
        }
    }

    ColumnEdge {
        last_data_row,
        last_format_row,
    }
}

/// Find the last populated column in a row. Returns data and formatting edges.
pub(in crate::storage::engine) fn find_last_column(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
) -> RowEdge {
    let mut last_data_col: Option<u32> = None;

    // 1. Scan CellMirror cells (value / formula cells) for this row.
    if let Some(sheet) = mirror.get_sheet(sheet_id) {
        for (cell_id, entry) in sheet.cells_iter() {
            if entry.is_ghost() {
                continue;
            }
            if let Some(pos) = sheet.position_of(cell_id)
                && pos.row() == row
            {
                last_data_col = Some(last_data_col.map_or(pos.col(), |cur| cur.max(pos.col())));
            }
        }

        // 2. Scan col_data for all columns at this row.
        if !sheet.col_data_is_empty() && sheet.rows > row {
            for c in 0..sheet.cols {
                if let Some(col_slice) = sheet.get_column_slice(c)
                    && let Some(val) = col_slice.get(row as usize)
                    && !val.is_null()
                {
                    last_data_col = Some(last_data_col.map_or(c, |cur| cur.max(c)));
                }
            }
        }
    }

    // 3. Scan CRDT format properties for this row.
    let mut last_format_col: Option<u32> = None;
    {
        use crate::storage::properties;

        let doc = stores.storage.doc();
        let sheets_map = stores.storage.sheets();
        let grid = stores.grid_indexes.get(sheet_id);

        for cell_id_hex in properties::iter_formatted_property_cell_ids(doc, sheets_map, sheet_id) {
            if let Some((r, c)) = resolve_pos_from_grid(grid, cell_id_hex.as_str())
                && r == row
            {
                last_format_col = Some(last_format_col.map_or(c, |cur| cur.max(c)));
            }
        }
    }

    RowEdge {
        last_data_col,
        last_format_col,
    }
}
