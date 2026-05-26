use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, FilterChange, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{dimensions, filters};
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use value_types::{CellValue, ComputeError};

pub(in crate::storage::engine) fn create_filter(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    config: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let start_row = config["startRow"].as_u64().unwrap_or(0) as u32;
    let start_col = config["startCol"].as_u64().unwrap_or(0) as u32;
    let end_row = config["endRow"].as_u64().unwrap_or(0) as u32;
    let end_col = config["endCol"].as_u64().unwrap_or(0) as u32;

    // Filter range corners are stored as CellId references so filters survive
    // row/col insert/delete. Empty corners need identity-only CellIds so the
    // storage-layer references are always resolvable without expanding data.
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            })?;

    let header_start_id = grid.ensure_cell_id(start_row, start_col);
    let header_end_id = grid.ensure_cell_id(start_row, end_col);
    let data_end_id = grid.ensure_cell_id(end_row, end_col);

    mirror.register_identity_only(
        sheet_id,
        SheetPos::new(start_row, start_col),
        header_start_id,
    );
    mirror.register_identity_only(sheet_id, SheetPos::new(start_row, end_col), header_end_id);
    mirror.register_identity_only(sheet_id, SheetPos::new(end_row, end_col), data_end_id);

    let header_start = id_to_hex(header_start_id.as_u128()).to_string();
    let header_end = id_to_hex(header_end_id.as_u128()).to_string();
    let data_end = id_to_hex(data_end_id.as_u128()).to_string();

    let filter_type = serde_json::from_value(config["filterType"].clone())
        .unwrap_or(filters::FilterKind::AutoFilter);
    let table_id = config["tableId"].as_str().map(|s| s.to_string());
    let filter_state = filters::create_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &header_start,
        &header_end,
        &data_end,
        filter_type,
        table_id,
        &stores.id_alloc,
    )?;
    let mut result = MutationResult::empty();
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: filter_state.id.clone(),
        filter_kind: Some(filter_kind_wire(&filter_state.filter_kind).to_string()),
        action: Some("created".to_string()),
        hidden_row_count: None,
        visible_row_count: None,
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&filter_state)?)
}

fn filter_kind_wire(kind: &filters::FilterKind) -> &'static str {
    match kind {
        filters::FilterKind::AutoFilter => "autoFilter",
        filters::FilterKind::TableFilter => "tableFilter",
        filters::FilterKind::AdvancedFilter => "advancedFilter",
    }
}

pub(in crate::storage::engine) fn delete_filter(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    let existing = filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    let transitions = dimensions::clear_filter_hidden_rows(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        stores.grid_indexes.get(sheet_id),
    );
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        for &(row, hidden) in &transitions {
            if hidden {
                li.hide_row(row as usize);
            } else {
                li.unhide_row(row as usize);
            }
            mirror.set_row_hidden(sheet_id, row, hidden);
        }
    } else {
        for &(row, hidden) in &transitions {
            mirror.set_row_hidden(sheet_id, row, hidden);
        }
    }
    filters::delete_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    let mut result = MutationResult::empty();
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: filter_id.to_string(),
        filter_kind: existing
            .as_ref()
            .map(|filter| filter_kind_wire(&filter.filter_kind).to_string()),
        action: Some("deleted".to_string()),
        hidden_row_count: None,
        visible_row_count: None,
        kind: ChangeKind::Removed,
    });
    Ok(result)
}

fn resolve_header_col(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) -> Option<String> {
    let filter = filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    )?;
    let start_id = hex_to_id(&filter.header_start_cell_id)?;
    let start_cell_id = CellId::from_raw(start_id);
    let header_pos = mirror.resolve_position(&start_cell_id)?;
    let cell_id = stores
        .grid_indexes
        .get(sheet_id)?
        .cell_id_at(header_pos.row(), header_col)?;
    Some(id_to_hex(cell_id.as_u128()).into())
}

pub(in crate::storage::engine) fn set_column_filter(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
    criteria: filters::ColumnFilter,
) -> Result<MutationResult, ComputeError> {
    let header_cell_id =
        resolve_header_col(stores, mirror, sheet_id, filter_id, header_col).unwrap_or_default();
    filters::set_column_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        &header_cell_id,
        criteria,
    );
    apply_filter_with_action(stores, mirror, sheet_id, filter_id, "applied")
}

pub(in crate::storage::engine) fn clear_column_filter(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) -> Result<MutationResult, ComputeError> {
    let header_cell_id =
        resolve_header_col(stores, mirror, sheet_id, filter_id, header_col).unwrap_or_default();
    filters::clear_column_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        &header_cell_id,
    );
    apply_filter_with_action(stores, mirror, sheet_id, filter_id, "cleared")
}

pub(in crate::storage::engine) fn clear_all_column_filters(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    filters::clear_all_column_filters(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    apply_filter_with_action(stores, mirror, sheet_id, filter_id, "cleared")
}

pub(in crate::storage::engine) fn get_filter(
    stores: &EngineStores,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterState> {
    filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    )
}

pub(in crate::storage::engine) fn get_filter_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> usize {
    filters::get_filter_count(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_table_filter(
    stores: &EngineStores,
    sheet_id: &SheetId,
    table_id: &str,
) -> Option<filters::FilterState> {
    filters::get_table_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        table_id,
    )
}

pub(in crate::storage::engine) fn get_active_filters(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<filters::FilterState> {
    filters::get_active_filters(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_active_filter_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> usize {
    filters::get_active_filter_count(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_filter_sort_state(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    filter_id: &str,
    sort_state: Option<filters::FilterSortState>,
) -> Result<MutationResult, ComputeError> {
    filters::set_filter_sort_state(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        sort_state,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_filter_sort_state(
    stores: &EngineStores,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterSortState> {
    filters::get_filter_sort_state(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    )
}

pub(in crate::storage::engine) fn clear_all_filters(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    filters::clear_all_filters(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_filters_in_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Vec<filters::FilterState> {
    let mut states =
        filters::get_filters_in_sheet(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    for f in &mut states {
        if let Some(pos) = hex_to_id(&f.header_start_cell_id)
            .and_then(|id| mirror.resolve_position(&CellId::from_raw(id)))
        {
            f.start_row = Some(pos.row());
            f.start_col = Some(pos.col());
        }
        if let Some(pos) = hex_to_id(&f.header_end_cell_id)
            .and_then(|id| mirror.resolve_position(&CellId::from_raw(id)))
        {
            f.end_col = Some(pos.col());
        }
        if let Some(pos) = hex_to_id(&f.data_end_cell_id)
            .and_then(|id| mirror.resolve_position(&CellId::from_raw(id)))
        {
            f.end_row = Some(pos.row());
        }
    }
    states
}

pub(in crate::storage::engine) fn apply_filter(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    apply_filter_with_action(stores, mirror, sheet_id, filter_id, "applied")
}

fn apply_filter_with_action(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
    action: &str,
) -> Result<MutationResult, ComputeError> {
    let filter_kind = filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    )
    .map(|filter| filter_kind_wire(&filter.filter_kind).to_string());
    let sid = *sheet_id;
    let grid_index = stores.grid_indexes.get(&sid);
    let results = filters::evaluate_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        |row, col| {
            let pos = SheetPos::new(row, col);
            mirror
                .get_cell_value_at(&sid, pos)
                .cloned()
                .unwrap_or(CellValue::Null)
        },
        |row, col| {
            let cell_id_opt = grid_index.and_then(|grid| grid.cell_id_at(row, col));
            match cell_id_opt {
                Some(cid) => {
                    let cell_hex = id_to_hex(cid.as_u128());
                    let table_fmt =
                        super::tables::resolve_table_format_at_cell(mirror, &sid, row, col);
                    crate::storage::properties::get_effective_format(
                        &stores.storage,
                        &sid,
                        &cell_hex,
                        row,
                        col,
                        table_fmt.as_ref(),
                        grid_index,
                        mirror.get_sheet(&sid),
                    )
                }
                None => crate::storage::properties::get_positional_format(
                    &stores.storage,
                    &sid,
                    row,
                    col,
                    grid_index,
                    mirror.get_sheet(&sid),
                ),
            }
        },
        |hex| {
            let id = hex_to_id(hex)?;
            let cell_id = CellId::from_raw(id);
            let pos = mirror.resolve_position(&cell_id)?;
            Some((pos.row(), pos.col()))
        },
    );

    let mut rows_to_hide = Vec::new();
    let mut rows_to_unhide = Vec::new();
    for r in &results {
        if r.matches {
            rows_to_unhide.push(r.row);
        } else {
            rows_to_hide.push(r.row);
        }
    }

    let transitions = dimensions::set_filter_hidden_rows(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        &rows_to_hide,
        &rows_to_unhide,
        stores.grid_indexes.get(sheet_id),
    );
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        for &(r, hidden) in &transitions {
            if hidden {
                li.hide_row(r as usize);
            } else {
                li.unhide_row(r as usize);
            }
        }
    }

    for &(r, hidden) in &transitions {
        mirror.set_row_hidden(sheet_id, r, hidden);
    }

    let mut result = MutationResult::empty();
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: filter_id.to_string(),
        filter_kind,
        action: Some(action.to_string()),
        hidden_row_count: Some(rows_to_hide.len() as u32),
        visible_row_count: Some(rows_to_unhide.len() as u32),
        kind: ChangeKind::Set,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_unique_column_values(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) -> Vec<CellValue> {
    let header_cell_id = match resolve_header_col(stores, mirror, sheet_id, filter_id, header_col) {
        Some(id) => id,
        None => return vec![],
    };
    let sid = *sheet_id;
    filters::get_unique_values(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        &header_cell_id,
        |row, col| {
            let pos = SheetPos::new(row, col);
            mirror
                .get_cell_value_at(&sid, pos)
                .cloned()
                .unwrap_or(CellValue::Null)
        },
        |hex| {
            let id = hex_to_id(hex)?;
            let cell_id = CellId::from_raw(id);
            let pos = mirror.resolve_position(&cell_id)?;
            Some((pos.row(), pos.col()))
        },
    )
}

pub(in crate::storage::engine) fn get_filtered_record_count(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterRecordCount> {
    let sid = *sheet_id;
    let grid_index = stores.grid_indexes.get(&sid);
    filters::get_filtered_record_count(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        |row, col| {
            let pos = SheetPos::new(row, col);
            mirror
                .get_cell_value_at(&sid, pos)
                .cloned()
                .unwrap_or(CellValue::Null)
        },
        |row, col| {
            let cell_id_opt = grid_index.and_then(|grid| grid.cell_id_at(row, col));
            match cell_id_opt {
                Some(cid) => {
                    let cell_hex = id_to_hex(cid.as_u128());
                    let table_fmt =
                        super::tables::resolve_table_format_at_cell(mirror, &sid, row, col);
                    crate::storage::properties::get_effective_format(
                        &stores.storage,
                        &sid,
                        &cell_hex,
                        row,
                        col,
                        table_fmt.as_ref(),
                        grid_index,
                        mirror.get_sheet(&sid),
                    )
                }
                None => crate::storage::properties::get_positional_format(
                    &stores.storage,
                    &sid,
                    row,
                    col,
                    grid_index,
                    mirror.get_sheet(&sid),
                ),
            }
        },
        |hex| {
            let id = hex_to_id(hex)?;
            let cell_id = CellId::from_raw(id);
            let pos = mirror.resolve_position(&cell_id)?;
            Some((pos.row(), pos.col()))
        },
    )
}
