use super::*;

/// H6a: Two horizontal TRANSPOSEs on different rows — no spill conflict.
///
/// Mimics an imported-workbook output pattern:
///   Column A, rows 0-4: source data 1 (monthly cohort sizes)
///   Column B, rows 0-4: source data 2 (annual cohort sizes)
///   C6 = TRANSPOSE(A1:A5) → spills into C6:G6  (row 5, horizontal)
///   C7 = TRANSPOSE(B1:B5) → spills into C7:G7  (row 6, horizontal)
///   C8 = SUM(C6:C7)  → should sum column C rows 6-7
///
/// Key: source data is VERTICAL (A1:A5) so TRANSPOSE produces HORIZONTAL spill.
/// Two horizontal spills on adjacent rows should NOT conflict.
#[test]
fn test_two_horizontal_transposes_no_conflict() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            // Vertical source data 1 (column A): A1=0, A2=0, A3=1, A4=7, A5=192
            (0, 0, CellValue::number(0.0), None),
            (1, 0, CellValue::number(0.0), None),
            (2, 0, CellValue::number(1.0), None),
            (3, 0, CellValue::number(7.0), None),
            (4, 0, CellValue::number(192.0), None),
            // Vertical source data 2 (column B): B1=197, B2=448, B3=475, B4=529, B5=377
            (0, 1, CellValue::number(197.0), None),
            (1, 1, CellValue::number(448.0), None),
            (2, 1, CellValue::number(475.0), None),
            (3, 1, CellValue::number(529.0), None),
            (4, 1, CellValue::number(377.0), None),
            // Placeholders for TRANSPOSE anchors and SUM cells
            (5, 2, CellValue::Null, None), // C6 - TRANSPOSE anchor 1
            (6, 2, CellValue::Null, None), // C7 - TRANSPOSE anchor 2
            (7, 2, CellValue::Null, None), // C8 - SUM
            (7, 3, CellValue::Null, None), // D8 - SUM
            (7, 4, CellValue::Null, None), // E8 - SUM
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let c6 = CellId::from_uuid_str(&cell_uuid(0, 5, 2)).expect("c6");
    let c7 = CellId::from_uuid_str(&cell_uuid(0, 6, 2)).expect("c7");
    let c8 = CellId::from_uuid_str(&cell_uuid(0, 7, 2)).expect("c8");
    let d8 = CellId::from_uuid_str(&cell_uuid(0, 7, 3)).expect("d8");
    let e8 = CellId::from_uuid_str(&cell_uuid(0, 7, 4)).expect("e8");

    // C6 = TRANSPOSE(A1:A5) → 1×5 horizontal spill: C6=0, D6=0, E6=1, F6=7, G6=192
    core.set_cell(&mut mirror, &sid, c6, 5, 2, "=TRANSPOSE(A1:A5)")
        .expect("set C6");
    // C7 = TRANSPOSE(B1:B5) → 1×5 horizontal spill: C7=197, D7=448, E7=475, F7=529, G7=377
    core.set_cell(&mut mirror, &sid, c7, 6, 2, "=TRANSPOSE(B1:B5)")
        .expect("set C7");

    // Verify no #SPILL! — both should succeed
    assert_mirror_number(&mirror, &c6, 0.0, "C6 TRANSPOSE source (row 5)");
    assert_mirror_number(&mirror, &c7, 197.0, "C7 TRANSPOSE source (row 6)");

    // Verify spill targets for row 5 (C6:G6)
    assert_col_data_number(&mirror, &sid, 5, 3, 0.0, "D6 spill");
    assert_col_data_number(&mirror, &sid, 5, 4, 1.0, "E6 spill");
    assert_col_data_number(&mirror, &sid, 5, 5, 7.0, "F6 spill");
    assert_col_data_number(&mirror, &sid, 5, 6, 192.0, "G6 spill");

    // Verify spill targets for row 6 (C7:G7)
    assert_col_data_number(&mirror, &sid, 6, 3, 448.0, "D7 spill");
    assert_col_data_number(&mirror, &sid, 6, 4, 475.0, "E7 spill");
    assert_col_data_number(&mirror, &sid, 6, 5, 529.0, "F7 spill");
    assert_col_data_number(&mirror, &sid, 6, 6, 377.0, "G7 spill");

    // SUM over columns — single-column ranges (Tier 1 in range_store)
    core.set_cell(&mut mirror, &sid, c8, 7, 2, "=SUM(C6:C7)")
        .expect("set C8");
    core.set_cell(&mut mirror, &sid, d8, 7, 3, "=SUM(D6:D7)")
        .expect("set D8");
    core.set_cell(&mut mirror, &sid, e8, 7, 4, "=SUM(E6:E7)")
        .expect("set E8");

    // C8 = SUM(C6:C7) = 0 + 197 = 197
    assert_mirror_number(&mirror, &c8, 197.0, "C8 SUM(C6:C7)");
    // D8 = SUM(D6:D7) = 0 + 448 = 448
    assert_mirror_number(&mirror, &d8, 448.0, "D8 SUM(D6:D7)");
    // E8 = SUM(E6:E7) = 1 + 475 = 476
    assert_mirror_number(&mirror, &e8, 476.0, "E8 SUM(E6:E7)");
}

/// H6b: Two horizontal TRANSPOSEs + SUM via snapshot path (no interactive).
///
/// Same as H6a but all formulas present at init time. Tests evaluation ordering.
#[test]
fn test_two_horizontal_transposes_in_snapshot() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (0, 1, CellValue::number(40.0), None),
            (1, 1, CellValue::number(50.0), None),
            (2, 1, CellValue::number(60.0), None),
            // C4 = TRANSPOSE(A1:A3) → C4:E4 = [10, 20, 30]
            (3, 2, CellValue::Null, Some("TRANSPOSE(A1:A3)")),
            // C5 = TRANSPOSE(B1:B3) → C5:E5 = [40, 50, 60]
            (4, 2, CellValue::Null, Some("TRANSPOSE(B1:B3)")),
            // C6 = SUM(C4:C5) → single-column SUM
            (5, 2, CellValue::Null, Some("SUM(C4:C5)")),
            // D6 = SUM(D4:D5)
            (5, 3, CellValue::Null, Some("SUM(D4:D5)")),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let _sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let c4 = CellId::from_uuid_str(&cell_uuid(0, 3, 2)).expect("c4");
    let c5 = CellId::from_uuid_str(&cell_uuid(0, 4, 2)).expect("c5");
    let c6 = CellId::from_uuid_str(&cell_uuid(0, 5, 2)).expect("c6");
    let d6 = CellId::from_uuid_str(&cell_uuid(0, 5, 3)).expect("d6");

    assert_mirror_number(&mirror, &c4, 10.0, "C4 TRANSPOSE source");
    assert_mirror_number(&mirror, &c5, 40.0, "C5 TRANSPOSE source");
    // SUM(C4:C5) = 10 + 40 = 50
    assert_mirror_number(&mirror, &c6, 50.0, "C6 SUM(C4:C5)");
    // SUM(D4:D5) = 20 + 50 = 70
    assert_mirror_number(&mirror, &d6, 70.0, "D6 SUM(D4:D5)");
}

/// H7: Cross-sheet TRANSPOSE with horizontal spill.
///
/// Sheet "Source" has vertical data C1:C5.
/// Sheet "Output" has B1 = TRANSPOSE(Source!C1:C5) → horizontal spill B1:F1.
/// Tests cross-sheet reference resolution for TRANSPOSE.
#[test]
fn test_transpose_cross_sheet_spill() {
    let snapshot = build_snapshot(vec![
        // Sheet 0: "Source" with vertical data
        (
            "Source",
            100,
            26,
            vec![
                (0, 2, CellValue::number(10.0), None), // C1
                (1, 2, CellValue::number(20.0), None), // C2
                (2, 2, CellValue::number(30.0), None), // C3
                (3, 2, CellValue::number(40.0), None), // C4
                (4, 2, CellValue::number(50.0), None), // C5
            ],
        ),
        // Sheet 1: "Output" with TRANSPOSE formula
        (
            "Output",
            100,
            100,
            vec![
                (0, 1, CellValue::Null, Some("TRANSPOSE(Source!C1:C5)")), // B1
                (0, 6, CellValue::Null, Some("SUM(B1:F1)")),              // G1
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid1 = SheetId::from_uuid_str(&sheet_uuid(1)).expect("sid1");
    let b1 = CellId::from_uuid_str(&cell_uuid(1, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(1, 0, 6)).expect("g1");

    // B1 source = 10 (first value)
    assert_mirror_number(&mirror, &b1, 10.0, "Output B1 TRANSPOSE source");

    // Spill targets on Output sheet
    assert_col_data_number(&mirror, &sid1, 0, 2, 20.0, "Output C1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 3, 30.0, "Output D1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 4, 40.0, "Output E1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 5, 50.0, "Output F1 spill");

    // SUM(B1:F1) = 10+20+30+40+50 = 150
    assert_mirror_number(&mirror, &g1, 150.0, "Output G1 SUM cross-sheet spill");
}
