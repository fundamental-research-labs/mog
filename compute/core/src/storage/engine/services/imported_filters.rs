use std::collections::{BTreeMap, BTreeSet};

use crate::storage::engine::history::metadata::{capture_row, capture_sheet_field};
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use domain_types::domain::filter::{
    AutoFilter, FilterColumn, OoxmlFilterType, column_filter_to_ooxml_filter_type,
};
use value_types::CellValue;

use crate::cells::CellStore;
use crate::storage::engine::filter_import_diagnostics::{
    resolve_filter_cell_pos, unsupported_filter_import_diagnostic, upsert_import_diagnostic_phase,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{dimensions, filters, properties};

/// Reconcile imported sheet-level AutoFilters with runtime row visibility.
///
/// Hydration preserves the OOXML `<autoFilter>` under `properties/autoFilter`
/// and creates a runtime `FilterState`. This pass runs after CellStore,
/// GridIndex, and PixelLayout are available, evaluates the runtime criteria,
/// and transfers excluded rows from ambiguous imported `hidden="1"` ownership
/// to filter ownership.
pub(in crate::storage::engine) fn normalize_imported_auto_filter_visibility(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    mut import_report: Option<&mut domain_types::ImportReport>,
    import_phase: domain_types::ImportPhase,
) {
    let mut profile =
        crate::xlsx_profile::PhaseTimer::new("import", "normalize_imported_auto_filter_visibility");
    let had_import_report = import_report.is_some();
    {
        let mut materialize_profile =
            crate::xlsx_profile::PhaseTimer::new("import", "materialize_table_auto_filters");
        crate::storage::engine::construction::materialize_table_auto_filters_from_preserved_specs(
            stores,
            cell_store,
            import_report.as_deref_mut(),
            import_phase,
        );
        materialize_profile.counter("had_import_report", u64::from(had_import_report));
    }

    let sheet_ids: Vec<SheetId> = stores.grid_indexes.keys().copied().collect();
    profile.counter("sheets", sheet_ids.len() as u64);
    profile.counter("had_import_report", u64::from(had_import_report));
    for sheet_id in sheet_ids {
        normalize_imported_auto_filter_visibility_for_sheet(
            stores,
            cell_store,
            &sheet_id,
            import_report.as_deref_mut(),
            import_phase,
        );
    }
}

pub(in crate::storage::engine) fn normalize_imported_auto_filter_visibility_for_sheet(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    mut import_report: Option<&mut domain_types::ImportReport>,
    import_phase: domain_types::ImportPhase,
) {
    let imported_auto_filter = read_imported_auto_filter_metadata(stores, sheet_id);
    if imported_auto_filter.is_some() {
        upsert_sheet_auto_filter_bindings_for_sheet(
            stores,
            cell_store,
            sheet_id,
            imported_auto_filter.as_ref(),
        );
    }

    let imported_filters = filters::get_filters_in_sheet(&stores.storage, sheet_id)
        .into_iter()
        .filter(|filter| {
            matches!(
                filter.filter_kind,
                filters::FilterKind::AutoFilter | filters::FilterKind::TableFilter
            ) && !filter.column_filters.is_empty()
        })
        .collect::<Vec<_>>();

    for filter in imported_filters {
        let binding = filters::get_filter_metadata_binding(&stores.storage, sheet_id, &filter.id);
        if let Some(binding) = binding.as_ref() {
            if binding.shell.capability == filters::FilterCapability::Unsupported {
                if filter.filter_kind == filters::FilterKind::AutoFilter
                    && let Some(report) = import_report.as_deref_mut()
                {
                    record_unsupported_filter_import_diagnostics(
                        stores,
                        cell_store,
                        sheet_id,
                        binding,
                        imported_auto_filter.as_ref(),
                        report,
                        import_phase,
                    );
                }
                continue;
            }
        }

        let results = {
            let mut eval_profile =
                crate::xlsx_profile::PhaseTimer::new("import", "evaluate_imported_filter");
            let results = evaluate_runtime_filter(stores, cell_store, sheet_id, &filter.id);
            eval_profile.counter("rows", results.len() as u64);
            eval_profile.counter("column_filters", filter.column_filters.len() as u64);
            eval_profile.counter(
                "kind",
                match filter.filter_kind {
                    filters::FilterKind::AutoFilter => 1_u64,
                    filters::FilterKind::TableFilter => 2_u64,
                    filters::FilterKind::AdvancedFilter => 3_u64,
                },
            );
            results
        };
        if results.is_empty() {
            continue;
        }

        let mut rows_excluded = Vec::new();
        let mut rows_included = Vec::new();
        for result in results {
            if result.matches {
                rows_included.push(result.row);
            } else {
                rows_excluded.push(result.row);
            }
        }

        let transitions = {
            let mut visibility_profile =
                crate::xlsx_profile::PhaseTimer::new("import", "normalize_filter_hidden_rows");
            let transitions = dimensions::normalize_imported_filter_hidden_rows(
                &mut stores.storage,
                sheet_id,
                &filter.id,
                &rows_excluded,
                &rows_included,
                stores.grid_indexes.get(sheet_id),
            );
            visibility_profile.counter("rows_excluded", rows_excluded.len() as u64);
            visibility_profile.counter("rows_included", rows_included.len() as u64);
            visibility_profile.counter("transitions", transitions.len() as u64);
            transitions
        };
        apply_visibility_transitions(stores, cell_store, sheet_id, &transitions);
        remove_filter_only_rows_from_explicit_hidden_metadata(
            stores,
            sheet_id,
            rows_excluded.iter().copied(),
        );
        sync_store_rows_from_effective_hidden(stores, cell_store, sheet_id, &rows_excluded);
        sync_store_rows_from_effective_hidden(stores, cell_store, sheet_id, &rows_included);
    }
}

fn remove_filter_only_rows_from_explicit_hidden_metadata(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rows: impl IntoIterator<Item = u32>,
) {
    let grid = stores.grid_indexes.get(sheet_id);
    let ids: Vec<_> = rows
        .into_iter()
        .filter(|row| {
            let owner =
                dimensions::get_row_visibility_ownership(&stores.storage, sheet_id, *row, grid);
            !owner.manual && !owner.structural && !owner.filter_owner_ids.is_empty()
        })
        .filter_map(|row| grid?.row_id(row))
        .collect();
    for id in &ids {
        capture_row(&stores.storage, *sheet_id, *id);
    }
    if let Some(meta) = stores.storage.sheet_metadata.get_mut(sheet_id) {
        for id in ids {
            if let Some(row) = meta.dimensions.rows.get_mut(&id) {
                row.explicit_hidden = false;
            }
        }
    }
}

pub(in crate::storage::engine) fn sync_imported_auto_filter_metadata_from_runtime(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    filter_id: &str,
) {
    let Some(mut metadata) = read_imported_auto_filter_metadata(stores, sheet_id) else {
        return;
    };
    let Some(filter_state) = filters::get_filter(&stores.storage, sheet_id, filter_id) else {
        return;
    };
    if filter_state.filter_kind != filters::FilterKind::AutoFilter {
        return;
    }

    let runtime_auto_filter =
        domain_types::domain::filter::filter_state_to_auto_filter(&filter_state, &|hex| {
            resolve_filter_cell_pos(cell_store, sheet_id, hex)
        });
    let Some(runtime_auto_filter) = runtime_auto_filter else {
        return;
    };

    merge_runtime_auto_filter_into_imported_metadata(&mut metadata, runtime_auto_filter);
    write_imported_auto_filter_metadata(stores, sheet_id, &metadata);
    if let Some(filter_state) = filters::get_filter(&stores.storage, sheet_id, filter_id) {
        upsert_sheet_auto_filter_binding(
            stores,
            cell_store,
            sheet_id,
            &filter_state,
            Some(&metadata),
        );
    }
}

pub(in crate::storage::engine) fn sync_imported_auto_filter_metadata_after_set_column(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) {
    sync_imported_auto_filter_column_metadata(
        stores,
        cell_store,
        sheet_id,
        filter_id,
        header_col,
        ColumnMetadataSync::ReplaceFromRuntime,
    );
}

pub(in crate::storage::engine) fn sync_imported_auto_filter_metadata_after_clear_column(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) {
    sync_imported_auto_filter_column_metadata(
        stores,
        cell_store,
        sheet_id,
        filter_id,
        header_col,
        ColumnMetadataSync::Clear,
    );
}

enum ColumnMetadataSync {
    ReplaceFromRuntime,
    Clear,
}

fn sync_imported_auto_filter_column_metadata(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
    sync: ColumnMetadataSync,
) {
    let Some(mut metadata) = read_imported_auto_filter_metadata(stores, sheet_id) else {
        return;
    };
    let Some(filter_state) = filters::get_filter(&stores.storage, sheet_id, filter_id) else {
        return;
    };
    if filter_state.filter_kind != filters::FilterKind::AutoFilter {
        return;
    }

    let Some((header_row, start_col)) =
        resolve_filter_cell_pos(cell_store, sheet_id, &filter_state.header_start_cell_id)
    else {
        return;
    };
    if header_col < start_col {
        return;
    }

    refresh_imported_auto_filter_range_from_filter_state(
        &mut metadata,
        cell_store,
        sheet_id,
        &filter_state,
    );

    let relative_col = header_col - start_col;
    let filter_type = match sync {
        ColumnMetadataSync::ReplaceFromRuntime => cell_store
            .resolve_cell_id(sheet_id, SheetPos::new(header_row, header_col))
            .map(|cell_id| id_to_hex(cell_id.as_u128()).to_string())
            .and_then(|header_cell_id| {
                filter_state
                    .column_filters
                    .get(&header_cell_id)
                    .map(column_filter_to_ooxml_filter_type)
            }),
        ColumnMetadataSync::Clear => None,
    };

    replace_imported_column_filter_type(&mut metadata, relative_col, filter_type);
    write_imported_auto_filter_metadata(stores, sheet_id, &metadata);
    upsert_sheet_auto_filter_binding(stores, cell_store, sheet_id, &filter_state, Some(&metadata));
}

pub(in crate::storage::engine) fn delete_imported_auto_filter_metadata(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    binding: Option<&filters::FilterMetadataBinding>,
) {
    let current_sheet_id = sheet_id.to_uuid_string();
    if let Some(binding) = binding {
        match &binding.owner_path {
            filters::FilterMetadataOwnerPath::SheetAutoFilter { sheet_id }
                if sheet_id == &current_sheet_id
                    && binding.filter_kind == filters::FilterKind::AutoFilter => {}
            _ => return,
        }
    }

    capture_sheet_field!(stores.storage, *sheet_id, auto_filter);
    if let Some(metadata) = stores.storage.sheet_metadata.get_mut(sheet_id) {
        metadata.auto_filter = None;
    }
}

pub(in crate::storage::engine) fn read_imported_auto_filter_metadata(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<AutoFilter> {
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)?
        .auto_filter
        .clone()
}

pub(in crate::storage::engine) fn upsert_sheet_auto_filter_bindings_for_sheet(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    imported_auto_filter: Option<&AutoFilter>,
) {
    let filters = filters::get_filters_in_sheet(&stores.storage, sheet_id);
    for filter in filters
        .iter()
        .filter(|filter| filter.filter_kind == filters::FilterKind::AutoFilter)
    {
        upsert_sheet_auto_filter_binding(
            stores,
            cell_store,
            sheet_id,
            filter,
            imported_auto_filter,
        );
    }
}

pub(in crate::storage::engine) fn upsert_sheet_auto_filter_binding(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    filter: &filters::FilterState,
    imported_auto_filter: Option<&AutoFilter>,
) {
    if filter.filter_kind != filters::FilterKind::AutoFilter {
        return;
    }

    let Some((start_row, start_col)) =
        resolve_filter_cell_pos(cell_store, sheet_id, &filter.header_start_cell_id)
    else {
        return;
    };
    let Some((header_end_row, end_col)) =
        resolve_filter_cell_pos(cell_store, sheet_id, &filter.header_end_cell_id)
    else {
        return;
    };
    let Some((end_row, _data_end_col)) =
        resolve_filter_cell_pos(cell_store, sheet_id, &filter.data_end_cell_id)
    else {
        return;
    };
    if header_end_row != start_row || end_col < start_col {
        return;
    }

    let range_ref = imported_auto_filter
        .map(|auto_filter| auto_filter.range_ref.clone())
        .filter(|range| !range.is_empty())
        .unwrap_or_else(|| range_ref_from_bounds(start_row, start_col, end_row, end_col));
    let sheet_id_text = sheet_id.to_uuid_string();
    let mut col_id_to_header_cell_id = BTreeMap::new();
    let mut button_metadata = BTreeMap::new();

    {
        for col in start_col..=end_col {
            let Some(cell_id) =
                super::cell_editing::ensure_cell_id(stores, cell_store, sheet_id, start_row, col)
            else {
                return;
            };
            let header_cell_id = id_to_hex(cell_id.as_u128()).to_string();
            let col_id = col.saturating_sub(start_col);
            col_id_to_header_cell_id.insert(col_id, header_cell_id.clone());
            let source_column = imported_auto_filter.and_then(|auto_filter| {
                auto_filter
                    .columns
                    .iter()
                    .find(|column| column.col_index == col_id)
            });
            let hidden_button = source_column.is_some_and(|column| column.hidden_button);
            let show_button = source_column.map(|column| column.show_button);
            button_metadata.insert(
                header_cell_id.clone(),
                filters::FilterButtonMetadata {
                    header_cell_id,
                    col_id,
                    hidden_button,
                    show_button,
                    button_visible: !hidden_button && show_button.unwrap_or(true),
                },
            );
        }
    }

    let shell = super::imported_filter_shell::build_filter_shell_metadata(
        imported_auto_filter,
        button_metadata,
    );
    let fingerprint = super::imported_filter_shell::filter_binding_fingerprint(
        &sheet_id_text,
        &range_ref,
        imported_auto_filter,
        &shell,
        &col_id_to_header_cell_id,
    );
    let binding = filters::FilterMetadataBinding {
        filter_id: filter.id.clone(),
        filter_kind: filter.filter_kind.clone(),
        sheet_id: sheet_id_text.clone(),
        table_id: filter.table_id.clone(),
        owner_path: filters::FilterMetadataOwnerPath::SheetAutoFilter {
            sheet_id: sheet_id_text.clone(),
        },
        source_key: filters::FilterMetadataSourceKey::SheetAutoFilter {
            sheet_id: sheet_id_text,
            range_ref: range_ref.clone(),
        },
        range_ref,
        header_start_cell_id: filter.header_start_cell_id.clone(),
        header_end_cell_id: filter.header_end_cell_id.clone(),
        data_end_cell_id: filter.data_end_cell_id.clone(),
        col_id_to_header_cell_id,
        table_column_id_to_header_cell_id: BTreeMap::new(),
        shell,
        source_fingerprint: fingerprint,
    };

    filters::delete_stale_filter_metadata_bindings_for_source_key(
        &mut stores.storage,
        sheet_id,
        &binding,
    );
    filters::upsert_filter_metadata_binding(&mut stores.storage, sheet_id, &binding);
}

fn record_unsupported_filter_import_diagnostics(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    binding: &filters::FilterMetadataBinding,
    imported_auto_filter: Option<&AutoFilter>,
    report: &mut domain_types::ImportReport,
    import_phase: domain_types::ImportPhase,
) {
    let Some(imported_auto_filter) = imported_auto_filter else {
        return;
    };

    let sheet_index = stores
        .storage
        .sheet_order()
        .iter()
        .position(|candidate| candidate == sheet_id)
        .map(|idx| idx as u32);
    let sheet_name = properties::get_sheet_name(&stores.storage, sheet_id);
    let source_key = serde_json::to_string(&binding.source_key).ok();

    if imported_auto_filter.ext_lst_raw.is_some() {
        let diagnostic = unsupported_filter_import_diagnostic(
            binding,
            sheet_index,
            sheet_name.clone(),
            source_key.clone(),
            Some(binding.filter_id.clone()),
            None,
            None,
            resolve_filter_cell_pos(cell_store, sheet_id, &binding.header_start_cell_id),
            vec![filters::ImportFilterUnsupportedReason::UnknownExtension],
            "autoFilter".to_string(),
            domain_types::ImportFeatureKind::Worksheet,
        );
        upsert_import_diagnostic_phase(report, diagnostic, import_phase);
    }

    for column in &imported_auto_filter.columns {
        let mut reasons = BTreeSet::new();
        if column.ext_lst_raw.is_some() {
            reasons.insert(filters::ImportFilterUnsupportedReason::UnknownExtension);
        }
        if let Some(filter_type) = &column.filter_type {
            reasons.extend(
                super::imported_filter_shell::unsupported_reasons_for_filter_type(filter_type),
            );
        }
        if reasons.is_empty() {
            continue;
        }

        let resolved_cell = binding
            .col_id_to_header_cell_id
            .get(&column.col_index)
            .and_then(|header_cell_id| {
                resolve_filter_cell_pos(cell_store, sheet_id, header_cell_id)
            });
        let diagnostic = unsupported_filter_import_diagnostic(
            binding,
            sheet_index,
            sheet_name.clone(),
            source_key.clone(),
            Some(binding.filter_id.clone()),
            Some(column.col_index),
            None,
            resolved_cell,
            reasons.into_iter().collect(),
            "autoFilter".to_string(),
            domain_types::ImportFeatureKind::Worksheet,
        );
        upsert_import_diagnostic_phase(report, diagnostic, import_phase);
    }
}

fn range_ref_from_bounds(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> String {
    format!(
        "{}{}:{}{}",
        column_name(start_col),
        start_row + 1,
        column_name(end_col),
        end_row + 1
    )
}

fn column_name(mut zero_based_col: u32) -> String {
    let mut chars = Vec::new();
    zero_based_col += 1;
    while zero_based_col > 0 {
        let rem = ((zero_based_col - 1) % 26) as u8;
        chars.push((b'A' + rem) as char);
        zero_based_col = (zero_based_col - 1) / 26;
    }
    chars.iter().rev().collect()
}

fn write_imported_auto_filter_metadata(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    auto_filter: &AutoFilter,
) {
    capture_sheet_field!(stores.storage, *sheet_id, auto_filter);
    if let Some(metadata) = stores.storage.sheet_metadata.get_mut(sheet_id) {
        metadata.auto_filter = Some(auto_filter.clone());
    }
}

fn merge_runtime_auto_filter_into_imported_metadata(
    imported: &mut AutoFilter,
    runtime: AutoFilter,
) {
    imported.range_ref = runtime.range_ref;

    let mut runtime_columns: BTreeMap<u32, domain_types::domain::filter::FilterColumn> = runtime
        .columns
        .into_iter()
        .map(|column| (column.col_index, column))
        .collect();

    for imported_column in &mut imported.columns {
        if let Some(runtime_column) = runtime_columns.remove(&imported_column.col_index) {
            imported_column.filter_type = runtime_column.filter_type;
        } else {
            imported_column.filter_type = None;
        }
    }

    imported.columns.extend(runtime_columns.into_values());
    imported.columns.sort_by_key(|column| column.col_index);
}

fn refresh_imported_auto_filter_range_from_filter_state(
    imported: &mut AutoFilter,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    filter_state: &filters::FilterState,
) {
    let Some((start_row, start_col)) =
        resolve_filter_cell_pos(cell_store, sheet_id, &filter_state.header_start_cell_id)
    else {
        return;
    };
    let Some((end_row, end_col)) =
        resolve_filter_cell_pos(cell_store, sheet_id, &filter_state.data_end_cell_id)
    else {
        return;
    };
    imported.range_ref = range_ref_from_bounds(start_row, start_col, end_row, end_col);
}

fn replace_imported_column_filter_type(
    imported: &mut AutoFilter,
    relative_col: u32,
    filter_type: Option<OoxmlFilterType>,
) {
    if let Some(column) = imported
        .columns
        .iter_mut()
        .find(|column| column.col_index == relative_col)
    {
        column.filter_type = filter_type;
        return;
    }

    if filter_type.is_some() {
        imported.columns.push(FilterColumn {
            col_index: relative_col,
            filter_type,
            ..Default::default()
        });
        imported.columns.sort_by_key(|column| column.col_index);
    }
}

pub(in crate::storage::engine) fn apply_visibility_transitions(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    transitions: &[(u32, bool)],
) {
    if transitions.is_empty() {
        return;
    }
    let aggregate_states: Vec<(u32, bool)> = transitions
        .iter()
        .map(|&(row, _cache_hidden)| {
            let hidden = dimensions::get_row_visibility_ownership(
                &stores.storage,
                sheet_id,
                row,
                stores.grid_indexes.get(sheet_id),
            )
            .effective_hidden;
            (row, hidden)
        })
        .collect();

    stores.invalidate_pixel_layout(sheet_id);
    for (row, hidden) in aggregate_states {
        cell_store.set_row_hidden(sheet_id, row, hidden);
    }
}

fn sync_store_rows_from_effective_hidden(
    stores: &EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    rows: &[u32],
) {
    for &row in rows {
        let hidden = dimensions::get_row_visibility_ownership(
            &stores.storage,
            sheet_id,
            row,
            stores.grid_indexes.get(sheet_id),
        )
        .effective_hidden;
        cell_store.set_row_hidden(sheet_id, row, hidden);
    }
}

fn evaluate_runtime_filter(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Vec<filters::FilterEvaluationResult> {
    let sid = *sheet_id;
    let grid_index = stores.grid_indexes.get(&sid);
    filters::evaluate_filter(
        &stores.storage,
        sheet_id,
        filter_id,
        |row, col| {
            if let Some(col_slice) = cell_store.get_column_view(&sid, col) {
                return col_slice
                    .get(row as usize)
                    .cloned()
                    .unwrap_or(CellValue::Null);
            }
            let pos = SheetPos::new(row, col);
            cell_store
                .get_cell_value_at(&sid, pos)
                .cloned()
                .unwrap_or(CellValue::Null)
        },
        |row, col| {
            let cell_id_opt = cell_store.resolve_cell_id(&sid, SheetPos::new(row, col));
            match cell_id_opt {
                Some(cid) => {
                    let table_fmt =
                        super::resolve_structured_format_at_cell(cell_store, &sid, row, col);
                    crate::storage::properties::get_effective_format_by_id(
                        &stores.storage,
                        &sid,
                        Some(&cid),
                        row,
                        col,
                        table_fmt.as_ref(),
                        grid_index,
                        cell_store.get_sheet(&sid),
                    )
                }
                None => crate::storage::properties::get_positional_format(
                    &stores.storage,
                    &sid,
                    row,
                    col,
                    grid_index,
                    cell_store.get_sheet(&sid),
                ),
            }
        },
        |hex| {
            let id = hex_to_id(hex)?;
            let cell_id = CellId::from_raw(id);
            if let Some(pos) = cell_store.resolve_position(&cell_id) {
                return Some((pos.row(), pos.col()));
            }
            None
        },
    )
}

#[cfg(test)]
#[path = "imported_filters_tests.rs"]
mod tests;
