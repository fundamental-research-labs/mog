//! Slicer Storage Support — Types and helpers for slicer CRUD in the storage layer.
//!
//! Ported from `spreadsheet-model/src/slicers/` (types, crud, cache, selection,
//! table-binding, timeline sub-modules).
//!
//! The pure computation for slicers already lives in `table/slicer.rs` and
//! `table/slicer_cache.rs`. This module provides:
//!
//! 1. **Slicer event types** for cache invalidation and disconnection
//! 2. **Reason mapping** between internal and contract event reason codes
//! 3. **Slicer connection checking** helpers
//! 4. **Slicer item state** types for UI rendering
//!
//! Workbook metadata owns the native slicer and timeline collections.

pub use domain_types::domain::slicer::{
    CacheInvalidationEventReason, CrossFilterMode, DisconnectionEventReason, NamedSlicerStyle,
    PivotFieldArea, SlicerCustomStyle, SlicerDisconnectionReason, SlicerInvalidationReason,
    SlicerItem, SlicerItemState, SlicerSelectionChangeType, SlicerSortOrder, SlicerSource,
    SlicerStyle, SlicerStylePreset, StoredSlicer, StoredSlicerUpdate,
};
#[cfg(test)]
use value_types::CellValue;

/// Map internal invalidation reason to contract event reason code.
pub fn map_invalidation_reason(reason: SlicerInvalidationReason) -> CacheInvalidationEventReason {
    match reason {
        SlicerInvalidationReason::DataChanged => CacheInvalidationEventReason::CellsChanged,
        SlicerInvalidationReason::FilterChanged => CacheInvalidationEventReason::FilterApplied,
        SlicerInvalidationReason::StructureChanged => {
            CacheInvalidationEventReason::TableStructureChanged
        }
    }
}

/// Map internal disconnection reason to contract event reason code.
pub fn map_disconnection_reason(reason: SlicerDisconnectionReason) -> DisconnectionEventReason {
    match reason {
        SlicerDisconnectionReason::ColumnDeleted => DisconnectionEventReason::ColumnDeleted,
        SlicerDisconnectionReason::TableDeleted => DisconnectionEventReason::TableDeleted,
        SlicerDisconnectionReason::PivotDeleted => DisconnectionEventReason::PivotDeleted,
    }
}

/// Convert a `SlicerCacheItem` to a `SlicerItem` for UI display.
pub fn cache_item_to_slicer_item(item: &crate::table::types::SlicerCacheItem) -> SlicerItem {
    let state = if item.selected {
        SlicerItemState::Selected
    } else if !item.has_data {
        SlicerItemState::Unavailable
    } else {
        SlicerItemState::Available
    };

    SlicerItem {
        value: item.value.clone(),
        display_text: item.display_text.clone(),
        state,
        count: Some(item.count),
    }
}

/// Convert all cache items to slicer items.
pub fn cache_to_slicer_items(cache: &crate::table::types::SlicerCache) -> Vec<SlicerItem> {
    cache.items.iter().map(cache_item_to_slicer_item).collect()
}

// ============================================================================
// Slicer Connection Helpers
// ============================================================================

/// Check if a slicer's source column exists in the table's columns.
///
/// This is a pure check: given a slicer's `source_column_id` and a table's
/// column list, determine if the slicer is connected.
pub fn is_slicer_column_connected(
    source_column_id: &str,
    table_columns: &[crate::table::types::TableColumn],
) -> bool {
    table_columns.iter().any(|c| c.id == source_column_id)
}

/// Find all slicers connected to a specific table.
///
/// Returns indices of slicers in the input slice whose `source_id` matches.
pub fn find_slicers_for_table(
    slicers: &[crate::table::types::Slicer],
    table_id: &str,
) -> Vec<usize> {
    slicers
        .iter()
        .enumerate()
        .filter(|(_, s)| {
            s.source_type == crate::table::types::SlicerSourceType::Table && s.source_id == table_id
        })
        .map(|(i, _)| i)
        .collect()
}

/// Check if any slicer references a deleted table.
///
/// Returns the indices of slicers that reference a table not in `existing_table_ids`.
pub fn find_disconnected_slicers(
    slicers: &[crate::table::types::Slicer],
    existing_table_ids: &[&str],
) -> Vec<usize> {
    slicers
        .iter()
        .enumerate()
        .filter(|(_, s)| {
            s.source_type == crate::table::types::SlicerSourceType::Table
                && !existing_table_ids.contains(&s.source_id.as_str())
        })
        .map(|(i, _)| i)
        .collect()
}

/// Copy workbook-owned objects after native pivot identities have been allocated.
pub(crate) fn copy_sheet_objects(
    storage: &mut crate::storage::WorkbookStorage,
    source: &cell_types::SheetId,
    target: &cell_types::SheetId,
    pivot_copies: &std::collections::HashMap<String, domain_types::domain::pivot::PivotTableConfig>,
    allocator: &cell_types::IdAllocator,
) {
    fn copied_name(name: &str, identity: u128) -> String {
        format!(
            "{}_{identity:032x}",
            name.chars().take(220).collect::<String>()
        )
    }
    let mut slicer_cache_names = std::collections::HashMap::new();
    let mut timeline_cache_names = std::collections::HashMap::new();
    let copies: Vec<_> = storage
        .metadata
        .slicers
        .values()
        .filter(|slicer| {
            cell_types::SheetId::from_uuid_str(&slicer.sheet_id)
                .ok()
                .as_ref()
                == Some(source)
        })
        .cloned()
        .collect();
    for mut slicer in copies {
        let new_identity = allocator.next_u128();
        let cache_key = slicer
            .cache_name
            .clone()
            .unwrap_or_else(|| slicer.id.clone());
        slicer.id = uuid::Uuid::from_u128(new_identity).to_string();
        slicer.sheet_id = target.to_uuid_string();
        slicer.name = Some(copied_name(
            slicer.name.as_deref().unwrap_or(&slicer.caption),
            new_identity,
        ));
        slicer.cache_name = Some(
            slicer_cache_names
                .entry(cache_key.clone())
                .or_insert_with(|| copied_name(&cache_key, allocator.next_u128()))
                .clone(),
        );
        slicer.uid = None;
        slicer.cache_uid = None;
        slicer.anchor_object_id = None;
        if let SlicerSource::Pivot { pivot_id, .. } = &mut slicer.source {
            if let Some(copy) = pivot_copies.get(pivot_id) {
                *pivot_id = copy.id.clone();
                slicer.pivot_cache_id = copy.cache_id;
                slicer.pivot_table_tab_id = None;
            }
        }
        crate::storage::engine::history::metadata::capture_workbook_entry!(
            storage, slicers, slicer.id
        );
        storage.metadata.slicers.insert(slicer.id.clone(), slicer);
    }
    let copies: Vec<_> = storage
        .metadata
        .timelines
        .values()
        .filter(|timeline| {
            cell_types::SheetId::from_uuid_str(&timeline.sheet_id)
                .ok()
                .as_ref()
                == Some(source)
        })
        .cloned()
        .collect();
    for mut timeline in copies {
        let new_identity = allocator.next_u128();
        timeline.id = uuid::Uuid::from_u128(new_identity).to_string();
        timeline.sheet_id = target.to_uuid_string();
        timeline.name = copied_name(&timeline.name, new_identity);
        timeline.cache_name = timeline_cache_names
            .entry(timeline.cache_name.clone())
            .or_insert_with(|| copied_name(&timeline.cache_name, allocator.next_u128()))
            .clone();
        timeline.uid = None;
        timeline.anchor_object_id = None;
        if let Some(cache) = timeline.cache.as_mut() {
            cache.name = timeline.cache_name.clone();
            cache.uid = None;
            let copied_cache_id = cache
                .pivot_tables
                .iter()
                .filter_map(|pivot| pivot_copies.get(&pivot.name))
                .find_map(|pivot| pivot.cache_id)
                .or(cache.pivot_cache_id);
            let forked_cache = copied_cache_id != cache.pivot_cache_id;
            cache.pivot_tables.retain_mut(|pivot| {
                if let Some(copy) = pivot_copies.get(&pivot.name) {
                    pivot.name.clone_from(&copy.name);
                    // Export resolves the copied sheet's generated OOXML ID.
                    pivot.tab_id = 0;
                    true
                } else {
                    // External connections remain valid while the copied pivot
                    // continues to use their shared source cache.
                    !forked_cache
                }
            });
            cache.pivot_cache_id = copied_cache_id;
        }
        crate::storage::engine::history::metadata::capture_workbook_entry!(
            storage,
            timelines,
            timeline.id
        );
        storage
            .metadata
            .timelines
            .insert(timeline.id.clone(), timeline);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::types::{
        Slicer, SlicerCache, SlicerCacheItem, SlicerSortOrder, SlicerSourceType, TableColumn,
    };

    fn cv_str(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn make_slicer(id: &str, table_id: &str, col_id: &str) -> Slicer {
        Slicer {
            id: id.to_string(),
            name: "Test".to_string(),
            source_type: SlicerSourceType::Table,
            source_id: table_id.to_string(),
            source_column_id: col_id.to_string(),
            selected_values: Vec::new(),
            multi_select: true,
            show_items_with_no_data: false,
            sort_order: SlicerSortOrder::Ascending,
        }
    }

    fn make_col(id: &str, name: &str) -> TableColumn {
        TableColumn {
            id: id.to_string(),
            name: name.to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
            ..Default::default()
        }
    }

    // ---- Reason mapping ----

    #[test]
    fn invalidation_reason_mapping() {
        assert_eq!(
            map_invalidation_reason(SlicerInvalidationReason::DataChanged),
            CacheInvalidationEventReason::CellsChanged
        );
        assert_eq!(
            map_invalidation_reason(SlicerInvalidationReason::FilterChanged),
            CacheInvalidationEventReason::FilterApplied
        );
        assert_eq!(
            map_invalidation_reason(SlicerInvalidationReason::StructureChanged),
            CacheInvalidationEventReason::TableStructureChanged
        );
    }

    #[test]
    fn disconnection_reason_mapping() {
        assert_eq!(
            map_disconnection_reason(SlicerDisconnectionReason::ColumnDeleted),
            DisconnectionEventReason::ColumnDeleted
        );
        assert_eq!(
            map_disconnection_reason(SlicerDisconnectionReason::TableDeleted),
            DisconnectionEventReason::TableDeleted
        );
        assert_eq!(
            map_disconnection_reason(SlicerDisconnectionReason::PivotDeleted),
            DisconnectionEventReason::PivotDeleted
        );
    }

    // ---- Cache item to slicer item ----

    #[test]
    fn cache_item_selected() {
        let item = SlicerCacheItem {
            value: cv_str("East"),
            display_text: "East".to_string(),
            count: 5,
            selected: true,
            has_data: true,
        };
        let result = cache_item_to_slicer_item(&item);
        assert_eq!(result.state, SlicerItemState::Selected);
        assert_eq!(result.count, Some(5));
    }

    #[test]
    fn cache_item_available() {
        let item = SlicerCacheItem {
            value: cv_str("West"),
            display_text: "West".to_string(),
            count: 3,
            selected: false,
            has_data: true,
        };
        let result = cache_item_to_slicer_item(&item);
        assert_eq!(result.state, SlicerItemState::Available);
    }

    #[test]
    fn cache_item_unavailable() {
        let item = SlicerCacheItem {
            value: cv_str("North"),
            display_text: "North".to_string(),
            count: 0,
            selected: false,
            has_data: false,
        };
        let result = cache_item_to_slicer_item(&item);
        assert_eq!(result.state, SlicerItemState::Unavailable);
    }

    #[test]
    fn cache_to_items() {
        let cache = SlicerCache {
            items: vec![
                SlicerCacheItem {
                    value: cv_str("A"),
                    display_text: "A".to_string(),
                    count: 1,
                    selected: true,
                    has_data: true,
                },
                SlicerCacheItem {
                    value: cv_str("B"),
                    display_text: "B".to_string(),
                    count: 2,
                    selected: false,
                    has_data: true,
                },
            ],
            total_count: 2,
            selected_count: 1,
        };
        let items = cache_to_slicer_items(&cache);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].state, SlicerItemState::Selected);
        assert_eq!(items[1].state, SlicerItemState::Available);
    }

    // ---- Connection helpers ----

    #[test]
    fn column_connected() {
        let cols = vec![make_col("col1", "A"), make_col("col2", "B")];
        assert!(is_slicer_column_connected("col1", &cols));
        assert!(!is_slicer_column_connected("col3", &cols));
    }

    #[test]
    fn find_slicers_for_table_basic() {
        let slicers = vec![
            make_slicer("s1", "table1", "col1"),
            make_slicer("s2", "table2", "col1"),
            make_slicer("s3", "table1", "col2"),
        ];
        let indices = find_slicers_for_table(&slicers, "table1");
        assert_eq!(indices, vec![0, 2]);
    }

    #[test]
    fn find_slicers_for_table_none() {
        let slicers = vec![make_slicer("s1", "table1", "col1")];
        let indices = find_slicers_for_table(&slicers, "table2");
        assert!(indices.is_empty());
    }

    #[test]
    fn find_disconnected_basic() {
        let slicers = vec![
            make_slicer("s1", "table1", "col1"),
            make_slicer("s2", "table2", "col1"),
            make_slicer("s3", "table3", "col1"),
        ];
        let disconnected = find_disconnected_slicers(&slicers, &["table1", "table3"]);
        assert_eq!(disconnected, vec![1]); // table2 not in existing
    }

    #[test]
    fn find_disconnected_none() {
        let slicers = vec![make_slicer("s1", "table1", "col1")];
        let disconnected = find_disconnected_slicers(&slicers, &["table1"]);
        assert!(disconnected.is_empty());
    }

    // ---- Serde ----

    #[test]
    fn slicer_item_round_trip() {
        let item = SlicerItem {
            value: cv_str("Test"),
            display_text: "Test".to_string(),
            state: SlicerItemState::Selected,
            count: Some(10),
        };
        let json = serde_json::to_string(&item).unwrap();
        let back: SlicerItem = serde_json::from_str(&json).unwrap();
        assert_eq!(item, back);
    }

    #[test]
    fn slicer_item_state_serde() {
        let json = serde_json::to_string(&SlicerItemState::Unavailable).unwrap();
        assert_eq!(json, "\"unavailable\"");
    }
}
