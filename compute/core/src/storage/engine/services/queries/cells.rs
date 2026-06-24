use super::*;

// -------------------------------------------------------------------
// Cell ID Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_cell_id_at(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    stores
        .grid_indexes
        .get(sheet_id)?
        .cell_id_at(row, col)
        .map(|cid| id_to_hex(cid.as_u128()).into())
}

pub(in crate::storage::engine) fn get_cell_position(
    mirror: &CellMirror,
    _sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<CellPositionResult> {
    let id_u128 = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(id_u128);
    let sheet_id = mirror.sheet_for_cell(&cell_id)?;
    let pos = mirror.resolve_position(&cell_id)?;
    Some(CellPositionResult {
        sheet_id: id_to_hex(sheet_id.as_u128()).into(),
        sheet_name: String::new(), // Enriched by engine-level caller
        row: pos.row(),
        col: pos.col(),
    })
}

pub(in crate::storage::engine) fn resolve_cell_positions(
    mirror: &CellMirror,
    cell_id_hexes: &[String],
) -> Vec<Option<CellPositionResult>> {
    cell_id_hexes
        .iter()
        .map(|hex| {
            let id_u128 = hex_to_id(hex)?;
            let cell_id = CellId::from_raw(id_u128);
            let sheet_id = mirror.sheet_for_cell(&cell_id)?;
            let pos = mirror.resolve_position(&cell_id)?;
            Some(CellPositionResult {
                sheet_id: id_to_hex(sheet_id.as_u128()).into(),
                sheet_name: String::new(), // Enriched by engine-level caller
                row: pos.row(),
                col: pos.col(),
            })
        })
        .collect()
}

// -------------------------------------------------------------------
// Cell Values (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_cell_data(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<serde_json::Value> {
    let grid_index = stores.grid_indexes.get(sheet_id)?;
    let data = cell_values::get_cell_data(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        col,
        grid_index,
    )?;
    Some(cell_data_to_json(&data))
}

pub(in crate::storage::engine) fn get_cell_data_by_id_hex(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<serde_json::Value> {
    let id_u128 = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(id_u128);
    let grid_index = stores.grid_indexes.get(sheet_id)?;
    let data = cell_values::get_cell_data_by_id(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cell_id,
        grid_index,
    )?;
    Some(cell_data_to_json(&data))
}

pub(in crate::storage::engine) fn get_raw_value(
    mirror: &CellMirror,
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> String {
    if let Some(formula) =
        crate::storage::engine::data_table_formula::formula_at(mirror, sheet_id, row, col)
    {
        return formula;
    }
    let Some(grid_index) = stores.grid_indexes.get(sheet_id) else {
        return String::new();
    };
    cell_values::get_raw_value(
        mirror,
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        col,
        grid_index,
    )
}

pub(in crate::storage::engine) fn get_effective_value(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<serde_json::Value> {
    let value = cell_values::get_effective_value(mirror, sheet_id, row, col)?;
    Some(cell_value_to_json(&value))
}

pub(in crate::storage::engine) fn get_cell_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> usize {
    cell_values::get_cell_count(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_cell_id_at_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let grid = stores.grid_indexes.get(sheet_id)?;
    grid.cell_id_at(row, col)
        .map(|cid| id_to_hex(cid.as_u128()).into())
}

pub(in crate::storage::engine) fn get_cells_in_range(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<String> {
    let grid = match stores.grid_indexes.get(sheet_id) {
        Some(g) => g,
        None => return vec![],
    };
    grid.cells_in_range(start_row, start_col, end_row, end_col)
        .map(|(cid, _, _)| id_to_hex(cid.as_u128()).into())
        .collect()
}

pub(in crate::storage::engine) fn get_all_cells_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> serde_json::Value {
    let mut cells = Vec::new();
    let Some(grid_index) = stores.grid_indexes.get(sheet_id) else {
        return serde_json::Value::Array(cells);
    };
    cell_iter::for_each_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid_index,
        |row, col, data| {
            let mut entry = serde_json::json!({
                "cell_id": id_to_hex(data.cell_id.as_u128()),
                "row": row,
                "col": col,
            });
            if let Some(ref value) = data.value {
                entry["value"] = cell_value_to_json(value);
            }
            if let Some(ref formula) = data.formula {
                entry["formula"] = serde_json::Value::String(formula.clone());
            }
            cells.push(entry);
        },
    );
    serde_json::Value::Array(cells)
}

pub(in crate::storage::engine) fn get_cells_in_range_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> serde_json::Value {
    let range = cell_types::RangePos::new(*sheet_id, start_row, start_col, end_row, end_col);
    let mut cells = Vec::new();
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return serde_json::Value::Array(cells);
    };
    cell_iter::for_each_cell_in_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        &range,
        |row, col, data| {
            if let Some(data) = data {
                let mut entry = serde_json::json!({
                    "cell_id": id_to_hex(data.cell_id.as_u128()),
                    "row": row,
                    "col": col,
                    "has_data": true,
                });
                if let Some(ref value) = data.value {
                    entry["value"] = cell_value_to_json(value);
                }
                if let Some(ref formula) = data.formula {
                    entry["formula"] = serde_json::Value::String(formula.clone());
                }
                cells.push(entry);
            } else {
                cells.push(serde_json::json!({
                    "row": row,
                    "col": col,
                    "has_data": false,
                }));
            }
        },
    );
    serde_json::Value::Array(cells)
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn get_data_bounds_for_range(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    is_full_column: bool,
    is_full_row: bool,
) -> Option<RectBounds> {
    let range = cell_types::RangePos::new(*sheet_id, start_row, start_col, end_row, end_col);
    let span = if is_full_column {
        cell_iter::RangeSpan::FullColumns
    } else if is_full_row {
        cell_iter::RangeSpan::FullRows
    } else {
        cell_iter::RangeSpan::Exact
    };

    let grid = stores.grid_indexes.get(sheet_id)?;
    let bounded = cell_iter::get_data_bounds_for_range_with_extra_data(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        &range,
        span,
        |r, c| super::dimensions::mirror_render_has_data(stores, mirror, sheet_id, r, c),
    )?;

    Some(RectBounds {
        start_row: bounded.start_row(),
        start_col: bounded.start_col(),
        end_row: bounded.end_row(),
        end_col: bounded.end_col(),
    })
}
