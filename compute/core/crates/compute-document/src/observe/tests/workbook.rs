use super::super::CellChangeKind;
use super::fixtures::{make_sheet_id, new_observer, setup_doc};
use crate::schema::{KEY_NAMED_RANGES, KEY_SLICERS, KEY_TABLES};
use domain_types::domain::slicer::{
    CrossFilterMode, SlicerSortOrder, SlicerSource, SlicerStyle, StoredSlicer,
};
use std::sync::Arc;
use yrs::{Any, Map, MapPrelim, MapRef, Out, Transact};

fn table_slicer(id: &str, sheet_id: &str) -> StoredSlicer {
    StoredSlicer {
        id: id.to_string(),
        sheet_id: sheet_id.to_string(),
        source: SlicerSource::Table {
            table_id: "table-1".to_string(),
            column_cell_id: "region".to_string(),
        },
        cache_name: None,
        cache_uid: None,
        caption: "Region".to_string(),
        name: None,
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
fn test_workbook_table_change() {
    let (doc, sheets, workbook) = setup_doc();

    // Create tables sub-map in workbook
    {
        let mut txn = doc.transact_mut();
        let _: MapRef = workbook.insert(
            &mut txn,
            KEY_TABLES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    let observer = new_observer(&sheets, &workbook);

    // Insert a table entry
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(tables_map)) = workbook.get(&txn, KEY_TABLES) {
            let table_entry: MapRef = tables_map.insert(
                &mut txn,
                "table-001",
                MapPrelim::from([] as [(&str, Any); 0]),
            );
            table_entry.insert(&mut txn, "name", Any::String(Arc::from("SalesData")));
        }
    }

    let changes = observer.drain_all_changes();
    assert!(
        !changes.tables.is_empty(),
        "expected table change, got empty"
    );
    assert!(changes.tables.iter().any(|t| t.key == "table-001"));
}

#[test]
fn test_workbook_slicer_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(3);

    {
        let mut txn = doc.transact_mut();
        let _: MapRef = workbook.insert(
            &mut txn,
            KEY_SLICERS,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    let observer = new_observer(&sheets, &workbook);

    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(slicers)) = workbook.get(&txn, KEY_SLICERS) {
            let slicer = table_slicer("slicer-1", &sheet_id.to_uuid_string());
            let entries = domain_types::yrs_schema::slicer::to_yrs_prelim(&slicer);
            let nested: MapPrelim = entries.into_iter().collect();
            slicers.insert(&mut txn, "slicer-1", nested);
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.slicers.len(), 1);
    assert_eq!(changes.slicers[0].slicer_id, "slicer-1");
    assert_eq!(changes.slicers[0].sheet_id, Some(sheet_id));
    assert_eq!(changes.slicers[0].kind, CellChangeKind::Modified);
    assert_eq!(
        changes.slicers[0]
            .data
            .as_ref()
            .map(|slicer| slicer.id.as_str()),
        Some("slicer-1")
    );
}

#[test]
fn test_workbook_named_range_change() {
    let (doc, sheets, workbook) = setup_doc();

    // Create namedRanges sub-map in workbook
    {
        let mut txn = doc.transact_mut();
        let _: MapRef = workbook.insert(
            &mut txn,
            KEY_NAMED_RANGES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    let observer = new_observer(&sheets, &workbook);

    // Insert a named range
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(nr_map)) = workbook.get(&txn, KEY_NAMED_RANGES) {
            nr_map.insert(&mut txn, "MyRange", Any::String(Arc::from("Sheet1!A1:B10")));
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.named_ranges.len(), 1);
    assert_eq!(changes.named_ranges[0].key, Some("MyRange".to_string()));
}

#[test]
fn test_workbook_table_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();

    // Insert a table entry at depth 1
    {
        let mut txn = doc.transact_mut();
        let tables: MapRef = workbook.insert(
            &mut txn,
            KEY_TABLES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
        let entry: MapRef =
            tables.insert(&mut txn, "table-1", MapPrelim::from([] as [(&str, Any); 0]));
        entry.insert(&mut txn, "range", Any::String(Arc::from("A1:D10")));
    }

    let observer = new_observer(&sheets, &workbook);

    // Modify table field in place (depth 2 in workbook = path.len() == 2)
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(tables)) = workbook.get(&txn, KEY_TABLES) {
            if let Some(Out::YMap(entry)) = tables.get(&txn, "table-1") {
                entry.insert(&mut txn, "range", Any::String(Arc::from("A1:E20")));
            }
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.tables.len(), 1);
    assert_eq!(changes.tables[0].key, "table-1");
    assert_eq!(changes.tables[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_workbook_named_range_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();

    // Insert a named range entry
    {
        let mut txn = doc.transact_mut();
        let named: MapRef = workbook.insert(
            &mut txn,
            KEY_NAMED_RANGES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
        let entry: MapRef =
            named.insert(&mut txn, "MyRange", MapPrelim::from([] as [(&str, Any); 0]));
        entry.insert(&mut txn, "ref", Any::String(Arc::from("Sheet1!A1:B5")));
    }

    let observer = new_observer(&sheets, &workbook);

    // Modify named range field in place
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(named)) = workbook.get(&txn, KEY_NAMED_RANGES) {
            if let Some(Out::YMap(entry)) = named.get(&txn, "MyRange") {
                entry.insert(&mut txn, "ref", Any::String(Arc::from("Sheet1!A1:C10")));
            }
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.named_ranges.len(), 1);
    assert_eq!(changes.named_ranges[0].key, Some("MyRange".to_string()));
    assert_eq!(changes.named_ranges[0].kind, CellChangeKind::Modified);
}
