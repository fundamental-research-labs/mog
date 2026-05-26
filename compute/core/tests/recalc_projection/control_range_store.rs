use super::*;

/// Control: multi-column SUM without any TRANSPOSE or spill.
///
/// If this passes, the range_store subtraction overflow is caused by TRANSPOSE
/// interaction, not a general range_store bug.
#[test]
fn test_control_multi_column_sum_no_spill() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 1, CellValue::number(10.0), None), // B1
            (0, 2, CellValue::number(20.0), None), // C1
            (0, 3, CellValue::number(30.0), None), // D1
            (0, 4, CellValue::number(40.0), None), // E1
            (0, 5, CellValue::number(50.0), None), // F1
            (0, 6, CellValue::Null, None),         // G1 placeholder
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    core.set_cell(&mut mirror, &sid, g1, 0, 6, "=SUM(B1:F1)")
        .expect("set G1");
    assert_mirror_number(&mirror, &g1, 150.0, "G1 SUM(B1:F1) no spill");
}

/// Control: multi-column SUM set interactively AFTER a SEQUENCE (vertical) spill.
///
/// SEQUENCE spills vertically (single column). Then SUM over a multi-column range
/// that does NOT overlap the spill. If this passes, the bug is specific to horizontal
/// TRANSPOSE spill interaction with range_store.
#[test]
fn test_control_sequence_vertical_then_multi_column_sum() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Null, None),         // A1 placeholder
            (0, 1, CellValue::number(10.0), None), // B1
            (0, 2, CellValue::number(20.0), None), // C1
            (0, 3, CellValue::number(30.0), None), // D1
            (0, 6, CellValue::Null, None),         // G1 placeholder
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a1 = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    // A1 = SEQUENCE(5) → vertical spill A1:A5 (single column, doesn't touch B:D)
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(5)")
        .expect("set A1");
    // G1 = SUM(B1:D1) — multi-column range, doesn't overlap the SEQUENCE spill
    core.set_cell(&mut mirror, &sid, g1, 0, 6, "=SUM(B1:D1)")
        .expect("set G1");
    assert_mirror_number(&mirror, &g1, 60.0, "G1 SUM(B1:D1) after SEQUENCE");
}

/// Control: TRANSPOSE first, then multi-column SUM that does NOT overlap the spill.
///
/// TRANSPOSE(A1:A3) → B1:D1 (horizontal spill).
/// SUM(F1:H1) — multi-column range in a different area (no overlap with spill).
/// If this crashes, the bug is in range_store state corruption from TRANSPOSE,
/// not in the specific range being materialized.
#[test]
fn test_control_transpose_then_non_overlapping_multi_col_sum() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),  // A1
            (1, 0, CellValue::number(20.0), None),  // A2
            (2, 0, CellValue::number(30.0), None),  // A3
            (0, 1, CellValue::Null, None),          // B1 placeholder
            (0, 5, CellValue::number(100.0), None), // F1
            (0, 6, CellValue::number(200.0), None), // G1
            (0, 7, CellValue::number(300.0), None), // H1
            (0, 8, CellValue::Null, None),          // I1 placeholder for SUM
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let i1 = CellId::from_uuid_str(&cell_uuid(0, 0, 8)).expect("i1");

    // B1 = TRANSPOSE(A1:A3) → B1=10, C1=20, D1=30
    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=TRANSPOSE(A1:A3)")
        .expect("set B1");
    // I1 = SUM(F1:H1) — completely separate from the spill range
    core.set_cell(&mut mirror, &sid, i1, 0, 8, "=SUM(F1:H1)")
        .expect("set I1");
    assert_mirror_number(&mirror, &i1, 600.0, "I1 SUM(F1:H1) non-overlapping");
}
