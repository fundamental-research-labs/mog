use super::support::{make_cell_id, make_sheet_id};
use super::*;

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

    let (yrs_val, yrs_formula, yrs_idf) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist in yrs");

    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(42.0)));
    assert_eq!(yrs_formula, Some("=SUM(A1:B10)+C1*2".to_string()));
    let yrs_idf = yrs_idf.expect("identity formula should be present in yrs");
    assert_eq!(yrs_idf, idf);

    let mirror_formula = mirror.get_formula(&cell_id);
    assert!(mirror_formula.is_some());
    assert_eq!(*mirror_formula.unwrap(), idf);
}

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

    assert!(matches!(
        cell_map.get(&txn, KEY_FORMULA_TEMPLATE),
        Some(Out::Any(Any::String(_)))
    ));

    assert!(matches!(
        cell_map.get(&txn, KEY_FORMULA_REFS),
        Some(Out::Any(Any::String(_)))
    ));

    assert!(cell_map.get(&txn, KEY_FORMULA_DYNAMIC_ARRAY).is_none());
    assert!(cell_map.get(&txn, KEY_FORMULA_VOLATILE).is_none());
}

#[test]
fn test_backward_compat_legacy_formula_only() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(2300);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

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

#[test]
fn test_identity_formula_flags_roundtrip() {
    use formula_types::IdentityCellRef;

    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

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

    let (_, _, yrs_idf) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist");
    let yrs_idf = yrs_idf.expect("identity formula should be present");
    assert_eq!(yrs_idf, idf);

    let mirror_formula = mirror.get_formula(&cell_id);
    assert!(mirror_formula.is_some());
    assert_eq!(*mirror_formula.unwrap(), idf);
}
