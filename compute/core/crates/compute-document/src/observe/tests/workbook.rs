use super::super::CellChangeKind;
use super::fixtures::new_observer;
use super::fixtures::setup_doc;
use crate::schema::{KEY_NAMED_RANGES, KEY_RANGE_BINDINGS, KEY_TABLES};
use std::sync::Arc;
use yrs::{Any, Map, MapPrelim, MapRef, Out, Transact};

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
fn test_workbook_table_range_binding_change() {
    let (doc, sheets, workbook) = setup_doc();

    // Table metadata is now persisted primarily in workbook.rangeBindings
    // using table:<name> keys. The observer must route those entries through
    // the table domain so engines rebuild their table mirror after sync.
    {
        let mut txn = doc.transact_mut();
        let _: MapRef = workbook.insert(
            &mut txn,
            KEY_RANGE_BINDINGS,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    let observer = new_observer(&sheets, &workbook);

    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(bindings)) = workbook.get(&txn, KEY_RANGE_BINDINGS) {
            bindings.insert(
                &mut txn,
                "table:SalesData",
                Any::String(Arc::from(r#"{"name":"SalesData"}"#)),
            );
            bindings.insert(
                &mut txn,
                "cf:rule-1",
                Any::String(Arc::from(r#"{"ruleRef":"rule-1"}"#)),
            );
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.tables.len(), 1);
    assert_eq!(changes.tables[0].key, "table:SalesData");
    assert_eq!(changes.tables[0].kind, CellChangeKind::Modified);
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
