//! Slicer mutation-result contract tests.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{SlicerChangeKind, SlicerSourceType};
use domain_types::domain::slicer::{
    CrossFilterMode, SlicerSelectionChangeType, SlicerSortOrder, SlicerSource, SlicerStyle,
    StoredSlicer, StoredSlicerUpdate,
};
use value_types::CellValue;

fn table_slicer(id: &str) -> StoredSlicer {
    StoredSlicer {
        id: id.to_string(),
        sheet_id: sheet_id().to_uuid_string(),
        source: SlicerSource::Table {
            table_id: "table-1".to_string(),
            column_cell_id: "region".to_string(),
        },
        cache_name: None,
        cache_uid: None,
        caption: "Region".to_string(),
        name: Some("Region Slicer".to_string()),
        style: SlicerStyle {
            preset: None,
            custom: None,
            column_count: 1,
            button_height: 30,
            show_selection_indicator: true,
            cross_filter: CrossFilterMode::ShowItemsWithDataAtTop,
            custom_list_sort: true,
            show_items_with_no_data: true,
            sort_order: SlicerSortOrder::Ascending,
        },
        table_column_index: None,
        pivot_cache_id: None,
        pivot_table_tab_id: None,
        pivot_tabular_items: vec![],
        row_height: None,
        level: 0,
        uid: None,
        ext_lst_xml: None,
        cache_ext_lst_xml: None,
        position: None,
        anchor_object_id: None,
        anchor_macro_name: None,
        anchor_nv_ext_lst_xml: None,
        z_index: 0,
        locked: false,
        show_header: true,
        start_item: None,
        multi_select: true,
        selected_values: Vec::new(),
        created_at: None,
        updated_at: None,
    }
}

#[test]
fn slicer_crud_and_selection_emit_mutation_result_changes() {
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    let (_patches, create_result) = engine
        .create_slicer(&sid, table_slicer("slicer-1"))
        .expect("create slicer");
    assert_eq!(create_result.slicer_changes.len(), 1);
    let create_change = &create_result.slicer_changes[0];
    assert_eq!(create_change.kind, SlicerChangeKind::Created);
    assert_eq!(create_change.source_type, Some(SlicerSourceType::Table));
    assert_eq!(create_change.source_id.as_deref(), Some("table-1"));
    assert_eq!(
        create_change.data.as_ref().map(|s| s.id.as_str()),
        Some("slicer-1")
    );

    let (_patches, update_result) = engine
        .update_slicer_config(
            &sid,
            "slicer-1",
            StoredSlicerUpdate {
                caption: Some("Region Updated".to_string()),
                name: None,
                style: None,
                position: None,
                z_index: Some(4),
                locked: None,
                show_header: None,
                start_item: None,
                multi_select: None,
                selected_values: None,
            },
        )
        .expect("update slicer");
    assert_eq!(update_result.slicer_changes.len(), 1);
    let update_change = &update_result.slicer_changes[0];
    assert_eq!(update_change.kind, SlicerChangeKind::Updated);
    assert_eq!(update_change.updated_fields, vec!["caption", "zIndex"]);

    let (_patches, toggle_result) = engine
        .toggle_slicer_item(&sid, "slicer-1", CellValue::Text("West".into()))
        .expect("toggle slicer");
    let toggle_change = &toggle_result.slicer_changes[0];
    assert_eq!(toggle_change.kind, SlicerChangeKind::SelectionChanged);
    assert_eq!(
        toggle_change.selection_change_type,
        Some(SlicerSelectionChangeType::Toggle)
    );
    assert_eq!(
        toggle_change.selected_values,
        Some(vec![CellValue::Text("West".into())])
    );

    let (_patches, clear_result) = engine
        .clear_slicer_selection(&sid, "slicer-1")
        .expect("clear slicer selection");
    let clear_change = &clear_result.slicer_changes[0];
    assert_eq!(clear_change.kind, SlicerChangeKind::SelectionChanged);
    assert_eq!(
        clear_change.selection_change_type,
        Some(SlicerSelectionChangeType::Clear)
    );
    assert_eq!(clear_change.selected_values, Some(Vec::new()));

    let (_patches, delete_result) = engine
        .delete_slicer(&sid, "slicer-1")
        .expect("delete slicer");
    let delete_change = &delete_result.slicer_changes[0];
    assert_eq!(delete_change.kind, SlicerChangeKind::Deleted);
    assert_eq!(delete_change.source_type, Some(SlicerSourceType::Table));
    assert_eq!(delete_change.source_id.as_deref(), Some("table-1"));
    assert_eq!(
        delete_change.data.as_ref().map(|s| s.id.as_str()),
        Some("slicer-1")
    );
}
