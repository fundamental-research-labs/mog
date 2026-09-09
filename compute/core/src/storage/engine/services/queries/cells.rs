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
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<serde_json::Value> {
    let cell_id = mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col))?;
    if mirror.sheet_for_cell(&cell_id).as_ref() != Some(sheet_id) {
        return None;
    }
    native_cell_data(stores, mirror, sheet_id, cell_id, row, col)
}

fn native_cell_data(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
) -> Option<serde_json::Value> {
    let value = mirror.get_cell_value_at(sheet_id, SheetPos::new(row, col))?;
    let formula = crate::storage::engine::formula_read::formula_text_at(
        stores,
        mirror,
        sheet_id,
        row,
        col,
        Some(&cell_id),
    );
    if value.is_null() && formula.is_none() {
        return None;
    }
    let mut data = serde_json::json!({
        "cell_id": id_to_hex(cell_id.as_u128()),
        "row": row,
        "col": col,
    });
    if !value.is_null() {
        data["raw"] = cell_value_to_json(value);
    }
    if let Some(formula) = formula {
        data["formula"] = formula.strip_prefix('=').unwrap_or(&formula).into();
    }
    Some(data)
}

pub(in crate::storage::engine) fn get_cell_data_by_id_hex(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<serde_json::Value> {
    let id_u128 = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(id_u128);
    if mirror.sheet_for_cell(&cell_id).as_ref() != Some(sheet_id) {
        return None;
    }
    let pos = mirror.resolve_position(&cell_id)?;
    native_cell_data(stores, mirror, sheet_id, cell_id, pos.row(), pos.col())
}

pub(in crate::storage::engine) fn get_raw_value(
    mirror: &CellMirror,
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> String {
    let cell_id = mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col));
    if let Some(formula) = crate::storage::engine::formula_read::formula_text_at(
        stores,
        mirror,
        sheet_id,
        row,
        col,
        cell_id.as_ref(),
    ) {
        return if formula.starts_with('=') {
            formula
        } else {
            format!("={formula}")
        };
    }
    mirror
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
        .filter(|value| !value.is_null())
        .map(ToString::to_string)
        .unwrap_or_default()
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

pub(in crate::storage::engine) fn get_cell_count(mirror: &CellMirror, sheet_id: &SheetId) -> usize {
    cell_values::get_cell_count(mirror, sheet_id)
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

    mirror.get_sheet(sheet_id)?;
    let bounded = cell_iter::get_data_bounds_for_range(*sheet_id, &range, span, |r, c| {
        super::dimensions::mirror_render_has_data(stores, mirror, sheet_id, r, c)
    })?;

    Some(RectBounds {
        start_row: bounded.start_row(),
        start_col: bounded.start_col(),
        end_row: bounded.end_row(),
        end_col: bounded.end_col(),
    })
}
