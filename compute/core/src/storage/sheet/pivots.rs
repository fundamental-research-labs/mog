//! Native worksheet pivot configuration storage.
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::pivot::{PivotFieldArea, PivotTableConfig, PlacementId};
use std::collections::HashSet;
use value_types::ComputeError;

fn now_millis() -> f64 {
    crate::storage::infra::time::now_millis() as f64
}

fn generate_pivot_id(id_alloc: &cell_types::IdAllocator) -> String {
    format!(
        "pivot-{}-{:032x}",
        now_millis() as i64,
        id_alloc.next_u128()
    )
}

pub fn create_pivot(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    mut config: PivotTableConfig,
    id_alloc: &cell_types::IdAllocator,
) -> Result<PivotTableConfig, ComputeError> {
    config.id = generate_pivot_id(id_alloc);
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage, *sheet_id, pivots, config.id
    );
    let sheet =
        storage
            .sheet_metadata
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    config.output_sheet_id = Some(sheet_id.to_uuid_string());
    let now = now_millis();
    config.created_at = Some(now);
    config.updated_at = Some(now);
    sheet.pivots.insert(config.id.clone(), config.clone());
    Ok(config)
}

pub fn get_pivot(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    pivot_id: &str,
) -> Option<PivotTableConfig> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .pivots
        .get(pivot_id)
        .cloned()
}

pub fn get_all_pivots(storage: &WorkbookStorage, sheet_id: &SheetId) -> Vec<PivotTableConfig> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|sheet| sheet.pivots.values().cloned().collect())
        .unwrap_or_default()
}

pub fn update_pivot(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    pivot_id: &str,
    mut config: PivotTableConfig,
) -> Option<PivotTableConfig> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage, *sheet_id, pivots, pivot_id
    );
    let entry = storage
        .sheet_metadata
        .get_mut(sheet_id)?
        .pivots
        .get_mut(pivot_id)?;
    config.id = pivot_id.to_owned();
    config.output_sheet_id = Some(sheet_id.to_uuid_string());
    config.updated_at = Some(now_millis());
    *entry = config.clone();
    Some(config)
}

pub(crate) fn insert_existing_pivot_if_absent(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    mut config: PivotTableConfig,
) -> Result<bool, ComputeError> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage, *sheet_id, pivots, config.id
    );
    let sheet =
        storage
            .sheet_metadata
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    let std::collections::btree_map::Entry::Vacant(entry) = sheet.pivots.entry(config.id.clone())
    else {
        return Ok(false);
    };
    config.output_sheet_id = Some(sheet_id.to_uuid_string());
    entry.insert(config);
    Ok(true)
}

pub fn delete_pivot(storage: &mut WorkbookStorage, sheet_id: &SheetId, pivot_id: &str) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage, *sheet_id, pivots, pivot_id
    );
    storage
        .sheet_metadata
        .get_mut(sheet_id)
        .is_some_and(|sheet| sheet.pivots.remove(pivot_id).is_some())
}

fn pivot_area_key(area: PivotFieldArea) -> &'static str {
    match area {
        PivotFieldArea::Row => "row",
        PivotFieldArea::Column => "column",
        PivotFieldArea::Value => "value",
        PivotFieldArea::Filter => "filter",
        _ => "unknown",
    }
}

fn remap_copied_pivot_placement_ids(pivot: &mut PivotTableConfig) {
    let mut used = HashSet::new();
    for (index, placement) in pivot.placements.iter_mut().enumerate() {
        let base = format!(
            "{}:{}:{}:{}",
            pivot.id,
            pivot_area_key(placement.area),
            placement.field_id.as_str(),
            placement.position
        );
        let mut candidate = base.clone();
        let mut suffix = index + 1;
        while !used.insert(candidate.clone()) {
            candidate = format!("{}:{}", base, suffix);
            suffix += 1;
        }
        placement.placement_id = PlacementId::from(candidate);
    }
}

pub(crate) fn remap_pivots_for_sheet_copy(
    source_pivots: Vec<PivotTableConfig>,
    source_sheet_id: &SheetId,
    new_sheet_id: &SheetId,
    new_sheet_name: &str,
    id_alloc: &cell_types::IdAllocator,
) -> Vec<PivotTableConfig> {
    let new_sheet_uuid = new_sheet_id.to_uuid_string();

    source_pivots
        .into_iter()
        .map(|mut pivot| {
            pivot.id = format!("pivot-copy-{:032x}", id_alloc.next_u128());
            pivot.name = format!("{} (Copy)", pivot.name);
            pivot.output_sheet_id = Some(new_sheet_uuid.clone());
            pivot.output_sheet_name = new_sheet_name.to_string();
            if pivot
                .source_sheet_id
                .as_deref()
                .and_then(|id| SheetId::from_uuid_str(id).ok())
                .as_ref()
                == Some(source_sheet_id)
            {
                pivot.source_sheet_id = Some(new_sheet_uuid.clone());
                pivot.source_sheet_name = new_sheet_name.to_string();
            }
            remap_copied_pivot_placement_ids(&mut pivot);
            pivot
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::super::test_support::setup;
    use super::*;
    use domain_types::domain::pivot::{CellRange, OutputLocation, PivotTableConfig};

    fn minimal_config(name: &str, output_col: u32) -> PivotTableConfig {
        PivotTableConfig {
            id: "caller-provided-id-must-be-replaced".to_string(),
            name: name.to_string(),
            source_sheet_id: Some("00000000000000000000000000000001".to_string()),
            source_sheet_name: "Sheet1".to_string(),
            source_range: CellRange::new(0, 0, 2, 1),
            output_sheet_id: None,
            output_sheet_name: "Sheet1".to_string(),
            output_location: OutputLocation {
                row: 0,
                col: output_col,
            },
            fields: Vec::new(),
            placements: Vec::new(),
            filters: Vec::new(),
            layout: None,
            style: None,
            data_options: None,
            created_at: None,
            updated_at: None,
            calculated_fields: None,
            allow_multiple_filters_per_field: None,
            auto_format: None,
            preserve_formatting: None,
            cache_id: None,
            data_on_rows: None,
            ref_range: None,
            first_data_row: None,
            first_header_row: None,
            first_data_col: None,
            rows_per_page: None,
            cols_per_page: None,
            row_items: Vec::new(),
            col_items: Vec::new(),
            schema_version: 0,
        }
    }

    #[test]
    fn create_multiple_pivots_does_not_overwrite_same_millisecond_ids() {
        let (mut storage, _mirror, sheet_id) = setup();
        let id_alloc = crate::storage::new_runtime_metadata_id_allocator();

        let p1 = create_pivot(
            &mut storage,
            &sheet_id,
            minimal_config("Pivot1", 4),
            &id_alloc,
        )
        .expect("create Pivot1");
        let p2 = create_pivot(
            &mut storage,
            &sheet_id,
            minimal_config("Pivot2", 8),
            &id_alloc,
        )
        .expect("create Pivot2");
        let p3 = create_pivot(
            &mut storage,
            &sheet_id,
            minimal_config("Pivot3", 12),
            &id_alloc,
        )
        .expect("create Pivot3");

        let ids: HashSet<&str> = [p1.id.as_str(), p2.id.as_str(), p3.id.as_str()]
            .into_iter()
            .collect();
        assert_eq!(ids.len(), 3, "Rust-owned pivot IDs must be unique");

        let pivots = get_all_pivots(&storage, &sheet_id);
        let names: HashSet<&str> = pivots.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(pivots.len(), 3);
        assert!(names.contains("Pivot1"));
        assert!(names.contains("Pivot2"));
        assert!(names.contains("Pivot3"));
    }

    #[test]
    fn generated_pivot_id_uses_full_client_partitioned_allocator_value() {
        let id_alloc = cell_types::IdAllocator::with_client_partition(7);

        let first = generate_pivot_id(&id_alloc);
        let second = generate_pivot_id(&id_alloc);

        assert_ne!(first, second);
        assert!(
            first.ends_with("00000000000000070000000000000001"),
            "first pivot id should contain the full 128-bit allocator value: {first}"
        );
        assert!(
            second.ends_with("00000000000000070000000000000002"),
            "second pivot id should contain the full 128-bit allocator value: {second}"
        );
    }

    #[test]
    fn source_sheet_id_round_trips_through_structured_storage() {
        let (mut storage, _mirror, sheet_id) = setup();
        let id_alloc = crate::storage::new_runtime_metadata_id_allocator();

        let created = create_pivot(
            &mut storage,
            &sheet_id,
            minimal_config("SourceIdentity", 4),
            &id_alloc,
        )
        .expect("create pivot with source sheet ID");

        let loaded = get_pivot(&storage, &sheet_id, &created.id).expect("stored pivot should load");
        assert_eq!(
            loaded.source_sheet_id.as_deref(),
            Some("00000000000000000000000000000001")
        );
        assert_eq!(loaded.source_sheet_name, "Sheet1");
    }

    #[test]
    fn ooxml_pivot_fields_round_trip_through_structured_storage() {
        let (mut storage, _mirror, sheet_id) = setup();
        let id_alloc = crate::storage::new_runtime_metadata_id_allocator();
        let mut config = minimal_config("OoxmlPivot", 4);
        config.cache_id = Some(42);
        config.ref_range = Some("B2:D9".to_string());
        config.first_header_row = Some(1);
        config.first_data_row = Some(2);
        config.first_data_col = Some(3);
        config.rows_per_page = Some(4);
        config.cols_per_page = Some(5);
        config.row_items = vec![domain_types::PivotRowColItem {
            item_type: Some(domain_types::PivotItemType::Grand),
            x_values: vec![None, Some(2)],
        }];

        let created = create_pivot(&mut storage, &sheet_id, config, &id_alloc)
            .expect("create pivot with OOXML fields");

        let loaded = get_pivot(&storage, &sheet_id, &created.id).expect("stored pivot should load");
        assert_eq!(loaded.cache_id, Some(42));
        assert_eq!(loaded.ref_range.as_deref(), Some("B2:D9"));
        assert_eq!(loaded.first_header_row, Some(1));
        assert_eq!(loaded.first_data_row, Some(2));
        assert_eq!(loaded.first_data_col, Some(3));
        assert_eq!(loaded.rows_per_page, Some(4));
        assert_eq!(loaded.cols_per_page, Some(5));
        assert_eq!(loaded.row_items, created.row_items);
    }
}
