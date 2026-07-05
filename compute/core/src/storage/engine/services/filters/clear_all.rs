use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, FilterChange, MutationResult};
use crate::storage::engine::services::filter_results::append_row_visibility_changes;
use crate::storage::engine::services::imported_filters;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{dimensions, filters};
use cell_types::SheetId;
use value_types::ComputeError;

pub(super) fn clear_all_column_filters(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    _settings: &EngineSettings,
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
    let filter = filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    let filter_kind = filter
        .as_ref()
        .map(|filter| super::filter_kind_wire(&filter.filter_kind).to_string());
    let metadata =
        super::filter_change_metadata_for_id(stores, sheet_id, filter_id, filter.as_ref());
    let visible_row_count = filter_data_row_count(stores, mirror, sheet_id, filter.as_ref());

    let transitions = dimensions::clear_filter_hidden_rows(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
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
        action: Some("cleared".to_string()),
        hidden_row_count: Some(0),
        visible_row_count,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

fn filter_data_row_count(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter: Option<&filters::FilterState>,
) -> Option<u32> {
    let filter = filter?;
    let header_start =
        super::resolve_filter_cell_pos(stores, mirror, sheet_id, &filter.header_start_cell_id)?;
    let data_end =
        super::resolve_filter_cell_pos(stores, mirror, sheet_id, &filter.data_end_cell_id)?;
    Some(data_end.0.saturating_sub(header_start.0))
}
