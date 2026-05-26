use super::*;

/// R1: Three-sheet TRANSPOSE → SUM cascade (snapshot path).
///
/// Reproduces the exact Rev Build pattern from the XLSX:
///   Sheet "Monthly":  C1:C5 = [0, 0, 1, 7, 192]       (vertical source)
///   Sheet "Annual":   C1:C5 = [197, 448, 475, 529, 377] (vertical source)
///   Sheet "Rev Build":
///     Row 0: B1 = TRANSPOSE(Monthly!C1:C5)  → should spill B1:F1 = [0,0,1,7,192]
///     Row 1: B2 = TRANSPOSE(Annual!C1:C5)   → should spill B2:F2 = [197,448,475,529,377]
///     Row 2: B3 = SUM(B1:B2), C3 = SUM(C1:C2), D3 = SUM(D1:D2), etc.
///
/// Bug: Q28:AN28 remain null in the XLSX because TRANSPOSE doesn't spill.
/// Then SUM(col) = 0 instead of correct values.
#[test]
fn test_xlsx_repro_three_sheet_transpose_sum_cascade() {
    let snapshot = build_snapshot(vec![
        // Sheet 0: "Monthly" — vertical source data in column C (col 2)
        (
            "Monthly",
            10,
            10,
            vec![
                (0, 2, CellValue::number(0.0), None),   // C1 = 0
                (1, 2, CellValue::number(0.0), None),   // C2 = 0
                (2, 2, CellValue::number(1.0), None),   // C3 = 1
                (3, 2, CellValue::number(7.0), None),   // C4 = 7
                (4, 2, CellValue::number(192.0), None), // C5 = 192
            ],
        ),
        // Sheet 1: "Annual" — vertical source data in column C (col 2)
        (
            "Annual",
            10,
            10,
            vec![
                (0, 2, CellValue::number(197.0), None), // C1 = 197
                (1, 2, CellValue::number(448.0), None), // C2 = 448
                (2, 2, CellValue::number(475.0), None), // C3 = 475
                (3, 2, CellValue::number(529.0), None), // C4 = 529
                (4, 2, CellValue::number(377.0), None), // C5 = 377
            ],
        ),
        // Sheet 2: "Rev Build" — TRANSPOSE + SUM
        (
            "Rev Build",
            10,
            10,
            vec![
                // Row 0: TRANSPOSE(Monthly!C1:C5) → B1:F1 horizontal spill
                (0, 1, CellValue::Null, Some("TRANSPOSE(Monthly!C1:C5)")),
                // Row 1: TRANSPOSE(Annual!C1:C5) → B2:F2 horizontal spill
                (1, 1, CellValue::Null, Some("TRANSPOSE(Annual!C1:C5)")),
                // Row 2: SUM of each column pair from rows 0 and 1
                (2, 1, CellValue::Null, Some("SUM(B1:B2)")), // B3
                (2, 2, CellValue::Null, Some("SUM(C1:C2)")), // C3
                (2, 3, CellValue::Null, Some("SUM(D1:D2)")), // D3
                (2, 4, CellValue::Null, Some("SUM(E1:E2)")), // E3
                (2, 5, CellValue::Null, Some("SUM(F1:F2)")), // F3
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid2 = SheetId::from_uuid_str(&sheet_uuid(2)).expect("sid Rev Build");
    let b1 = CellId::from_uuid_str(&cell_uuid(2, 0, 1)).expect("b1");
    let b2 = CellId::from_uuid_str(&cell_uuid(2, 1, 1)).expect("b2");
    let b3 = CellId::from_uuid_str(&cell_uuid(2, 2, 1)).expect("b3");
    let c3 = CellId::from_uuid_str(&cell_uuid(2, 2, 2)).expect("c3");
    let d3 = CellId::from_uuid_str(&cell_uuid(2, 2, 3)).expect("d3");
    let e3 = CellId::from_uuid_str(&cell_uuid(2, 2, 4)).expect("e3");
    let f3 = CellId::from_uuid_str(&cell_uuid(2, 2, 5)).expect("f3");

    // TRANSPOSE anchors should have their first values
    assert_mirror_number(&mirror, &b1, 0.0, "B1 TRANSPOSE(Monthly) source");
    assert_mirror_number(&mirror, &b2, 197.0, "B2 TRANSPOSE(Annual) source");

    // Spill targets for row 0 (Monthly): C1=0, D1=1, E1=7, F1=192
    assert_col_data_null_or_zero(&mirror, &sid2, 0, 2, "C1 Monthly spill (0)");
    assert_col_data_number(&mirror, &sid2, 0, 3, 1.0, "D1 Monthly spill");
    assert_col_data_number(&mirror, &sid2, 0, 4, 7.0, "E1 Monthly spill");
    assert_col_data_number(&mirror, &sid2, 0, 5, 192.0, "F1 Monthly spill");

    // Spill targets for row 1 (Annual): C2=448, D2=475, E2=529, F2=377
    assert_col_data_number(&mirror, &sid2, 1, 2, 448.0, "C2 Annual spill");
    assert_col_data_number(&mirror, &sid2, 1, 3, 475.0, "D2 Annual spill");
    assert_col_data_number(&mirror, &sid2, 1, 4, 529.0, "E2 Annual spill");
    assert_col_data_number(&mirror, &sid2, 1, 5, 377.0, "F2 Annual spill");

    // SUM of each column: Monthly + Annual
    // B3 = SUM(B1:B2) = 0 + 197 = 197
    assert_mirror_number(&mirror, &b3, 197.0, "B3 SUM(B1:B2)");
    // C3 = SUM(C1:C2) = 0 + 448 = 448
    assert_mirror_number(&mirror, &c3, 448.0, "C3 SUM(C1:C2)");
    // D3 = SUM(D1:D2) = 1 + 475 = 476
    assert_mirror_number(&mirror, &d3, 476.0, "D3 SUM(D1:D2)");
    // E3 = SUM(E1:E2) = 7 + 529 = 536
    assert_mirror_number(&mirror, &e3, 536.0, "E3 SUM(E1:E2)");
    // F3 = SUM(F1:F2) = 192 + 377 = 569
    assert_mirror_number(&mirror, &f3, 569.0, "F3 SUM(F1:F2)");
}

/// R2: Chained TRANSPOSE — TRANSPOSE reads from another TRANSPOSE's spill targets.
///
/// This is the exact pattern from the XLSX where:
///   "Rev Build"!P29 = TRANSPOSE('Cohort - Basic - Annual'!C5:C29)
///     → spills P29:AN29 = [197, 448, 475, 529, 377, ...]
///   "Forecasted Cohort"!D5 = TRANSPOSE('Rev Build'!P29:T29)
///     → reads the spill range and transposes back to vertical D5:D9
///
/// The bug: "Rev Build"!Q29:T29 are null (TRANSPOSE didn't spill),
/// so the second TRANSPOSE gets [197, null, null, null, null],
/// and D6:D9 are null instead of [448, 475, 529, 377].
#[test]
fn test_xlsx_repro_chained_transpose_cross_sheet() {
    let snapshot = build_snapshot(vec![
        // Sheet 0: "Source" — vertical data
        (
            "Source",
            10,
            10,
            vec![
                (0, 0, CellValue::number(197.0), None), // A1
                (1, 0, CellValue::number(448.0), None), // A2
                (2, 0, CellValue::number(475.0), None), // A3
                (3, 0, CellValue::number(529.0), None), // A4
                (4, 0, CellValue::number(377.0), None), // A5
            ],
        ),
        // Sheet 1: "Bridge" — TRANSPOSE to horizontal
        (
            "Bridge",
            10,
            10,
            vec![
                // B1 = TRANSPOSE(Source!A1:A5) → B1:F1 = [197,448,475,529,377]
                (0, 1, CellValue::Null, Some("TRANSPOSE(Source!A1:A5)")),
            ],
        ),
        // Sheet 2: "Consumer" — TRANSPOSE back to vertical, reading from Bridge's spill
        (
            "Consumer",
            10,
            10,
            vec![
                // A1 = TRANSPOSE(Bridge!B1:F1) → A1:A5 = [197,448,475,529,377]
                (0, 0, CellValue::Null, Some("TRANSPOSE(Bridge!B1:F1)")),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid1 = SheetId::from_uuid_str(&sheet_uuid(1)).expect("sid Bridge");
    let sid2 = SheetId::from_uuid_str(&sheet_uuid(2)).expect("sid Consumer");
    let bridge_b1 = CellId::from_uuid_str(&cell_uuid(1, 0, 1)).expect("bridge b1");
    let consumer_a1 = CellId::from_uuid_str(&cell_uuid(2, 0, 0)).expect("consumer a1");

    // Bridge B1 = first value (197)
    assert_mirror_number(&mirror, &bridge_b1, 197.0, "Bridge!B1 TRANSPOSE source");

    // Bridge spill targets: C1=448, D1=475, E1=529, F1=377
    assert_col_data_number(&mirror, &sid1, 0, 2, 448.0, "Bridge!C1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 3, 475.0, "Bridge!D1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 4, 529.0, "Bridge!E1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 5, 377.0, "Bridge!F1 spill");

    // Consumer A1 = TRANSPOSE of Bridge's horizontal spill → back to vertical
    // A1 should be 197 (first element)
    assert_mirror_number(
        &mirror,
        &consumer_a1,
        197.0,
        "Consumer!A1 chained TRANSPOSE source",
    );

    // Consumer spill targets: A2=448, A3=475, A4=529, A5=377
    assert_col_data_number(&mirror, &sid2, 1, 0, 448.0, "Consumer!A2 chained spill");
    assert_col_data_number(&mirror, &sid2, 2, 0, 475.0, "Consumer!A3 chained spill");
    assert_col_data_number(&mirror, &sid2, 3, 0, 529.0, "Consumer!A4 chained spill");
    assert_col_data_number(&mirror, &sid2, 4, 0, 377.0, "Consumer!A5 chained spill");
}

/// R3: IF formula reading from chained TRANSPOSE spill target.
///
/// Reproduces the Forecasted Cohort pattern:
///   Sheet "Source": A1:A5 = [197, 448, 475, 529, 377]
///   Sheet "Bridge": B1 = TRANSPOSE(Source!A1:A5) → B1:F1 = [197,448,475,529,377]
///   Sheet "Forecast":
///     D1 = TRANSPOSE(Bridge!B1:F1) → D1:D5 = [197,448,475,529,377]
///     E1 = IF($D1>0, $D1*2, 0)  → 197*2 = 394  (reads TRANSPOSE anchor)
///     E2 = IF($D2>0, $D2*2, 0)  → 448*2 = 896  (reads spill target D2)
///     E3 = IF($D3>0, $D3*2, 0)  → 475*2 = 950  (reads spill target D3)
///
/// The bug: D2:D5 are null because chained TRANSPOSE doesn't spill.
/// IF(null>0) = false → returns 0 instead of 896/950.
#[test]
fn test_xlsx_repro_if_reads_chained_transpose_spill() {
    let snapshot = build_snapshot(vec![
        // Sheet 0: "Source"
        (
            "Source",
            10,
            10,
            vec![
                (0, 0, CellValue::number(197.0), None),
                (1, 0, CellValue::number(448.0), None),
                (2, 0, CellValue::number(475.0), None),
                (3, 0, CellValue::number(529.0), None),
                (4, 0, CellValue::number(377.0), None),
            ],
        ),
        // Sheet 1: "Bridge" — horizontal TRANSPOSE
        (
            "Bridge",
            10,
            10,
            vec![(0, 1, CellValue::Null, Some("TRANSPOSE(Source!A1:A5)"))],
        ),
        // Sheet 2: "Forecast" — chained TRANSPOSE back to vertical + IF formulas
        (
            "Forecast",
            10,
            10,
            vec![
                // D1 = TRANSPOSE(Bridge!B1:F1) → should spill D1:D5
                (0, 3, CellValue::Null, Some("TRANSPOSE(Bridge!B1:F1)")),
                // E1:E5 = IF($D>0, $D*2, 0) — reads from D column (TRANSPOSE spill)
                (0, 4, CellValue::Null, Some("IF($D1>0,$D1*2,0)")),
                (1, 4, CellValue::Null, Some("IF($D2>0,$D2*2,0)")),
                (2, 4, CellValue::Null, Some("IF($D3>0,$D3*2,0)")),
                (3, 4, CellValue::Null, Some("IF($D4>0,$D4*2,0)")),
                (4, 4, CellValue::Null, Some("IF($D5>0,$D5*2,0)")),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid2 = SheetId::from_uuid_str(&sheet_uuid(2)).expect("sid Forecast");
    let d1 = CellId::from_uuid_str(&cell_uuid(2, 0, 3)).expect("d1");
    let e1 = CellId::from_uuid_str(&cell_uuid(2, 0, 4)).expect("e1");
    let e2 = CellId::from_uuid_str(&cell_uuid(2, 1, 4)).expect("e2");
    let e3 = CellId::from_uuid_str(&cell_uuid(2, 2, 4)).expect("e3");
    let e4 = CellId::from_uuid_str(&cell_uuid(2, 3, 4)).expect("e4");
    let e5 = CellId::from_uuid_str(&cell_uuid(2, 4, 4)).expect("e5");

    // D1 = TRANSPOSE anchor = 197
    assert_mirror_number(&mirror, &d1, 197.0, "Forecast!D1 TRANSPOSE source");

    // D column spill targets
    assert_col_data_number(&mirror, &sid2, 1, 3, 448.0, "Forecast!D2 spill");
    assert_col_data_number(&mirror, &sid2, 2, 3, 475.0, "Forecast!D3 spill");
    assert_col_data_number(&mirror, &sid2, 3, 3, 529.0, "Forecast!D4 spill");
    assert_col_data_number(&mirror, &sid2, 4, 3, 377.0, "Forecast!D5 spill");

    // IF formulas should read from D column spill targets
    // E1 = IF(197>0, 197*2, 0) = 394
    assert_mirror_number(&mirror, &e1, 394.0, "Forecast!E1 IF reads TRANSPOSE anchor");
    // E2 = IF(448>0, 448*2, 0) = 896
    assert_mirror_number(&mirror, &e2, 896.0, "Forecast!E2 IF reads spill target D2");
    // E3 = IF(475>0, 475*2, 0) = 950
    assert_mirror_number(&mirror, &e3, 950.0, "Forecast!E3 IF reads spill target D3");
    // E4 = IF(529>0, 529*2, 0) = 1058
    assert_mirror_number(&mirror, &e4, 1058.0, "Forecast!E4 IF reads spill target D4");
    // E5 = IF(377>0, 377*2, 0) = 754
    assert_mirror_number(&mirror, &e5, 754.0, "Forecast!E5 IF reads spill target D5");
}

/// R4: Full cascade — 4 sheets, TRANSPOSE → SUM → TRANSPOSE → IF.
///
/// This reproduces the complete 4-layer cascade from the XLSX file:
///   Sheet "Monthly":  C1:C5 = [0, 0, 1, 7, 192]           (cohort data)
///   Sheet "Annual":   C1:C5 = [197, 448, 475, 529, 377]    (cohort data)
///   Sheet "Rev Build":
///     B1 = TRANSPOSE(Monthly!C1:C5) → spill B1:F1          (horizontal)
///     B2 = TRANSPOSE(Annual!C1:C5)  → spill B2:F2          (horizontal)
///     B3 = SUM(B1:B2), C3=SUM(C1:C2), D3=SUM(D1:D2), ...  (column sums)
///   Sheet "Forecast":
///     A1 = TRANSPOSE('Rev Build'!B2:F2) → spill A1:A5      (back to vertical)
///     B1 = IF($A1>0, $A1*2, 0)                              (reads anchor)
///     B2 = IF($A2>0, $A2*2, 0)                              (reads spill target)
///
/// In the XLSX: this entire chain fails because the first TRANSPOSE
/// doesn't spill, cascading nulls through 25,000+ downstream cells.
#[test]
fn test_xlsx_repro_full_four_sheet_cascade() {
    let snapshot = build_snapshot(vec![
        // Sheet 0: "Monthly"
        (
            "Monthly",
            10,
            10,
            vec![
                (0, 2, CellValue::number(0.0), None),
                (1, 2, CellValue::number(0.0), None),
                (2, 2, CellValue::number(1.0), None),
                (3, 2, CellValue::number(7.0), None),
                (4, 2, CellValue::number(192.0), None),
            ],
        ),
        // Sheet 1: "Annual"
        (
            "Annual",
            10,
            10,
            vec![
                (0, 2, CellValue::number(197.0), None),
                (1, 2, CellValue::number(448.0), None),
                (2, 2, CellValue::number(475.0), None),
                (3, 2, CellValue::number(529.0), None),
                (4, 2, CellValue::number(377.0), None),
            ],
        ),
        // Sheet 2: "Rev Build" — two TRANSPOSEs + SUM row
        (
            "Rev Build",
            10,
            10,
            vec![
                (0, 1, CellValue::Null, Some("TRANSPOSE(Monthly!C1:C5)")), // B1
                (1, 1, CellValue::Null, Some("TRANSPOSE(Annual!C1:C5)")),  // B2
                (2, 1, CellValue::Null, Some("SUM(B1:B2)")),               // B3
                (2, 2, CellValue::Null, Some("SUM(C1:C2)")),               // C3
                (2, 3, CellValue::Null, Some("SUM(D1:D2)")),               // D3
                (2, 4, CellValue::Null, Some("SUM(E1:E2)")),               // E3
                (2, 5, CellValue::Null, Some("SUM(F1:F2)")),               // F3
            ],
        ),
        // Sheet 3: "Forecast" — chained TRANSPOSE + IF
        (
            "Forecast",
            10,
            10,
            vec![
                // A1 = TRANSPOSE('Rev Build'!B2:F2) → vertical A1:A5
                (0, 0, CellValue::Null, Some("TRANSPOSE('Rev Build'!B2:F2)")),
                // B column: IF formulas reading from A column (spill targets)
                (0, 1, CellValue::Null, Some("IF($A1>0,$A1*2,0)")),
                (1, 1, CellValue::Null, Some("IF($A2>0,$A2*2,0)")),
                (2, 1, CellValue::Null, Some("IF($A3>0,$A3*2,0)")),
                (3, 1, CellValue::Null, Some("IF($A4>0,$A4*2,0)")),
                (4, 1, CellValue::Null, Some("IF($A5>0,$A5*2,0)")),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid2 = SheetId::from_uuid_str(&sheet_uuid(2)).expect("sid Rev Build");
    let sid3 = SheetId::from_uuid_str(&sheet_uuid(3)).expect("sid Forecast");

    // === Rev Build assertions ===
    let rb_b1 = CellId::from_uuid_str(&cell_uuid(2, 0, 1)).expect("rb b1");
    let rb_b2 = CellId::from_uuid_str(&cell_uuid(2, 1, 1)).expect("rb b2");
    let rb_b3 = CellId::from_uuid_str(&cell_uuid(2, 2, 1)).expect("rb b3");
    let rb_c3 = CellId::from_uuid_str(&cell_uuid(2, 2, 2)).expect("rb c3");
    let rb_d3 = CellId::from_uuid_str(&cell_uuid(2, 2, 3)).expect("rb d3");

    // TRANSPOSE anchors
    assert_mirror_number(
        &mirror,
        &rb_b1,
        0.0,
        "Rev Build!B1 Monthly TRANSPOSE anchor",
    );
    assert_mirror_number(
        &mirror,
        &rb_b2,
        197.0,
        "Rev Build!B2 Annual TRANSPOSE anchor",
    );

    // Rev Build spill — Annual row (row 1): C2=448, D2=475, E2=529, F2=377
    assert_col_data_number(&mirror, &sid2, 1, 2, 448.0, "Rev Build!C2 Annual spill");
    assert_col_data_number(&mirror, &sid2, 1, 3, 475.0, "Rev Build!D2 Annual spill");
    assert_col_data_number(&mirror, &sid2, 1, 4, 529.0, "Rev Build!E2 Annual spill");
    assert_col_data_number(&mirror, &sid2, 1, 5, 377.0, "Rev Build!F2 Annual spill");

    // SUM row
    assert_mirror_number(&mirror, &rb_b3, 197.0, "Rev Build!B3 SUM");
    assert_mirror_number(&mirror, &rb_c3, 448.0, "Rev Build!C3 SUM");
    assert_mirror_number(&mirror, &rb_d3, 476.0, "Rev Build!D3 SUM");

    // === Forecast assertions ===
    let fc_a1 = CellId::from_uuid_str(&cell_uuid(3, 0, 0)).expect("fc a1");
    let fc_b1 = CellId::from_uuid_str(&cell_uuid(3, 0, 1)).expect("fc b1");
    let fc_b2 = CellId::from_uuid_str(&cell_uuid(3, 1, 1)).expect("fc b2");
    let fc_b3 = CellId::from_uuid_str(&cell_uuid(3, 2, 1)).expect("fc b3");

    // Forecast!A1 = chained TRANSPOSE anchor (first value from Annual row = 197)
    assert_mirror_number(
        &mirror,
        &fc_a1,
        197.0,
        "Forecast!A1 chained TRANSPOSE anchor",
    );

    // Forecast spill targets: A2=448, A3=475, A4=529, A5=377
    assert_col_data_number(&mirror, &sid3, 1, 0, 448.0, "Forecast!A2 chained spill");
    assert_col_data_number(&mirror, &sid3, 2, 0, 475.0, "Forecast!A3 chained spill");
    assert_col_data_number(&mirror, &sid3, 3, 0, 529.0, "Forecast!A4 chained spill");
    assert_col_data_number(&mirror, &sid3, 4, 0, 377.0, "Forecast!A5 chained spill");

    // IF formulas
    assert_mirror_number(&mirror, &fc_b1, 394.0, "Forecast!B1 IF(A1>0)"); // 197*2
    assert_mirror_number(&mirror, &fc_b2, 896.0, "Forecast!B2 IF(A2>0)"); // 448*2
    assert_mirror_number(&mirror, &fc_b3, 950.0, "Forecast!B3 IF(A3>0)"); // 475*2
}

/// R5: INDEX reading from TRANSPOSE spill targets — the Rev Build row 51 pattern.
///
/// In the XLSX:
///   "Forecast"!D5 = TRANSPOSE(...) → spills D5:D29
///   "Rev Build"!S51 = INDEX('Forecast'!$D:$D, 8)
///     → should return D8 (a spill target from the TRANSPOSE above)
///
/// The bug: D8 is null because TRANSPOSE didn't spill, so INDEX returns null.
#[test]
fn test_xlsx_repro_index_reads_transpose_spill() {
    let snapshot = build_snapshot(vec![
        // Sheet 0: "Source" — horizontal data
        (
            "Source",
            10,
            10,
            vec![
                (0, 0, CellValue::number(10.0), None), // A1
                (0, 1, CellValue::number(20.0), None), // B1
                (0, 2, CellValue::number(30.0), None), // C1
                (0, 3, CellValue::number(40.0), None), // D1
                (0, 4, CellValue::number(50.0), None), // E1
            ],
        ),
        // Sheet 1: "Forecast" — TRANSPOSE(horizontal) → vertical spill in column A
        (
            "Forecast",
            10,
            10,
            vec![
                // A1 = TRANSPOSE(Source!A1:E1) → vertical spill A1:A5 = [10,20,30,40,50]
                (0, 0, CellValue::Null, Some("TRANSPOSE(Source!A1:E1)")),
            ],
        ),
        // Sheet 2: "Rev Build" — INDEX reading from Forecast's column A (spill targets)
        (
            "Rev Build",
            10,
            10,
            vec![
                // A1 = INDEX(Forecast!$A:$A, 1) → should be 10 (anchor)
                (0, 0, CellValue::Null, Some("INDEX(Forecast!$A:$A,1)")),
                // A2 = INDEX(Forecast!$A:$A, 2) → should be 20 (spill target)
                (1, 0, CellValue::Null, Some("INDEX(Forecast!$A:$A,2)")),
                // A3 = INDEX(Forecast!$A:$A, 3) → should be 30 (spill target)
                (2, 0, CellValue::Null, Some("INDEX(Forecast!$A:$A,3)")),
                // A4 = INDEX(Forecast!$A:$A, 4) → should be 40 (spill target)
                (3, 0, CellValue::Null, Some("INDEX(Forecast!$A:$A,4)")),
                // A5 = INDEX(Forecast!$A:$A, 5) → should be 50 (spill target)
                (4, 0, CellValue::Null, Some("INDEX(Forecast!$A:$A,5)")),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid1 = SheetId::from_uuid_str(&sheet_uuid(1)).expect("sid Forecast");
    let _sid2 = SheetId::from_uuid_str(&sheet_uuid(2)).expect("sid Rev Build");

    // Forecast!A1 = TRANSPOSE anchor = 10
    let fc_a1 = CellId::from_uuid_str(&cell_uuid(1, 0, 0)).expect("fc a1");
    assert_mirror_number(&mirror, &fc_a1, 10.0, "Forecast!A1 TRANSPOSE anchor");

    // Forecast spill: A2=20, A3=30, A4=40, A5=50
    assert_col_data_number(&mirror, &sid1, 1, 0, 20.0, "Forecast!A2 spill");
    assert_col_data_number(&mirror, &sid1, 2, 0, 30.0, "Forecast!A3 spill");
    assert_col_data_number(&mirror, &sid1, 3, 0, 40.0, "Forecast!A4 spill");
    assert_col_data_number(&mirror, &sid1, 4, 0, 50.0, "Forecast!A5 spill");

    // Rev Build!A1:A5 = INDEX reads from Forecast spill targets
    let rb_a1 = CellId::from_uuid_str(&cell_uuid(2, 0, 0)).expect("rb a1");
    let rb_a2 = CellId::from_uuid_str(&cell_uuid(2, 1, 0)).expect("rb a2");
    let rb_a3 = CellId::from_uuid_str(&cell_uuid(2, 2, 0)).expect("rb a3");
    let rb_a4 = CellId::from_uuid_str(&cell_uuid(2, 3, 0)).expect("rb a4");
    let rb_a5 = CellId::from_uuid_str(&cell_uuid(2, 4, 0)).expect("rb a5");

    assert_mirror_number(&mirror, &rb_a1, 10.0, "Rev Build!A1 INDEX(A:A,1)");
    assert_mirror_number(&mirror, &rb_a2, 20.0, "Rev Build!A2 INDEX(A:A,2)");
    assert_mirror_number(&mirror, &rb_a3, 30.0, "Rev Build!A3 INDEX(A:A,3)");
    assert_mirror_number(&mirror, &rb_a4, 40.0, "Rev Build!A4 INDEX(A:A,4)");
    assert_mirror_number(&mirror, &rb_a5, 50.0, "Rev Build!A5 INDEX(A:A,5)");
}

/// R6: SUMIFS reading from TRANSPOSE spill targets with date criteria.
///
/// Reproduces the Rev Build SUMIFS pattern:
///   Row 2: date headers (col B through F)
///   Row 0: B1 = TRANSPOSE(...) → spill B1:F1 (monthly values)
///   Row 1: B2 = TRANSPOSE(...) → spill B2:F2 (annual values)
///   Row 3: SUM(B1:B2), SUM(C1:C2), etc.
///   Row 4: SUMIFS($B3:$F3, $B$4:$F$4, ">some_date", $B$4:$F$4, "<="&another_date)
///
/// Simplified: just test that SUMIFS over a range with TRANSPOSE spill targets works.
#[test]
fn test_xlsx_repro_sumifs_over_transpose_spill() {
    let snapshot = build_snapshot(vec![
        // Sheet 0: "Source"
        (
            "Source",
            10,
            10,
            vec![
                (0, 0, CellValue::number(100.0), None), // A1
                (1, 0, CellValue::number(200.0), None), // A2
                (2, 0, CellValue::number(300.0), None), // A3
            ],
        ),
        // Sheet 1: "Main" — TRANSPOSE + SUMIFS
        (
            "Main",
            10,
            10,
            vec![
                // Row 0: TRANSPOSE anchor at B1
                (0, 1, CellValue::Null, Some("TRANSPOSE(Source!A1:A3)")), // B1 → B1:D1 = [100,200,300]
                // Row 1: category labels
                (1, 1, CellValue::Text("X".into()), None), // B2 = "X"
                (1, 2, CellValue::Text("Y".into()), None), // C2 = "Y"
                (1, 3, CellValue::Text("X".into()), None), // D2 = "X"
                // Row 2: SUMIFS — sum B1:D1 where B2:D2 = "X"
                // Should sum B1(100) + D1(300) = 400 (where label="X")
                (2, 1, CellValue::Null, Some("SUMIFS(B1:D1,B2:D2,\"X\")")),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid1 = SheetId::from_uuid_str(&sheet_uuid(1)).expect("sid Main");

    // Verify spill
    let b1 = CellId::from_uuid_str(&cell_uuid(1, 0, 1)).expect("b1");
    assert_mirror_number(&mirror, &b1, 100.0, "Main!B1 TRANSPOSE anchor");
    assert_col_data_number(&mirror, &sid1, 0, 2, 200.0, "Main!C1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 3, 300.0, "Main!D1 spill");

    // SUMIFS(B1:D1, B2:D2, "X") = 100 + 300 = 400
    let b3 = CellId::from_uuid_str(&cell_uuid(1, 2, 1)).expect("b3");
    assert_mirror_number(&mirror, &b3, 400.0, "Main!B3 SUMIFS over TRANSPOSE spill");
}
