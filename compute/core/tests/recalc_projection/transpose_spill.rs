use super::*;

/// Test 1: TRANSPOSE horizontal spill via interactive path (set_cell).
///
/// Setup: A1:A5 = [10,20,30,40,50], then B1 = TRANSPOSE(A1:A5)
/// Expected: B1=10, C1=20, D1=30, E1=40, F1=50 (horizontal spill)
#[test]
fn test_transpose_horizontal_spill_interactive() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (3, 0, CellValue::number(40.0), None),
            (4, 0, CellValue::number(50.0), None),
            (0, 1, CellValue::Null, None), // B1 placeholder
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");

    // Set B1 = TRANSPOSE(A1:A5) — should spill horizontally into C1:F1
    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=TRANSPOSE(A1:A5)")
        .expect("set B1");

    // Source cell should have the first value
    assert_mirror_number(&mirror, &b1, 10.0, "B1 TRANSPOSE source");

    // Spill targets: C1=20, D1=30, E1=40, F1=50
    assert_col_data_number(&mirror, &sid, 0, 2, 20.0, "C1 spill target");
    assert_col_data_number(&mirror, &sid, 0, 3, 30.0, "D1 spill target");
    assert_col_data_number(&mirror, &sid, 0, 4, 40.0, "E1 spill target");
    assert_col_data_number(&mirror, &sid, 0, 5, 50.0, "F1 spill target");
}

/// H2: TRANSPOSE of a horizontal range (1×N) produces a vertical spill (N×1).
///
/// TRANSPOSE(A1:E1) where A1:E1 is 1 row × 5 cols → produces 5 rows × 1 col.
/// This is the OPPOSITE direction from TRANSPOSE(A1:A5).
#[test]
fn test_transpose_vertical_spill_from_horizontal_input() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            // Horizontal source data: A1=10, B1=20, C1=30, D1=40, E1=50
            (0, 0, CellValue::number(10.0), None),
            (0, 1, CellValue::number(20.0), None),
            (0, 2, CellValue::number(30.0), None),
            (0, 3, CellValue::number(40.0), None),
            (0, 4, CellValue::number(50.0), None),
            (1, 5, CellValue::Null, None), // F2 placeholder for TRANSPOSE anchor
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let f2 = CellId::from_uuid_str(&cell_uuid(0, 1, 5)).expect("f2");

    // F2 = TRANSPOSE(A1:E1) → should spill VERTICALLY into F2:F6 (5 rows × 1 col)
    core.set_cell(&mut mirror, &sid, f2, 1, 5, "=TRANSPOSE(A1:E1)")
        .expect("set F2");

    // Source cell = first transposed value (10)
    assert_mirror_number(&mirror, &f2, 10.0, "F2 TRANSPOSE source");

    // Vertical spill: F3=20, F4=30, F5=40, F6=50 (all in column 5)
    assert_col_data_number(&mirror, &sid, 2, 5, 20.0, "F3 vertical spill");
    assert_col_data_number(&mirror, &sid, 3, 5, 30.0, "F4 vertical spill");
    assert_col_data_number(&mirror, &sid, 4, 5, 40.0, "F5 vertical spill");
    assert_col_data_number(&mirror, &sid, 5, 5, 50.0, "F6 vertical spill");
}

/// H3: col_data at TRANSPOSE source cell stores scalar, not CellValue::Array.
///
/// After TRANSPOSE evaluates, level_eval.rs calls:
///   set_value_mut(cell, top_left)  →  writes scalar to col_data
///   set_entry_value_only(cell, Array)  →  writes Array to entry.value only
/// Bug hypothesis: something overwrites col_data[source] with the full Array.
#[test]
fn test_transpose_source_col_data_is_scalar() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (0, 1, CellValue::Null, None), // B1 placeholder
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");

    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=TRANSPOSE(A1:A3)")
        .expect("set B1");

    // get_cell_value should return scalar (top-left unwrapped)
    assert_mirror_number(&mirror, &b1, 10.0, "B1 get_cell_value");

    // col_data[B1] should be scalar Number(10), NOT CellValue::Array
    let sheet_mirror = &mirror.get_sheet(&sid).expect("sheet");
    let col_b = sheet_mirror.get_column_slice(1).expect("col_data for B");
    match &col_b[0] {
        CellValue::Number(n) => assert!(
            (n.get() - 10.0).abs() < 1e-6,
            "col_data[B1] should be scalar 10, got {}",
            n.get()
        ),
        CellValue::Array(_) => {
            panic!("BUG: col_data[B1] is CellValue::Array — should be scalar Number(10)")
        }
        other => panic!("col_data[B1] unexpected: {:?}", other),
    }
}

/// H4: Simple formula referencing a spill target cell (no range, no SUM).
///
/// After TRANSPOSE spills, a formula like =C1+1 should read the spilled value.
/// This avoids the range store entirely — isolates col_data read from formula eval.
#[test]
fn test_transpose_spill_target_read_by_simple_formula() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (0, 1, CellValue::Null, None), // B1 placeholder
            (0, 6, CellValue::Null, None), // G1 placeholder
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    // B1 = TRANSPOSE(A1:A3) → B1=10, C1=20, D1=30
    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=TRANSPOSE(A1:A3)")
        .expect("set B1");
    // G1 = C1+D1  (reads individual spill targets, no range)
    core.set_cell(&mut mirror, &sid, g1, 0, 6, "=C1+D1")
        .expect("set G1");

    // C1+D1 = 20+30 = 50
    assert_mirror_number(&mirror, &g1, 50.0, "G1 = C1+D1 (spill target reads)");
}

/// H5a: SUM over TRANSPOSE spill — SMALL horizontal spill (1×2).
///
/// Minimal reproducer: TRANSPOSE(A1:A2) → B1=10, C1=20.
/// Then SUM(B1:C1) = 30. This is a multi-column range through range_store.
#[test]
fn test_transpose_small_spill_with_sum_interactive() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (0, 1, CellValue::Null, None), // B1 placeholder
            (0, 3, CellValue::Null, None), // D1 placeholder for SUM
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let d1 = CellId::from_uuid_str(&cell_uuid(0, 0, 3)).expect("d1");

    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=TRANSPOSE(A1:A2)")
        .expect("set B1");
    core.set_cell(&mut mirror, &sid, d1, 0, 3, "=SUM(B1:C1)")
        .expect("set D1");

    // SUM(B1:C1) = 10+20 = 30
    assert_mirror_number(&mirror, &d1, 30.0, "D1 SUM(B1:C1) small spill");
}

/// H5b: SUM over TRANSPOSE horizontal spill — full 1×5 — via sequential set_cell.
///
/// This is the original crashing test. Kept to track the range_store overflow bug.
/// If this panics with "attempt to subtract with overflow", the bug is in
/// range_store::materialize_range when handling a multi-column range over spill targets.
#[test]
fn test_transpose_spill_with_sum_interactive() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (3, 0, CellValue::number(40.0), None),
            (4, 0, CellValue::number(50.0), None),
            (0, 1, CellValue::Null, None), // B1 placeholder
            (0, 6, CellValue::Null, None), // G1 placeholder for SUM
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=TRANSPOSE(A1:A5)")
        .expect("set B1");
    core.set_cell(&mut mirror, &sid, g1, 0, 6, "=SUM(B1:F1)")
        .expect("set G1");

    // SUM(B1:F1) = 10+20+30+40+50 = 150
    assert_mirror_number(&mirror, &g1, 150.0, "G1 SUM over TRANSPOSE spill");
}

/// H5c: SUM over TRANSPOSE horizontal spill — via set_cells batch (single recalc).
///
/// Both TRANSPOSE and SUM set in one set_cells call, triggering a single recalc pass.
/// If H5b crashes but this passes, the bug is specific to the sequential set_cell path
/// (two separate recalcs where the second one has stale range_store state).
#[test]
fn test_transpose_spill_with_sum_batch() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (3, 0, CellValue::number(40.0), None),
            (4, 0, CellValue::number(50.0), None),
            (0, 1, CellValue::Null, None), // B1 placeholder
            (0, 6, CellValue::Null, None), // G1 placeholder for SUM
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    // Both formulas in a single set_cells call
    use compute_core::bridge_types::CellInput;
    core.set_cells(
        &mut mirror,
        &[
            (
                sid,
                b1,
                0,
                1,
                CellInput::Parse {
                    text: "=TRANSPOSE(A1:A5)".to_string(),
                },
            ),
            (
                sid,
                g1,
                0,
                6,
                CellInput::Parse {
                    text: "=SUM(B1:F1)".to_string(),
                },
            ),
        ],
        false,
    )
    .expect("set_cells");

    assert_mirror_number(&mirror, &b1, 10.0, "B1 TRANSPOSE source (batch)");
    assert_mirror_number(&mirror, &g1, 150.0, "G1 SUM over TRANSPOSE spill (batch)");
}

/// H5d: SUM over a single-column that includes a TRANSPOSE spill target.
///
/// TRANSPOSE(A1:A3) → B1=10, C1=20, D1=30 (horizontal spill).
/// SUM(B1:B3) — single-column range in col B — hits Tier 1 in range_store, not Tier 2.
/// If H5b crashes but this passes, the bug is specific to multi-column range materialization.
#[test]
fn test_transpose_spill_sum_single_column_range() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (0, 1, CellValue::Null, None),          // B1 placeholder
            (1, 1, CellValue::number(100.0), None), // B2 = 100
            (2, 1, CellValue::number(200.0), None), // B3 = 200
            (0, 4, CellValue::Null, None),          // E1 placeholder for SUM
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let e1 = CellId::from_uuid_str(&cell_uuid(0, 0, 4)).expect("e1");

    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=TRANSPOSE(A1:A3)")
        .expect("set B1");
    // SUM(B1:B3) is a single-column range: B1=10 (source scalar), B2=100, B3=200
    core.set_cell(&mut mirror, &sid, e1, 0, 4, "=SUM(B1:B3)")
        .expect("set E1");

    // SUM(B1:B3) = 10 + 100 + 200 = 310
    assert_mirror_number(
        &mirror,
        &e1,
        310.0,
        "E1 SUM(B1:B3) single-column over spill source",
    );
}

/// Test 3: TRANSPOSE + SUM both present in initial snapshot (no array_ref).
///
/// Both formulas loaded at init. Tests evaluation ordering.
#[test]
fn test_transpose_spill_with_sum_in_snapshot() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (3, 0, CellValue::number(40.0), None),
            (4, 0, CellValue::number(50.0), None),
            // B1 has the TRANSPOSE formula
            (0, 1, CellValue::Null, Some("TRANSPOSE(A1:A5)")),
            // G1 has the SUM formula over the spill range
            (0, 6, CellValue::Null, Some("SUM(B1:F1)")),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    // B1 should be the first transposed value
    assert_mirror_number(&mirror, &b1, 10.0, "B1 TRANSPOSE source");

    // Spill targets
    assert_col_data_number(&mirror, &sid, 0, 2, 20.0, "C1 spill target");
    assert_col_data_number(&mirror, &sid, 0, 3, 30.0, "D1 spill target");
    assert_col_data_number(&mirror, &sid, 0, 4, 40.0, "E1 spill target");
    assert_col_data_number(&mirror, &sid, 0, 5, 50.0, "F1 spill target");

    // SUM should read the spilled values
    assert_mirror_number(&mirror, &g1, 150.0, "G1 SUM over TRANSPOSE spill");
}

/// Test 4: TRANSPOSE with array_ref in snapshot — the XLSX pre-registration path.
///
/// This is the exact scenario from the bYbEjX4h file: TRANSPOSE formula has
/// array_ref="B1:F1" which causes projection pre-registration during snapshot
/// loading. The hypothesis is that pre-registration prevents delta emission,
/// which prevents stabilization of dependent formulas like SUM.
#[test]
fn test_transpose_spill_with_array_ref_preregistration() {
    let snapshot = build_snapshot_with_array_ref(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None, None),
            (1, 0, CellValue::number(20.0), None, None),
            (2, 0, CellValue::number(30.0), None, None),
            (3, 0, CellValue::number(40.0), None, None),
            (4, 0, CellValue::number(50.0), None, None),
            // B1: TRANSPOSE formula with array_ref (triggers pre-registration)
            (
                0,
                1,
                CellValue::number(10.0),
                Some("TRANSPOSE(A1:A5)"),
                Some("B1:F1"),
            ),
            // G1: SUM over the spill range
            (0, 6, CellValue::Null, Some("SUM(B1:F1)"), None),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    // B1 source: should be scalar 10
    assert_mirror_number(&mirror, &b1, 10.0, "B1 TRANSPOSE source (pre-reg)");

    // col_data[B1] should be scalar 10, NOT the full Array
    let sheet_mirror = &mirror.get_sheet(&sid).expect("sheet");
    let col_b = sheet_mirror.get_column_slice(1).expect("col_data for B");
    match &col_b[0] {
        CellValue::Number(n) => assert!(
            (n.get() - 10.0).abs() < 1e-6,
            "B1 col_data should be scalar 10, got {}",
            n.get()
        ),
        other => panic!("B1 col_data should be Number(10), got {:?}", other),
    }

    // Spill targets must be materialized in col_data
    assert_col_data_number(&mirror, &sid, 0, 2, 20.0, "C1 spill (pre-reg)");
    assert_col_data_number(&mirror, &sid, 0, 3, 30.0, "D1 spill (pre-reg)");
    assert_col_data_number(&mirror, &sid, 0, 4, 40.0, "E1 spill (pre-reg)");
    assert_col_data_number(&mirror, &sid, 0, 5, 50.0, "F1 spill (pre-reg)");

    // SUM must read the spilled values correctly
    assert_mirror_number(&mirror, &g1, 150.0, "G1 SUM (pre-reg path)");
}
