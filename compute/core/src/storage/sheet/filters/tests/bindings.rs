use std::collections::BTreeMap;

use super::super::{
    FilterButtonMetadata, FilterCapability, FilterKind, FilterMetadataBinding,
    FilterMetadataOwnerPath, FilterMetadataSourceKey, FilterShellMetadata,
    clear_filter_metadata_bindings, delete_filter_metadata_binding, get_filter_metadata_binding,
    get_filter_metadata_bindings_in_sheet, upsert_filter_metadata_binding,
};
use super::helpers::storage_with_sheet;

fn binding(filter_id: &str) -> FilterMetadataBinding {
    let mut col_id_to_header_cell_id = BTreeMap::new();
    col_id_to_header_cell_id.insert(0, "header-a".to_string());

    let mut button_metadata = BTreeMap::new();
    button_metadata.insert(
        "header-a".to_string(),
        FilterButtonMetadata {
            header_cell_id: "header-a".to_string(),
            col_id: 0,
            hidden_button: true,
            show_button: Some(false),
            button_visible: false,
        },
    );

    FilterMetadataBinding {
        filter_id: filter_id.to_string(),
        filter_kind: FilterKind::AutoFilter,
        sheet_id: "sheet-1".to_string(),
        table_id: None,
        owner_path: FilterMetadataOwnerPath::SheetAutoFilter {
            sheet_id: "sheet-1".to_string(),
        },
        source_key: FilterMetadataSourceKey::SheetAutoFilter {
            sheet_id: "sheet-1".to_string(),
            range_ref: "A1:C10".to_string(),
        },
        range_ref: "A1:C10".to_string(),
        header_start_cell_id: "header-a".to_string(),
        header_end_cell_id: "header-c".to_string(),
        data_end_cell_id: "cell-c10".to_string(),
        col_id_to_header_cell_id,
        shell: FilterShellMetadata {
            capability: FilterCapability::Supported,
            unsupported_reasons: Vec::new(),
            has_active_lossless_criteria: false,
            button_metadata,
            lossless_criteria: Vec::new(),
        },
        source_fingerprint: "filterMetadataBindingFingerprintV1:test".to_string(),
    }
}

#[test]
fn filter_metadata_binding_storage_round_trips_and_deletes_by_filter_id() {
    let (storage, sheet_id) = storage_with_sheet();
    let binding = binding("filter-1");

    upsert_filter_metadata_binding(storage.doc(), storage.sheets(), &sheet_id, &binding);

    let stored =
        get_filter_metadata_binding(storage.doc(), storage.sheets(), &sheet_id, "filter-1")
            .expect("binding should round-trip");
    assert_eq!(stored, binding);
    assert_eq!(
        get_filter_metadata_bindings_in_sheet(storage.doc(), storage.sheets(), &sheet_id).len(),
        1
    );

    assert!(delete_filter_metadata_binding(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "filter-1"
    ));
    assert!(
        get_filter_metadata_binding(storage.doc(), storage.sheets(), &sheet_id, "filter-1")
            .is_none()
    );
}

#[test]
fn clear_filter_metadata_bindings_only_removes_binding_entries() {
    let (storage, sheet_id) = storage_with_sheet();

    upsert_filter_metadata_binding(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &binding("filter-1"),
    );
    upsert_filter_metadata_binding(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &binding("filter-2"),
    );

    clear_filter_metadata_bindings(storage.doc(), storage.sheets(), &sheet_id);

    assert!(
        get_filter_metadata_bindings_in_sheet(storage.doc(), storage.sheets(), &sheet_id)
            .is_empty()
    );
}
