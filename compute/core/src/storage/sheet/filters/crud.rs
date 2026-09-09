//! Typed native filter state, keyed by filter identity.
use super::{ColumnFilter, FilterKind, FilterSortState, FilterState};
use crate::storage::WorkbookStorage;
use crate::storage::infra::time::now_millis;
use cell_types::SheetId;
use value_types::ComputeError;

pub fn create_filter(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    header_start_cell_id: &str,
    header_end_cell_id: &str,
    data_end_cell_id: &str,
    filter_kind: FilterKind,
    table_id: Option<String>,
    allocator: &cell_types::IdAllocator,
) -> Result<FilterState, ComputeError> {
    let now = now_millis();
    let state = FilterState {
        id: format!("{:032x}", allocator.next_u128()),
        filter_kind,
        header_start_cell_id: header_start_cell_id.into(),
        header_end_cell_id: header_end_cell_id.into(),
        data_end_cell_id: data_end_cell_id.into(),
        column_filters: Default::default(),
        advanced_filter: None,
        sort_state: None,
        table_id,
        created_at: Some(now),
        updated_at: Some(now),
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    };
    upsert_filter_state(storage, sheet_id, &state)?;
    Ok(state)
}

pub fn upsert_filter_state(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    state: &FilterState,
) -> Result<(), ComputeError> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage, *sheet_id, filters, state.id
    );

    let metadata =
        storage
            .sheet_metadata
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    let mut state = state.clone();
    state.start_row = None;
    state.start_col = None;
    state.end_row = None;
    state.end_col = None;
    metadata.filters.insert(state.id.clone(), state);
    Ok(())
}
pub fn get_filter(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<FilterState> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .filters
        .get(filter_id)
        .cloned()
}
pub fn get_filters_in_sheet(storage: &WorkbookStorage, sheet_id: &SheetId) -> Vec<FilterState> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|m| m.filters.values().cloned().collect())
        .unwrap_or_default()
}
pub fn get_filter_count(storage: &WorkbookStorage, sheet_id: &SheetId) -> usize {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|m| m.filters.len())
        .unwrap_or(0)
}
pub fn get_table_filter(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    table_id: &str,
) -> Option<FilterState> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .filters
        .values()
        .find(|f| f.table_id.as_deref() == Some(table_id))
        .cloned()
}
pub fn get_active_filters(storage: &WorkbookStorage, sheet_id: &SheetId) -> Vec<FilterState> {
    get_filters_in_sheet(storage, sheet_id)
        .into_iter()
        .filter(|f| !f.column_filters.is_empty())
        .collect()
}
pub fn get_active_filter_count(storage: &WorkbookStorage, sheet_id: &SheetId) -> usize {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|m| m.filters.values().map(|f| f.column_filters.len()).sum())
        .unwrap_or(0)
}
fn filter_mut<'a>(
    storage: &'a mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<&'a mut FilterState> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage, *sheet_id, filters, filter_id
    );

    storage
        .sheet_metadata
        .get_mut(sheet_id)?
        .filters
        .get_mut(filter_id)
}
pub fn set_column_filter(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
    header_cell_id: &str,
    criteria: ColumnFilter,
) {
    if let Some(filter) = filter_mut(storage, sheet_id, filter_id) {
        filter
            .column_filters
            .insert(header_cell_id.into(), criteria);
        filter.updated_at = Some(now_millis());
    }
}
pub fn clear_column_filter(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
    header_cell_id: &str,
) {
    if let Some(filter) = filter_mut(storage, sheet_id, filter_id) {
        filter.column_filters.remove(header_cell_id);
        filter.updated_at = Some(now_millis());
    }
}
pub fn clear_all_column_filters(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
) {
    if let Some(filter) = filter_mut(storage, sheet_id, filter_id) {
        filter.column_filters.clear();
        if filter.filter_kind == FilterKind::AdvancedFilter {
            filter.advanced_filter = None;
        }
        filter.updated_at = Some(now_millis());
    }
}
pub fn set_filter_sort_state(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
    sort_state: Option<FilterSortState>,
) {
    if let Some(filter) = filter_mut(storage, sheet_id, filter_id) {
        filter.sort_state = sort_state;
        filter.updated_at = Some(now_millis());
    }
}
pub fn get_filter_sort_state(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<FilterSortState> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .filters
        .get(filter_id)?
        .sort_state
        .clone()
}
pub fn delete_filter(storage: &mut WorkbookStorage, sheet_id: &SheetId, filter_id: &str) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage, *sheet_id, filters, filter_id
    );

    storage
        .sheet_metadata
        .get_mut(sheet_id)
        .is_some_and(|m| m.filters.remove(filter_id).is_some())
}
pub fn clear_all_filters(storage: &mut WorkbookStorage, sheet_id: &SheetId) {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet_id) {
            for (id, _value) in &meta.filters {
                if true {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage, *sheet_id, filters, id
                    );
                }
            }
        }
    }

    if let Some(m) = storage.sheet_metadata.get_mut(sheet_id) {
        m.filters.clear();
    }
}
