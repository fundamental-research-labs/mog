use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, FilterChange, MutationResult, RuntimeOperationDiagnostic};
use crate::storage::engine::services::filter_results::append_row_visibility_changes;
use crate::storage::engine::services::imported_filters;
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
    if filter_state.filter_kind == filters::FilterKind::AutoFilter {
        imported_filters::upsert_sheet_auto_filter_binding(
            stores,
            mirror,
            sheet_id,
            &filter_state,
            None,
            false,
        );
    }
    let mut result = MutationResult::empty();
    let metadata =
        filter_change_metadata_for_id(stores, sheet_id, &filter_state.id, Some(&filter_state));
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: filter_state.id.clone(),
        filter_kind: Some(filter_kind_wire(&filter_state.filter_kind).to_string()),
        table_id: metadata.table_id,
        capability: metadata.capability,
        unsupported_reasons: metadata.unsupported_reasons,
        has_active_filter: metadata.has_active_filter,
        clearable: metadata.clearable,
        diagnostics: Vec::new(),
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

fn table_filter_buttons_visible(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter: &filters::FilterState,
) -> bool {
    let Some(table_id) = filter.table_id.as_deref() else {
        return false;
    };
    let sheet_id = sheet_id.to_uuid_string();
    mirror
        .all_tables()
        .iter()
        .find(|table| {
            table.sheet_id == sheet_id && (table.id == table_id || table.name == table_id)
        })
        .is_some_and(|table| table.has_header_row && table.show_filter_buttons)
}

#[derive(Default)]
struct FilterChangeMetadata {
    table_id: Option<String>,
    capability: Option<String>,
    unsupported_reasons: Vec<String>,
    has_active_filter: Option<bool>,
    clearable: Option<bool>,
}

fn filter_change_metadata(
    filter: Option<&filters::FilterState>,
    binding: Option<&filters::FilterMetadataBinding>,
) -> FilterChangeMetadata {
    let table_id = filter
        .and_then(|filter| filter.table_id.clone())
        .or_else(|| binding.and_then(|binding| binding.table_id.clone()));
    let capability = binding.map(|binding| filter_capability_wire(binding.shell.capability).into());
    let unsupported_reasons = binding
        .map(|binding| {
            binding
                .shell
                .unsupported_reasons
                .iter()
                .map(|reason| unsupported_reason_wire(*reason).to_string())
                .collect()
        })
        .unwrap_or_default();
    let has_active_filter = (filter.is_some() || binding.is_some()).then(|| {
        filter
            .map(|filter| !filter.column_filters.is_empty())
            .unwrap_or(false)
            || binding
                .map(|binding| {
                    binding.shell.has_active_lossless_criteria
                        || !binding.shell.lossless_criteria.is_empty()
                })
                .unwrap_or(false)
    });
    let clearable = filter
        .map(|filter| filter.filter_kind != filters::FilterKind::AdvancedFilter)
        .or_else(|| {
            binding.map(|binding| binding.filter_kind != filters::FilterKind::AdvancedFilter)
        });

    FilterChangeMetadata {
        table_id,
        capability,
        unsupported_reasons,
        has_active_filter,
        clearable,
    }
}

fn filter_change_metadata_for_id(
    stores: &EngineStores,
    sheet_id: &SheetId,
    filter_id: &str,
    filter: Option<&filters::FilterState>,
) -> FilterChangeMetadata {
    let binding = filters::get_filter_metadata_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    filter_change_metadata(filter, binding.as_ref())
}

fn filter_capability_wire(capability: filters::FilterCapability) -> &'static str {
    match capability {
        filters::FilterCapability::Supported => "supported",
        filters::FilterCapability::Unsupported => "unsupported",
    }
}

fn unsupported_reason_wire(reason: filters::ImportFilterUnsupportedReason) -> &'static str {
    match reason {
        filters::ImportFilterUnsupportedReason::UnknownDynamicType => "unknownDynamicType",
        filters::ImportFilterUnsupportedReason::UnknownCustomOperator => "unknownCustomOperator",
        filters::ImportFilterUnsupportedReason::DateGroupUnsupported => "dateGroupUnsupported",
        filters::ImportFilterUnsupportedReason::DynamicTemporalContextUnsupported => {
            "dynamicTemporalContextUnsupported"
        }
        filters::ImportFilterUnsupportedReason::ValueTokenUnresolved => "valueTokenUnresolved",
        filters::ImportFilterUnsupportedReason::ValueTypeUnsupported => "valueTypeUnsupported",
        filters::ImportFilterUnsupportedReason::ColorDxfUnresolved => "colorDxfUnresolved",
        filters::ImportFilterUnsupportedReason::IconFilterUnsupported => "iconFilterUnsupported",
        filters::ImportFilterUnsupportedReason::UnknownExtension => "unknownExtension",
        filters::ImportFilterUnsupportedReason::TableFilterShapeUnsupported => {
            "tableFilterShapeUnsupported"
        }
    }
}

fn unsupported_filter_apply_diagnostic(
    _stores: &EngineStores,
    sheet_id: &SheetId,
    filter_id: &str,
    filter_kind: Option<String>,
    metadata: &FilterChangeMetadata,
    operation: &'static str,
) -> RuntimeOperationDiagnostic {
    RuntimeOperationDiagnostic {
        id: "runtime-diagnostic-pending".to_string(),
        sequence: "0".to_string(),
        code: "unsupported_filter_reapply".to_string(),
        severity: "warning".to_string(),
        recoverability: "unsupported_preserved".to_string(),
        operation: operation.to_string(),
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: Some(filter_id.to_string()),
        filter_kind,
        table_id: metadata.table_id.clone(),
        reason: metadata.unsupported_reasons.first().cloned(),
        reasons: metadata.unsupported_reasons.clone(),
        details: Some(serde_json::json!({
            "capability": metadata.capability.clone(),
            "hasActiveFilter": metadata.has_active_filter,
            "clearable": metadata.clearable,
        })),
        location: None,
    }
}

fn resolve_filter_cell_pos(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<(u32, u32)> {
    let id = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(id);
    if let Some(pos) = mirror.resolve_position(&cell_id) {
        return Some((pos.row(), pos.col()));
    }
    stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_position(&cell_id))
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
    let binding = filters::get_filter_metadata_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    let metadata = filter_change_metadata_for_id(stores, sheet_id, filter_id, existing.as_ref());
    let transitions = dimensions::clear_filter_hidden_rows(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        stores.grid_indexes.get(sheet_id),
    );
    imported_filters::apply_visibility_transitions(stores, mirror, sheet_id, &transitions);
    filters::delete_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    filters::delete_filter_metadata_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    if existing
        .as_ref()
        .is_some_and(|filter| filter.filter_kind == filters::FilterKind::AutoFilter)
    {
        imported_filters::delete_imported_auto_filter_metadata(stores, sheet_id, binding.as_ref());
    }
    let mut result = MutationResult::empty();
    append_row_visibility_changes(&mut result, sheet_id, &transitions);
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: filter_id.to_string(),
        filter_kind: existing
            .as_ref()
            .map(|filter| filter_kind_wire(&filter.filter_kind).to_string()),
        table_id: metadata.table_id,
        capability: metadata.capability,
        unsupported_reasons: metadata.unsupported_reasons,
        has_active_filter: metadata.has_active_filter,
        clearable: metadata.clearable,
        diagnostics: Vec::new(),
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
    let header_pos =
        resolve_filter_cell_pos(stores, mirror, sheet_id, &filter.header_start_cell_id)?;
    let cell_id = stores
        .grid_indexes
        .get(sheet_id)?
        .cell_id_at(header_pos.0, header_col)?;
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
    imported_filters::sync_imported_auto_filter_metadata_after_set_column(
        stores, mirror, sheet_id, filter_id, header_col,
    );
    apply_filter_with_action(
        stores,
        mirror,
        sheet_id,
        filter_id,
        "applied",
        Some("applyFilter"),
    )
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
    imported_filters::sync_imported_auto_filter_metadata_after_clear_column(
        stores, mirror, sheet_id, filter_id, header_col,
    );
    apply_filter_with_action(stores, mirror, sheet_id, filter_id, "cleared", None)
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
    imported_filters::sync_imported_auto_filter_metadata_from_runtime(
        stores, mirror, sheet_id, filter_id,
    );
    apply_filter_with_action(stores, mirror, sheet_id, filter_id, "cleared", None)
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
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let existing =
        filters::get_filters_in_sheet(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    for filter in existing {
        let mut deleted = delete_filter(stores, mirror, sheet_id, &filter.id)?;
        result
            .visibility_changes
            .append(&mut deleted.visibility_changes);
        result.filter_changes.append(&mut deleted.filter_changes);
        result.diagnostics.append(&mut deleted.diagnostics);
    }
    Ok(result)
}

pub(in crate::storage::engine) fn get_filters_in_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Vec<filters::FilterState> {
    let mut states =
        filters::get_filters_in_sheet(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    for f in &mut states {
        if let Some((row, col)) =
            resolve_filter_cell_pos(stores, mirror, sheet_id, &f.header_start_cell_id)
        {
            f.start_row = Some(row);
            f.start_col = Some(col);
        }
        if let Some((_row, col)) =
            resolve_filter_cell_pos(stores, mirror, sheet_id, &f.header_end_cell_id)
        {
            f.end_col = Some(col);
        }
        if let Some((row, _col)) =
            resolve_filter_cell_pos(stores, mirror, sheet_id, &f.data_end_cell_id)
        {
            f.end_row = Some(row);
        }
    }
    states
}

pub(in crate::storage::engine) fn get_filter_header_info(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Vec<filters::FilterHeaderInfo> {
    let imported_auto_filter =
        imported_filters::read_imported_auto_filter_metadata(stores, sheet_id);
    let mut entries = Vec::new();

    for filter in get_filters_in_sheet(stores, mirror, sheet_id) {
        if filter.filter_kind == filters::FilterKind::AdvancedFilter {
            continue;
        }
        let metadata_binding = filters::get_filter_metadata_binding(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            &filter.id,
        );

        let (Some(start_row), Some(start_col), Some(end_row), Some(end_col)) = (
            filter.start_row,
            filter.start_col,
            filter.end_row,
            filter.end_col,
        ) else {
            continue;
        };

        let range = filters::FilterHeaderRange {
            start_row,
            start_col,
            end_row,
            end_col,
        };

        for col in start_col..=end_col {
            let Some(header_cell_id) = resolve_header_cell_id_for_column(
                stores, mirror, sheet_id, &filter, start_row, col,
            ) else {
                continue;
            };
            let relative_col = col.saturating_sub(start_col);
            let has_active_filter =
                column_has_active_filter(
                    stores,
                    mirror,
                    sheet_id,
                    &filter,
                    &header_cell_id,
                    start_row,
                    col,
                ) || binding_has_active_lossless_criterion(metadata_binding.as_ref(), relative_col);
            let (hidden_button, show_button) = match &filter.filter_kind {
                filters::FilterKind::AutoFilter => metadata_binding
                    .as_ref()
                    .and_then(|binding| binding.shell.button_metadata.get(&header_cell_id))
                    .map(|metadata| (metadata.hidden_button, metadata.show_button.unwrap_or(true)))
                    .unwrap_or_else(|| {
                        imported_filter_button_flags(imported_auto_filter.as_ref(), relative_col)
                    }),
                filters::FilterKind::TableFilter => (
                    false,
                    table_filter_buttons_visible(mirror, sheet_id, &filter),
                ),
                filters::FilterKind::AdvancedFilter => (false, true),
            };
            let source_type = match &filter.filter_kind {
                filters::FilterKind::AutoFilter => filters::FilterHeaderSourceType::SheetAutoFilter,
                filters::FilterKind::TableFilter => {
                    filters::FilterHeaderSourceType::TableAutoFilter
                }
                filters::FilterKind::AdvancedFilter => continue,
            };
            let capability = metadata_binding
                .as_ref()
                .map(|binding| binding.shell.capability)
                .unwrap_or(filters::FilterCapability::Supported);
            let unsupported_reasons = metadata_binding
                .as_ref()
                .map(|binding| binding.shell.unsupported_reasons.clone())
                .unwrap_or_default();

            entries.push(filters::FilterHeaderInfo {
                filter_id: filter.id.clone(),
                header_cell_id: header_cell_id.clone(),
                has_active_filter,
                row: start_row,
                col,
                filter_kind: filter.filter_kind.clone(),
                range: range.clone(),
                table_id: filter.table_id.clone(),
                source_type,
                capability,
                unsupported_reasons,
                button_visible: !hidden_button && show_button,
                hidden_button,
                show_button,
            });
        }
    }

    entries
}

fn resolve_header_cell_id_for_column(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter: &filters::FilterState,
    header_row: u32,
    col: u32,
) -> Option<String> {
    if let Some(cell_id) = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(header_row, col))
    {
        return Some(id_to_hex(cell_id.as_u128()).to_string());
    }

    filter.column_filters.keys().find_map(|header_cell_id| {
        resolve_filter_cell_pos(stores, mirror, sheet_id, header_cell_id)
            .filter(|(row, resolved_col)| *row == header_row && *resolved_col == col)
            .map(|_| header_cell_id.clone())
    })
}

fn column_has_active_filter(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter: &filters::FilterState,
    header_cell_id: &str,
    header_row: u32,
    col: u32,
) -> bool {
    filter.column_filters.contains_key(header_cell_id)
        || filter.column_filters.keys().any(|candidate| {
            resolve_filter_cell_pos(stores, mirror, sheet_id, candidate)
                .is_some_and(|(row, resolved_col)| row == header_row && resolved_col == col)
        })
}

fn binding_has_active_lossless_criterion(
    binding: Option<&filters::FilterMetadataBinding>,
    relative_col: u32,
) -> bool {
    binding.is_some_and(|binding| {
        binding.shell.lossless_criteria.iter().any(|criterion| {
            criterion.filter_col_id == Some(relative_col)
                || criterion.table_column_ordinal == Some(relative_col)
        })
    })
}

fn imported_filter_button_flags(
    imported_auto_filter: Option<&domain_types::domain::filter::AutoFilter>,
    relative_col: u32,
) -> (bool, bool) {
    imported_auto_filter
        .and_then(|auto_filter| {
            auto_filter
                .columns
                .iter()
                .find(|column| column.col_index == relative_col)
        })
        .map(|column| (column.hidden_button, column.show_button))
        .unwrap_or((false, true))
}

pub(in crate::storage::engine) fn apply_filter(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    apply_filter_with_action(
        stores,
        mirror,
        sheet_id,
        filter_id,
        "applied",
        Some("applyFilter"),
    )
}

pub(in crate::storage::engine) fn reapply_filter(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    apply_filter_with_action(
        stores,
        mirror,
        sheet_id,
        filter_id,
        "reapplied",
        Some("reapplyFilter"),
    )
}

fn apply_filter_with_action(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
    action: &str,
    diagnostic_operation: Option<&'static str>,
) -> Result<MutationResult, ComputeError> {
    let filter = filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    let filter_kind = filter
        .as_ref()
        .map(|filter| filter_kind_wire(&filter.filter_kind).to_string());
    let metadata = filter_change_metadata_for_id(stores, sheet_id, filter_id, filter.as_ref());
    if imported_shell_disallows_filter_ownership(stores, sheet_id, filter_id) {
        let diagnostics = if let Some(operation) = diagnostic_operation {
            vec![unsupported_filter_apply_diagnostic(
                stores,
                sheet_id,
                filter_id,
                filter_kind.clone(),
                &metadata,
                operation,
            )]
        } else {
            Vec::new()
        };
        let mut result = MutationResult::empty();
        result.diagnostics = diagnostics.clone();
        result.filter_changes.push(FilterChange {
            sheet_id: sheet_id.to_uuid_string(),
            filter_id: filter_id.to_string(),
            filter_kind,
            table_id: metadata.table_id,
            capability: metadata.capability,
            unsupported_reasons: metadata.unsupported_reasons,
            has_active_filter: metadata.has_active_filter,
            clearable: metadata.clearable,
            diagnostics,
            action: Some(action.to_string()),
            hidden_row_count: None,
            visible_row_count: None,
            kind: ChangeKind::Set,
        });
        return Ok(result);
    }

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
        |hex| resolve_filter_cell_pos(stores, mirror, sheet_id, hex),
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
    imported_filters::apply_visibility_transitions(stores, mirror, sheet_id, &transitions);

    let mut result = MutationResult::empty();
    append_row_visibility_changes(&mut result, sheet_id, &transitions);
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: filter_id.to_string(),
        filter_kind,
        table_id: metadata.table_id,
        capability: metadata.capability,
        unsupported_reasons: metadata.unsupported_reasons,
        has_active_filter: metadata.has_active_filter,
        clearable: metadata.clearable,
        diagnostics: Vec::new(),
        action: Some(action.to_string()),
        hidden_row_count: Some(rows_to_hide.len() as u32),
        visible_row_count: Some(rows_to_unhide.len() as u32),
        kind: ChangeKind::Set,
    });
    Ok(result)
}

fn imported_shell_disallows_filter_ownership(
    stores: &EngineStores,
    sheet_id: &SheetId,
    filter_id: &str,
) -> bool {
    filters::get_filter_metadata_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    )
    .is_some_and(|binding| binding_disallows_filter_ownership(Some(&binding)))
}

fn binding_disallows_filter_ownership(binding: Option<&filters::FilterMetadataBinding>) -> bool {
    binding
        .is_some_and(|binding| binding.shell.capability == filters::FilterCapability::Unsupported)
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
        |hex| resolve_filter_cell_pos(stores, mirror, sheet_id, hex),
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
        |hex| resolve_filter_cell_pos(stores, mirror, sheet_id, hex),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn metadata_binding_with_lossless_col(relative_col: u32) -> filters::FilterMetadataBinding {
        filters::FilterMetadataBinding {
            filter_id: "filter-1".to_string(),
            filter_kind: filters::FilterKind::AutoFilter,
            sheet_id: "sheet-1".to_string(),
            table_id: None,
            owner_path: filters::FilterMetadataOwnerPath::SheetAutoFilter {
                sheet_id: "sheet-1".to_string(),
            },
            source_key: filters::FilterMetadataSourceKey::SheetAutoFilter {
                sheet_id: "sheet-1".to_string(),
                range_ref: "A1:D12".to_string(),
            },
            range_ref: "A1:D12".to_string(),
            header_start_cell_id: "header-a".to_string(),
            header_end_cell_id: "header-d".to_string(),
            data_end_cell_id: "cell-d12".to_string(),
            col_id_to_header_cell_id: BTreeMap::new(),
            table_column_id_to_header_cell_id: BTreeMap::new(),
            shell: filters::FilterShellMetadata {
                capability: filters::FilterCapability::Unsupported,
                unsupported_reasons: vec![
                    filters::ImportFilterUnsupportedReason::IconFilterUnsupported,
                ],
                has_active_lossless_criteria: true,
                button_metadata: BTreeMap::new(),
                lossless_criteria: vec![filters::LosslessCriterionDescriptor {
                    filter_col_id: Some(relative_col),
                    table_column_id: None,
                    table_column_ordinal: None,
                    kind: "icon".to_string(),
                    preserved_json: serde_json::json!({ "iconId": 1 }),
                }],
            },
            source_fingerprint: "filterMetadataBindingFingerprintV1:test".to_string(),
        }
    }

    #[test]
    fn filter_metadata_binding_lossless_criterion_marks_header_active() {
        let binding = metadata_binding_with_lossless_col(2);

        assert!(binding_has_active_lossless_criterion(Some(&binding), 2));
        assert!(!binding_has_active_lossless_criterion(Some(&binding), 1));
        assert!(!binding_has_active_lossless_criterion(None, 2));
    }

    #[test]
    fn unsupported_filter_metadata_binding_disallows_filter_ownership() {
        let unsupported = metadata_binding_with_lossless_col(2);
        let mut supported = unsupported.clone();
        supported.shell.capability = filters::FilterCapability::Supported;
        supported.shell.unsupported_reasons.clear();

        assert!(binding_disallows_filter_ownership(Some(&unsupported)));
        assert!(!binding_disallows_filter_ownership(Some(&supported)));
        assert!(!binding_disallows_filter_ownership(None));
    }
}
