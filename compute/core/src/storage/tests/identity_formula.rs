use super::support::make_cell_id;
use super::*;

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

    let json = serde_json::to_string(&refs).unwrap();
    let parsed: Vec<IdentityFormulaRef> =
        serde_json::from_str(&json).expect("JSON deserialization should succeed");
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
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
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

    let mirror = CellMirror::from_snapshot(snap).unwrap();
    let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap();

    let mirror_formula = mirror.get_formula(&cell_id);
    assert!(mirror_formula.is_some());
    assert_eq!(*mirror_formula.unwrap(), idf);
}
