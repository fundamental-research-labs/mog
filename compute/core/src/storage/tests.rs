use super::*;
use crate::mirror::CellMirror;
use crate::snapshot::{CellData, SheetSnapshot};
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::hex_to_id;
use formula_types::{IdentityFormula, IdentityFormulaRef, NamedRangeDef, TableDef};
use value_types::{CellError, CellValue, FiniteF64};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

fn simple_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(42.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Hello".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(100.0)),
                    formula: Some("=A1*2+16".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![NamedRangeDef::from_positions(
            "Revenue".to_string(),
            formula_types::Scope::Workbook,
            make_cell_id(5001),
            make_cell_id(5002),
            0,
            0,
            9,
            0,
        )],
        tables: vec![TableDef {
            name: "Sales".to_string(),
            sheet: SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 2,
            columns: vec!["A".to_string(), "B".to_string(), "C".to_string()],
            has_headers: true,
            has_totals: false,
        }],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

// -------------------------------------------------------------------
// Test 1: Creation — empty storage has correct schema
// -------------------------------------------------------------------

#[test]
fn test_new_creates_empty_schema() {
    let storage = YrsStorage::new();
    let mirror = CellMirror::new();

    // Provider Protocol lifecycle (Provider Protocol): `YrsStorage::new()` no longer
    // eagerly creates the `sheetOrder` array (or any other workbook-child
    // sub-map). Eager bootstrap caused a yrs Map LWW clash on independent-
    // session replay (issue #112). The array is lazy-created on first write
    // via `ensure_sheet_order_array`. Until then, `workbook.get(KEY_SHEET_ORDER)`
    // returns `None`. See `YrsStorage::new` doc-comment.
    let txn = storage.doc.transact();
    assert!(
        storage.workbook.get(&txn, KEY_SHEET_ORDER).is_none(),
        "sheetOrder should NOT be eagerly created in new()"
    );

    // Sheet order should be empty (read-side handles missing array gracefully).
    assert_eq!(storage.sheet_order().len(), 0);

    // Mirror should be empty
    assert_eq!(mirror.sheet_ids().count(), 0);
}

// -------------------------------------------------------------------
// Test 2: Add sheet
// -------------------------------------------------------------------

#[test]
fn test_add_sheet() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);

    storage
        .add_sheet(&mut mirror, sheet_id, "MySheet", 100, 26)
        .expect("add_sheet should succeed");

    // Sheet should appear in order
    let order = storage.sheet_order();
    assert_eq!(order.len(), 1);
    assert_eq!(order[0], sheet_id);

    // Mirror should have the sheet
    assert!(mirror.sheet_by_name("mysheet").is_some());

    // Yrs doc should have the sheet map with meta and YArrays
    let txn = storage.doc.transact();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    if let Some(Out::YMap(sheet_map)) = storage.sheets.get(&txn, &sheet_hex) {
        if let Some(Out::YMap(meta)) = sheet_map.get(&txn, KEY_PROPERTIES) {
            assert!(matches!(
                meta.get(&txn, KEY_NAME),
                Some(Out::Any(Any::String(_)))
            ));
        } else {
            panic!("meta map not found in sheet");
        }
        // rowOrder and colOrder YArrays should exist
        assert!(matches!(
            sheet_map.get(&txn, "rowOrder"),
            Some(Out::YArray(_))
        ));
        assert!(matches!(
            sheet_map.get(&txn, "colOrder"),
            Some(Out::YArray(_))
        ));
    } else {
        panic!("sheet map not found in yrs doc");
    }
}

// -------------------------------------------------------------------
// Test 3: Add multiple sheets — order preserved
// -------------------------------------------------------------------

#[test]
fn test_add_multiple_sheets_order_preserved() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let s1 = make_sheet_id(1);
    let s2 = make_sheet_id(2);
    let s3 = make_sheet_id(3);

    storage.add_sheet(&mut mirror, s1, "First", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s2, "Second", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s3, "Third", 10, 5).unwrap();

    let order = storage.sheet_order();
    assert_eq!(order, vec![s1, s2, s3]);
}

// -------------------------------------------------------------------
// Test 4: Cell write and read (through mirror)
// -------------------------------------------------------------------

#[test]
fn test_cell_write_and_read() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(100);

    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    // Write a number
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        None,
        None,
    );

    // Read from mirror
    let val = mirror.get_cell_value(&cell_id);
    assert!(val.is_some());
    assert_eq!(*val.unwrap(), CellValue::Number(FiniteF64::must(42.0)));

    // Read by position
    let val_at = mirror.get_cell_value_at(&sheet_id, SheetPos::new(0, 0));
    assert_eq!(*val_at.unwrap(), CellValue::Number(FiniteF64::must(42.0)));

    // No formula
    assert!(mirror.get_formula(&cell_id).is_none());
}

// -------------------------------------------------------------------
// Test 5: Cell write with formula
// -------------------------------------------------------------------

#[test]
fn test_cell_write_with_formula() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(200);

    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(100.0)),
        Some("=A1*2+16".to_string()),
        None,
    );

    // Formula is no longer stored in CellEntry (yrs doc is the authoritative source).
    // The mirror's CellEntry.formula is None; yrs doc is the authoritative source.
    assert!(mirror.get_formula(&cell_id).is_none());

    // Read from yrs doc directly
    let (yrs_val, yrs_formula, _) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist in yrs");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(100.0)));
    assert_eq!(yrs_formula, Some("=A1*2+16".to_string()));
}

// -------------------------------------------------------------------
// Test 6: Populate from snapshot
// -------------------------------------------------------------------

#[test]
fn test_populate_from_snapshot() {
    let snap = simple_snapshot();
    let storage = YrsStorage::from_snapshot(snap.clone()).expect("from_snapshot should succeed");
    let mirror = CellMirror::from_snapshot(snap).unwrap();

    // Sheet order
    let order = storage.sheet_order();
    assert_eq!(order.len(), 1);
    let sheet_id = order[0];
    assert_eq!(
        sheet_id,
        SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    );

    // Cell values via mirror
    let cell1 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").unwrap();
    assert_eq!(
        *mirror.get_cell_value(&cell1).unwrap(),
        CellValue::Number(FiniteF64::must(42.0))
    );

    let cell2 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").unwrap();
    assert_eq!(
        *mirror.get_cell_value(&cell2).unwrap(),
        CellValue::Text("Hello".into())
    );

    // Formula is no longer stored in CellEntry (yrs doc is the authoritative source).
    let cell3 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap();
    assert!(mirror.get_formula(&cell3).is_none());

    // Verify yrs doc has the data too
    let (yrs_val, yrs_formula, _) = storage
        .read_cell_from_yrs(&sheet_id, &cell3)
        .expect("cell3 should be in yrs");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(100.0)));
    assert_eq!(yrs_formula, Some("=A1*2+16".to_string()));
}

// -------------------------------------------------------------------
// Test 7: Sheet removal
// -------------------------------------------------------------------

#[test]
fn test_remove_sheet() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let s1 = make_sheet_id(1);
    let s2 = make_sheet_id(2);

    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s2, "Sheet2", 10, 5).unwrap();
    assert_eq!(storage.sheet_order().len(), 2);

    storage.remove_sheet(&mut mirror, &s1);

    // Order should only contain s2
    let order = storage.sheet_order();
    assert_eq!(order.len(), 1);
    assert_eq!(order[0], s2);

    // Mirror should not have s1
    assert!(mirror.sheet_by_name("sheet1").is_none());
    assert!(mirror.sheet_by_name("sheet2").is_some());

    // Yrs doc should not have s1
    let txn = storage.doc.transact();
    let s1_hex = id_to_hex(s1.as_u128());
    assert!(
        !matches!(storage.sheets.get(&txn, &s1_hex), Some(Out::YMap(_))),
        "sheet1 should be removed from yrs doc"
    );
}

// -------------------------------------------------------------------
// Test 8: Remove cell
// -------------------------------------------------------------------

#[test]
fn test_remove_cell() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(300);

    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(99.0)),
        None,
        None,
    );
    assert!(mirror.get_cell_value(&cell_id).is_some());

    storage.remove_cell(&mut mirror, &sheet_id, &cell_id);

    // Mirror should not have the cell
    assert!(mirror.get_cell_value(&cell_id).is_none());

    // Yrs doc should not have the cell
    assert!(storage.read_cell_from_yrs(&sheet_id, &cell_id).is_none());
}

// -------------------------------------------------------------------
// Test 9: Named ranges
// -------------------------------------------------------------------

#[test]
fn test_named_ranges() {
    let _storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let def = NamedRangeDef::from_positions(
        "Revenue".to_string(),
        formula_types::Scope::Workbook,
        make_cell_id(5001),
        make_cell_id(5002),
        0,
        0,
        9,
        0,
    );

    mirror.set_named_range("Revenue".to_string(), def);

    // Case-insensitive lookup
    assert!(mirror.get_named_range("revenue").is_some());
    assert!(mirror.get_named_range("REVENUE").is_some());

    let nr = mirror.get_named_range("revenue").unwrap();
    assert_eq!(nr.refers_to.refs.len(), 1);

    mirror.remove_named_range("Revenue");
    assert!(mirror.get_named_range("revenue").is_none());
}

// -------------------------------------------------------------------
// Test 10: Tables
// -------------------------------------------------------------------

#[test]
fn test_tables() {
    let _storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let table = domain_types::domain::table::Table {
        id: "Sales".to_string(),
        name: "Sales".to_string(),
        display_name: "Sales".to_string(),
        sheet_id: make_sheet_id(1).to_uuid_string(),
        range: cell_types::SheetRange::new(0, 0, 10, 3),
        columns: vec![
            domain_types::domain::table::TableColumn {
                id: "1".into(),
                name: "Date".into(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            domain_types::domain::table::TableColumn {
                id: "2".into(),
                name: "Product".into(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            domain_types::domain::table::TableColumn {
                id: "3".into(),
                name: "Amount".into(),
                index: 2,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            domain_types::domain::table::TableColumn {
                id: "4".into(),
                name: "Total".into(),
                index: 3,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
        ],
        has_header_row: true,
        has_totals_row: false,
        style: "TableStyleMedium2".to_string(),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: false,
        auto_expand: true,
        auto_calculated_columns: true,
    };

    mirror.set_table(table);
    assert!(mirror.get_table("Sales").is_some());
    assert!(mirror.get_table("NotExist").is_none());

    let t = mirror.get_table("Sales").unwrap();
    assert_eq!(t.columns.len(), 4);

    // Also verify the formula engine cache
    assert!(mirror.get_table_def("Sales").is_some());
    assert_eq!(mirror.get_table_def("Sales").unwrap().columns.len(), 4);

    mirror.remove_table("Sales");
    assert!(mirror.get_table("Sales").is_none());
    assert!(mirror.get_table_def("Sales").is_none());
}

// -------------------------------------------------------------------
// Test 11: Named ranges from snapshot
// -------------------------------------------------------------------

#[test]
fn test_named_ranges_from_snapshot() {
    let snap = simple_snapshot();
    let mirror = CellMirror::from_snapshot(snap).unwrap();

    assert!(mirror.get_named_range("revenue").is_some());
    let nr = mirror.get_named_range("revenue").unwrap();
    assert_eq!(nr.refers_to.refs.len(), 1);
}

// -------------------------------------------------------------------
// Test 12: Tables from snapshot
// -------------------------------------------------------------------

#[test]
fn test_tables_from_snapshot() {
    let snap = simple_snapshot();
    let mirror = CellMirror::from_snapshot(snap).unwrap();

    assert!(mirror.get_table("Sales").is_some());
    let t = mirror.get_table("Sales").unwrap();
    assert_eq!(t.columns.len(), 3);
    assert!(t.has_header_row);
}

// -------------------------------------------------------------------
// Test 13: Cell value types — boolean, text, error, null
// -------------------------------------------------------------------

#[test]
fn test_cell_value_types() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    // Boolean
    let c1 = make_cell_id(401);
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        c1,
        0,
        0,
        CellValue::Boolean(true),
        None,
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&c1).unwrap(),
        CellValue::Boolean(true)
    );

    // Text
    let c2 = make_cell_id(402);
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        c2,
        0,
        1,
        CellValue::Text("world".into()),
        None,
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&c2).unwrap(),
        CellValue::Text("world".into())
    );

    // Error
    let c3 = make_cell_id(403);
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        c3,
        0,
        2,
        CellValue::Error(CellError::Div0, None),
        None,
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&c3).unwrap(),
        CellValue::Error(CellError::Div0, None)
    );

    // Null
    let c4 = make_cell_id(404);
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        c4,
        0,
        3,
        CellValue::Null,
        None,
        None,
    );
    assert_eq!(*mirror.get_cell_value(&c4).unwrap(), CellValue::Null);
}

// -------------------------------------------------------------------
// Test 14: Overwrite cell value
// -------------------------------------------------------------------

#[test]
fn test_overwrite_cell() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(500);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    // Write initial value
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&cell_id).unwrap(),
        CellValue::Number(FiniteF64::must(1.0))
    );

    // Overwrite with new value and formula
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(99.0)),
        Some("=SUM(A1:A10)".to_string()),
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&cell_id).unwrap(),
        CellValue::Number(FiniteF64::must(99.0))
    );
    // Formula is no longer stored in CellEntry (yrs doc is the authoritative source).
    assert!(mirror.get_formula(&cell_id).is_none());

    // Verify yrs doc also updated
    let (yrs_val, yrs_formula, _) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(99.0)));
    assert_eq!(yrs_formula, Some("=SUM(A1:A10)".to_string()));
}

// -------------------------------------------------------------------
// Test 15: Default trait
// -------------------------------------------------------------------

#[test]
fn test_default_trait() {
    let storage = YrsStorage::default();
    let mirror = CellMirror::new();
    assert_eq!(storage.sheet_order().len(), 0);
    assert_eq!(mirror.sheet_ids().count(), 0);
}

// -------------------------------------------------------------------
// Test 16: Hex round-trip
// -------------------------------------------------------------------

#[test]
fn test_hex_roundtrip() {
    let id: u128 = 0x550e8400_e29b_41d4_a716_446655440000;
    let hex = id_to_hex(id);
    assert_eq!(hex, "550e8400e29b41d4a716446655440000");
    assert_eq!(hex_to_id(&hex), Some(id));
}

#[test]
fn test_hex_zero() {
    let hex = id_to_hex(0);
    assert_eq!(hex, "00000000000000000000000000000000");
    assert_eq!(hex_to_id(&hex), Some(0));
}

#[test]
fn test_hex_max() {
    let hex = id_to_hex(u128::MAX);
    assert_eq!(hex, "ffffffffffffffffffffffffffffffff");
    assert_eq!(hex_to_id(&hex), Some(u128::MAX));
}

// -------------------------------------------------------------------
// Test 17: Yrs doc consistency — write through set_cell, verify via yrs
// -------------------------------------------------------------------

#[test]
fn test_yrs_doc_consistency() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    // Write several cells
    for i in 0..5u128 {
        let cell_id = make_cell_id(1000 + i);
        storage.set_cell(
            &mut mirror,
            &sheet_id,
            cell_id,
            i as u32,
            0,
            CellValue::Number(FiniteF64::must(i as f64)),
            None,
            None,
        );
    }

    // Verify each cell in yrs
    for i in 0..5u128 {
        let cell_id = make_cell_id(1000 + i);
        let (val, _, _) = storage
            .read_cell_from_yrs(&sheet_id, &cell_id)
            .expect("cell should exist in yrs");
        assert_eq!(val, CellValue::Number(FiniteF64::must(i as f64)));
    }
}

// -------------------------------------------------------------------
// Test 18: Remove nonexistent sheet — no panic
// -------------------------------------------------------------------

#[test]
fn test_remove_nonexistent_sheet() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    // Should not panic
    storage.remove_sheet(&mut mirror, &make_sheet_id(999));
    assert_eq!(storage.sheet_order().len(), 0);
}

// -------------------------------------------------------------------
// Test 19: Remove nonexistent cell — no panic
// -------------------------------------------------------------------

#[test]
fn test_remove_nonexistent_cell() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    // Should not panic
    storage.remove_cell(&mut mirror, &sheet_id, &make_cell_id(999));
}

// -------------------------------------------------------------------
// Test 20: Read cell from empty sheet — returns None
// -------------------------------------------------------------------

#[test]
fn test_read_cell_from_empty_sheet() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    assert!(mirror.get_cell_value(&make_cell_id(999)).is_none());
    assert!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(0, 0))
            .is_none()
    );
    assert!(mirror.get_formula(&make_cell_id(999)).is_none());
    assert!(
        storage
            .read_cell_from_yrs(&sheet_id, &make_cell_id(999))
            .is_none()
    );
}

// -------------------------------------------------------------------
// Test 21: Identity formula roundtrip through Yrs
// -------------------------------------------------------------------

#[test]
fn test_identity_formula_yrs_roundtrip() {
    use formula_types::{IdentityCellRef, IdentityRangeRef};

    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(2100);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    let idf = IdentityFormula {
        template: "SUM({0})+{1}*2".to_string(),
        refs: vec![
            IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: make_cell_id(10),
                end_id: make_cell_id(20),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            }),
            IdentityFormulaRef::Cell(IdentityCellRef {
                id: make_cell_id(30),
                row_absolute: false,
                col_absolute: false,
            }),
        ],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };

    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        Some("=SUM(A1:B10)+C1*2".to_string()),
        Some(idf.clone()),
    );

    // Read from yrs doc directly — identity formula should roundtrip
    let (yrs_val, yrs_formula, yrs_idf) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist in yrs");

    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(42.0)));
    assert_eq!(yrs_formula, Some("=SUM(A1:B10)+C1*2".to_string()));
    let yrs_idf = yrs_idf.expect("identity formula should be present in yrs");
    assert_eq!(yrs_idf, idf);

    // Mirror should also have the identity formula
    let mirror_formula = mirror.get_formula(&cell_id);
    assert!(mirror_formula.is_some());
    assert_eq!(*mirror_formula.unwrap(), idf);
}

// -------------------------------------------------------------------
// Test 22: Identity formula keys exist in Yrs doc
// -------------------------------------------------------------------

#[test]
fn test_identity_formula_yrs_keys_exist() {
    use formula_types::IdentityCellRef;

    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(2200);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    let idf = IdentityFormula {
        template: "{0}+1".to_string(),
        refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
            id: make_cell_id(50),
            row_absolute: true,
            col_absolute: false,
        })],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };

    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        Some("=A1+1".to_string()),
        Some(idf),
    );

    // Directly inspect the yrs doc to verify "ft" and "fr" keys
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let txn = storage.doc.transact();

    let sheet_map = match storage.sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet map not found"),
    };
    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cells map not found"),
    };
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell map not found"),
    };

    // "ft" should be present
    assert!(matches!(
        cell_map.get(&txn, KEY_FORMULA_TEMPLATE),
        Some(Out::Any(Any::String(_)))
    ));

    // "fr" should be present
    assert!(matches!(
        cell_map.get(&txn, KEY_FORMULA_REFS),
        Some(Out::Any(Any::String(_)))
    ));

    // "fda" should NOT be present (is_dynamic_array = false)
    assert!(cell_map.get(&txn, KEY_FORMULA_DYNAMIC_ARRAY).is_none());

    // "fv" should NOT be present (is_volatile = false)
    assert!(cell_map.get(&txn, KEY_FORMULA_VOLATILE).is_none());
}

// -------------------------------------------------------------------
// Test 23: Backward compat — read cell with only "f" key
// -------------------------------------------------------------------

#[test]
fn test_backward_compat_legacy_formula_only() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(2300);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    // Write cell with only A1 formula (no identity formula)
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
        Some("=A1+A2".to_string()),
        None,
    );

    // Reading from yrs should return None for identity_formula
    let (yrs_val, yrs_formula, yrs_idf) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(10.0)));
    assert_eq!(yrs_formula, Some("=A1+A2".to_string()));
    assert!(
        yrs_idf.is_none(),
        "identity formula should be None for legacy cell"
    );
}

// -------------------------------------------------------------------
// Test 24: Identity formula with dynamic_array and volatile flags
// -------------------------------------------------------------------

#[test]
fn test_identity_formula_flags_roundtrip() {
    use formula_types::IdentityCellRef;

    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    // Dynamic array formula
    let cell_da = make_cell_id(2401);
    let idf_da = IdentityFormula {
        template: "SEQUENCE({0})".to_string(),
        refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
            id: make_cell_id(60),
            row_absolute: false,
            col_absolute: false,
        })],
        is_dynamic_array: true,
        is_volatile: false,
        is_aggregate: false,
    };

    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_da,
        0,
        0,
        CellValue::Null,
        Some("=SEQUENCE(A1)".to_string()),
        Some(idf_da.clone()),
    );

    let (_, _, yrs_idf) = storage.read_cell_from_yrs(&sheet_id, &cell_da).unwrap();
    let yrs_idf = yrs_idf.unwrap();
    assert!(yrs_idf.is_dynamic_array);
    assert!(!yrs_idf.is_volatile);
    assert_eq!(yrs_idf, idf_da);

    // Volatile formula
    let cell_vol = make_cell_id(2402);
    let idf_vol = IdentityFormula {
        template: "NOW()".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: true,
        is_aggregate: false,
    };

    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_vol,
        1,
        0,
        CellValue::Number(FiniteF64::must(45678.0)),
        Some("=NOW()".to_string()),
        Some(idf_vol.clone()),
    );

    let (_, _, yrs_idf) = storage.read_cell_from_yrs(&sheet_id, &cell_vol).unwrap();
    let yrs_idf = yrs_idf.unwrap();
    assert!(!yrs_idf.is_dynamic_array);
    assert!(yrs_idf.is_volatile);
    assert_eq!(yrs_idf, idf_vol);
}

// -------------------------------------------------------------------
// Test 25: Identity formula refs JSON roundtrip for all 6 ref variants
// -------------------------------------------------------------------

#[test]
fn test_identity_refs_json_roundtrip_all_variants() {
    use cell_types::{ColId, RowId};
    use formula_types::{
        IdentityCellRef, IdentityColRangeRef, IdentityFullColRef, IdentityFullRowRef,
        IdentityRangeRef, IdentityRowRangeRef,
    };

    let refs = vec![
        IdentityFormulaRef::Cell(IdentityCellRef {
            id: make_cell_id(1),
            row_absolute: true,
            col_absolute: false,
        }),
        IdentityFormulaRef::Range(IdentityRangeRef {
            start_id: make_cell_id(10),
            end_id: make_cell_id(20),
            start_row_absolute: false,
            start_col_absolute: true,
            end_row_absolute: true,
            end_col_absolute: false,
        }),
        IdentityFormulaRef::FullRow(IdentityFullRowRef {
            row_id: RowId::from_raw(100),
            absolute: true,
        }),
        IdentityFormulaRef::RowRange(IdentityRowRangeRef {
            start_row_id: RowId::from_raw(200),
            end_row_id: RowId::from_raw(205),
            start_absolute: false,
            end_absolute: true,
        }),
        IdentityFormulaRef::FullCol(IdentityFullColRef {
            col_id: ColId::from_raw(300),
            absolute: false,
        }),
        IdentityFormulaRef::ColRange(IdentityColRangeRef {
            start_col_id: ColId::from_raw(400),
            end_col_id: ColId::from_raw(403),
            start_absolute: true,
            end_absolute: false,
        }),
    ];

    let json = identity_refs_to_json(&refs).unwrap();
    let parsed = identity_refs_from_json(&json).expect("JSON deserialization should succeed");
    assert_eq!(refs, parsed);
}

// -------------------------------------------------------------------
// Test 26: Identity formula from snapshot roundtrip
// -------------------------------------------------------------------

#[test]
fn test_identity_formula_from_snapshot() {
    use formula_types::IdentityCellRef;

    let idf = IdentityFormula {
        template: "SUM({0})".to_string(),
        refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
            id: CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").unwrap(),
            row_absolute: false,
            col_absolute: false,
        })],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                row: 1,
                col: 0,
                value: CellValue::Number(FiniteF64::must(42.0)),
                formula: Some("=SUM(A1)".to_string()),
                identity_formula: Some(idf.clone()),
                array_ref: None,
            }],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let storage = YrsStorage::from_snapshot(snap.clone()).expect("from_snapshot should succeed");
    let mirror = CellMirror::from_snapshot(snap).unwrap();
    let sheet_id = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap();

    // Verify identity formula in yrs doc
    let (_, _, yrs_idf) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist");
    let yrs_idf = yrs_idf.expect("identity formula should be present");
    assert_eq!(yrs_idf, idf);

    // Verify identity formula in mirror
    let mirror_formula = mirror.get_formula(&cell_id);
    assert!(mirror_formula.is_some());
    assert_eq!(*mirror_formula.unwrap(), idf);
}

// -------------------------------------------------------------------
// Test 27: new() creates workbook-level domain maps
// -------------------------------------------------------------------

#[test]
fn test_new_does_not_eagerly_create_workbook_domain_maps() {
    // Provider Protocol lifecycle: `YrsStorage::new()` deliberately does NOT create
    // workbook-child domain maps eagerly. They're lazy-created by their
    // respective writers via `ensure_*` helpers. See `YrsStorage::new`
    // doc-comment for the architectural reasoning (yrs Map LWW clash on
    // independent-session replay).
    let storage = YrsStorage::new();
    let txn = storage.doc.transact();
    for key in [
        "workbookSettings",
        "namedRanges",
        "tables",
        "slicers",
        "powerQuery",
        "scenarios",
    ] {
        assert!(
            storage.workbook.get(&txn, key).is_none(),
            "workbook MUST NOT eagerly create '{}' map",
            key
        );
    }
}

// -------------------------------------------------------------------
// Test 28: add_sheet creates all per-sheet domain maps
// -------------------------------------------------------------------

#[test]
fn test_add_sheet_creates_all_domain_maps() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    let txn = storage.doc.transact();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match storage.sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet map not found"),
    };

    // All per-sheet maps should exist
    for key in [
        "cells",
        "cellProperties",
        "rowHeights",
        "colWidths",
        "schemas",
        "pivotTables",
        // Structural
        "merges",
        "hiddenRows",
        "hiddenCols",
        // Feature
        "rowFormats",
        "colFormats",
        "comments",
        "filters",
        "sparklines",
        "conditionalFormat",
        "bindings",
        "grouping",
        "sorting",
        "floatingObjects",
        "floatingObjectGroups",
    ] {
        assert!(
            sheet_map.get(&txn, key).is_some(),
            "sheet should have '{}' map",
            key
        );
    }
    // YArrays should exist
    assert!(
        matches!(sheet_map.get(&txn, "rowOrder"), Some(Out::YArray(_))),
        "sheet should have 'rowOrder' YArray"
    );
    assert!(
        matches!(sheet_map.get(&txn, "colOrder"), Some(Out::YArray(_))),
        "sheet should have 'colOrder' YArray"
    );
}

// -------------------------------------------------------------------
// Test 29: from_snapshot creates all domain maps
// -------------------------------------------------------------------

#[test]
fn test_from_snapshot_does_not_eagerly_create_domain_maps() {
    // Provider Protocol lifecycle: workbook-level domain maps are NOT eagerly created
    // by `from_snapshot` either — they're lazy-created by their respective
    // writers. See `YrsStorage::new` doc-comment.
    let snap = simple_snapshot();
    let storage = YrsStorage::from_snapshot(snap).unwrap();

    // Workbook-level maps should NOT eagerly exist post-`from_snapshot`.
    let txn = storage.doc.transact();
    for key in [
        "workbookSettings",
        "namedRanges",
        "tables",
        "slicers",
        "powerQuery",
        "scenarios",
    ] {
        assert!(
            storage.workbook.get(&txn, key).is_none(),
            "workbook MUST NOT eagerly create '{}' map post-`from_snapshot` \
             (Provider Protocol fix)",
            key
        );
    }

    // Per-sheet maps
    let order = storage.sheet_order();
    let sheet_hex = id_to_hex(order[0].as_u128());
    let sheet_map = match storage.sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet map not found"),
    };

    for key in [
        "merges",
        "mergeBackups",
        "hiddenRows",
        "hiddenCols",
        "rowFormats",
        "colFormats",
        "comments",
        "filters",
        "sparklines",
        "conditionalFormat",
        "bindings",
        "grouping",
        "sorting",
    ] {
        assert!(
            sheet_map.get(&txn, key).is_some(),
            "sheet should have '{}' map after from_snapshot",
            key
        );
    }
    // YArrays
    assert!(
        matches!(sheet_map.get(&txn, "rowOrder"), Some(Out::YArray(_))),
        "sheet should have 'rowOrder' YArray after from_snapshot"
    );
    assert!(
        matches!(sheet_map.get(&txn, "colOrder"), Some(Out::YArray(_))),
        "sheet should have 'colOrder' YArray after from_snapshot"
    );
}
