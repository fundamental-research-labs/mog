use super::*;

#[test]
fn arrayformula_wrapper_spills_lifted_range_operator() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            (0, 0, CellValue::number(1.0), None),
            (1, 0, CellValue::number(2.0), None),
            (2, 0, CellValue::number(3.0), None),
            (0, 3, CellValue::Null, None),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let d1 = CellId::from_uuid_str(&cell_uuid(0, 0, 3)).expect("d1");

    core.set_cell(&mut mirror, &sid, d1, 0, 3, "=ARRAYFORMULA(A1:A3*2)")
        .expect("set D1");

    assert_mirror_number(&mirror, &d1, 2.0, "D1 ARRAYFORMULA anchor");
    assert_col_data_number(&mirror, &sid, 1, 3, 4.0, "D2 ARRAYFORMULA spill");
    assert_col_data_number(&mirror, &sid, 2, 3, 6.0, "D3 ARRAYFORMULA spill");
}

#[test]
fn flatten_and_array_constrain_project_spills() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            (0, 0, CellValue::number(1.0), None),
            (0, 1, CellValue::number(2.0), None),
            (1, 0, CellValue::number(3.0), None),
            (1, 1, CellValue::number(4.0), None),
            (0, 3, CellValue::Null, None),
            (0, 5, CellValue::Null, None),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let d1 = CellId::from_uuid_str(&cell_uuid(0, 0, 3)).expect("d1");
    let f1 = CellId::from_uuid_str(&cell_uuid(0, 0, 5)).expect("f1");

    core.set_cell(&mut mirror, &sid, d1, 0, 3, "=FLATTEN(A1:B2)")
        .expect("set D1");
    assert_mirror_number(&mirror, &d1, 1.0, "D1 FLATTEN anchor");
    assert_col_data_number(&mirror, &sid, 1, 3, 2.0, "D2 FLATTEN spill");
    assert_col_data_number(&mirror, &sid, 2, 3, 3.0, "D3 FLATTEN spill");
    assert_col_data_number(&mirror, &sid, 3, 3, 4.0, "D4 FLATTEN spill");

    core.set_cell(&mut mirror, &sid, f1, 0, 5, "=ARRAY_CONSTRAIN(A1:B2,1,2)")
        .expect("set F1");
    assert_mirror_number(&mirror, &f1, 1.0, "F1 ARRAY_CONSTRAIN anchor");
    assert_col_data_number(&mirror, &sid, 0, 6, 2.0, "G1 ARRAY_CONSTRAIN spill");
}

#[test]
fn sortn_trimrange_and_percentof_execute_in_workbook_path() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            (0, 0, CellValue::Null, None),
            (0, 1, CellValue::Null, None),
            (1, 0, CellValue::number(3.0), None),
            (1, 1, CellValue::number(30.0), None),
            (2, 0, CellValue::number(1.0), None),
            (2, 1, CellValue::number(10.0), None),
            (3, 0, CellValue::number(2.0), None),
            (3, 1, CellValue::number(20.0), None),
            (4, 0, CellValue::Null, None),
            (4, 1, CellValue::Null, None),
            (0, 3, CellValue::Null, None),
            (0, 5, CellValue::Null, None),
            (0, 7, CellValue::Null, None),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let d1 = CellId::from_uuid_str(&cell_uuid(0, 0, 3)).expect("d1");
    let f1 = CellId::from_uuid_str(&cell_uuid(0, 0, 5)).expect("f1");
    let h1 = CellId::from_uuid_str(&cell_uuid(0, 0, 7)).expect("h1");

    core.set_cell(&mut mirror, &sid, d1, 0, 3, "=SORTN(A2:B4,2,0,1,TRUE)")
        .expect("set D1");
    assert_mirror_number(&mirror, &d1, 1.0, "D1 SORTN anchor");
    assert_col_data_number(&mirror, &sid, 0, 4, 10.0, "E1 SORTN spill");
    assert_col_data_number(&mirror, &sid, 1, 3, 2.0, "D2 SORTN spill");
    assert_col_data_number(&mirror, &sid, 1, 4, 20.0, "E2 SORTN spill");

    core.set_cell(&mut mirror, &sid, f1, 0, 5, "=TRIMRANGE(A1:B5)")
        .expect("set F1");
    assert_mirror_number(&mirror, &f1, 3.0, "F1 TRIMRANGE anchor");
    assert_col_data_number(&mirror, &sid, 2, 6, 20.0, "G3 TRIMRANGE spill");

    core.set_cell(&mut mirror, &sid, h1, 0, 7, "=PERCENTOF(B2:B2,B2:B4)")
        .expect("set H1");
    assert_mirror_number(&mirror, &h1, 0.5, "H1 PERCENTOF");
}
