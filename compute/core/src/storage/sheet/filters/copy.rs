//! Retarget filter ownership and stable cell references when copying a sheet.
use super::{FilterMetadataOwnerPath, FilterMetadataSourceKey};
use crate::storage::sheet::SheetMetadata;
use cell_types::{IdAllocator, SheetId};
use std::collections::HashMap;

pub(crate) fn remap_for_copy(
    metadata: &mut SheetMetadata,
    source: SheetId,
    target: SheetId,
    cells: &HashMap<String, String>,
    allocator: &IdAllocator,
) {
    let source_text = source.to_uuid_string();
    let target_text = target.to_uuid_string();
    let mut filter_ids = HashMap::new();
    metadata.filters = std::mem::take(&mut metadata.filters)
        .into_values()
        .filter_map(|mut filter| {
            filter.header_start_cell_id = cells.get(&filter.header_start_cell_id)?.clone();
            filter.header_end_cell_id = cells.get(&filter.header_end_cell_id)?.clone();
            filter.data_end_cell_id = cells.get(&filter.data_end_cell_id)?.clone();
            filter.column_filters = filter
                .column_filters
                .into_iter()
                .filter_map(|(id, value)| cells.get(&id).cloned().map(|id| (id, value)))
                .collect();
            filter.sort_state = filter.sort_state.and_then(|mut state| {
                state.column_cell_id = cells.get(&state.column_cell_id)?.clone();
                Some(state)
            });
            if let Some(criteria) = filter
                .advanced_filter
                .as_mut()
                .and_then(|advanced| advanced.criteria_range.as_mut())
                && criteria.sheet_id == source_text
            {
                criteria.sheet_id = target_text.clone();
                criteria.start_cell_id = cells.get(&criteria.start_cell_id)?.clone();
                criteria.end_cell_id = cells.get(&criteria.end_cell_id)?.clone();
            }
            let id = format!("{:032x}", allocator.next_u128());
            filter_ids.insert(filter.id, id.clone());
            filter.id = id.clone();
            Some((id, filter))
        })
        .collect();
    metadata.filter_bindings = std::mem::take(&mut metadata.filter_bindings)
        .into_values()
        .filter_map(|mut binding| {
            binding.filter_id = filter_ids.get(&binding.filter_id)?.clone();
            binding.sheet_id = target_text.clone();
            binding.header_start_cell_id = cells.get(&binding.header_start_cell_id)?.clone();
            binding.header_end_cell_id = cells.get(&binding.header_end_cell_id)?.clone();
            binding.data_end_cell_id = cells.get(&binding.data_end_cell_id)?.clone();
            binding.col_id_to_header_cell_id = binding
                .col_id_to_header_cell_id
                .into_iter()
                .filter_map(|(col, id)| cells.get(&id).cloned().map(|id| (col, id)))
                .collect();
            binding.table_column_id_to_header_cell_id = binding
                .table_column_id_to_header_cell_id
                .into_iter()
                .filter_map(|(col, id)| cells.get(&id).cloned().map(|id| (col, id)))
                .collect();
            match &mut binding.owner_path {
                FilterMetadataOwnerPath::SheetAutoFilter { sheet_id }
                | FilterMetadataOwnerPath::TableAutoFilter { sheet_id, .. } => {
                    *sheet_id = target_text.clone()
                }
            }
            match &mut binding.source_key {
                FilterMetadataSourceKey::SheetAutoFilter { sheet_id, .. }
                | FilterMetadataSourceKey::TableAutoFilter { sheet_id, .. } => {
                    *sheet_id = target_text.clone()
                }
            }
            Some((binding.filter_id.clone(), binding))
        })
        .collect();
    metadata.dimensions.filter_hidden_rows =
        std::mem::take(&mut metadata.dimensions.filter_hidden_rows)
            .into_iter()
            .filter_map(|(id, rows)| filter_ids.get(&id).cloned().map(|id| (id, rows)))
            .collect();
}
