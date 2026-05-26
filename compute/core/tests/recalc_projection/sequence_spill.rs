use super::*;

#[test]
fn test_sequence_spill_with_sum_interactive() {
    let a1_str = cell_uuid(0, 0, 0);
    let b1_str = cell_uuid(0, 0, 1);
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![(0, 0, CellValue::Null, None), (0, 1, CellValue::Null, None)],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("parse sheet uuid");
    let a1_id = CellId::from_uuid_str(&a1_str).expect("parse cell uuid");
    let b1_id = CellId::from_uuid_str(&b1_str).expect("parse cell uuid");
    let result = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(10)")
        .expect("set A1");
    println!(
        "changed_cells: {} projection_changes: {}",
        result.changed_cells.len(),
        result.projection_changes.len()
    );
    assert_mirror_number(&mirror, &a1_id, 1.0, "A1 after SEQUENCE(10)");
    // Check projected values via col_data (no phantom CellIds)
    for row in 1..10u32 {
        assert_col_data_number(
            &mirror,
            &sheet_id,
            row,
            0,
            (row + 1) as f64,
            &format!("A{} projected", row + 1),
        );
    }
    let _r2 = core
        .set_cell(&mut mirror, &sheet_id, b1_id, 0, 1, "=SUM(A1:A10)")
        .expect("set B1");
    assert_mirror_number(&mirror, &b1_id, 55.0, "B1 SUM(A1:A10)");
}

#[test]
fn test_sequence_spill_partial_recalc_updates_sum() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![(0, 0, CellValue::Null, None), (0, 1, CellValue::Null, None)],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a1_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let b1_id = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .expect("set A1");
    core.set_cell(&mut mirror, &sheet_id, b1_id, 0, 1, "=SUM(A1:A5)")
        .expect("set B1");
    assert_mirror_number(&mirror, &b1_id, 15.0, "B1 initial SUM");
    // Change to SEQUENCE(5,1,10,10) -- spills 10,20,30,40,50
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5,1,10,10)")
        .expect("change A1");
    assert_mirror_number(&mirror, &a1_id, 10.0, "A1 after change");
    for row in 1..5u32 {
        let expected = (row + 1) as f64 * 10.0;
        assert_col_data_number(
            &mirror,
            &sheet_id,
            row,
            0,
            expected,
            &format!("A{}", row + 1),
        );
    }
    assert_mirror_number(&mirror, &b1_id, 150.0, "B1 after SEQUENCE change");
}

#[test]
fn test_spill_and_sum_in_initial_snapshot() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Null, Some("SEQUENCE(10)")),
            (0, 1, CellValue::Null, Some("SUM(A1:A10)")),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    println!(
        "changed: {} spill: {} errors: {}",
        result.changed_cells.len(),
        result.projection_changes.len(),
        result.errors.len()
    );
    let a1_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let b1_id = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    assert_mirror_number(&mirror, &a1_id, 1.0, "A1 SEQUENCE source");
    let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    // Check projected values via col_data (no phantom CellIds)
    for row in 1..10u32 {
        assert_col_data_number(
            &mirror,
            &sheet_id,
            row,
            0,
            (row + 1) as f64,
            &format!("A{} projected", row + 1),
        );
    }
    assert_mirror_number(&mirror, &b1_id, 55.0, "B1 SUM(A1:A10) over spill");
}

#[test]
fn test_multiple_aggregates_over_spill_column() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Null, None),
            (0, 1, CellValue::Null, None),
            (1, 1, CellValue::Null, None),
            (2, 1, CellValue::Null, None),
            (3, 1, CellValue::Null, None),
            (4, 1, CellValue::Null, None),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a1 = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let b2 = CellId::from_uuid_str(&cell_uuid(0, 1, 1)).expect("b2");
    let b3 = CellId::from_uuid_str(&cell_uuid(0, 2, 1)).expect("b3");
    let b4 = CellId::from_uuid_str(&cell_uuid(0, 3, 1)).expect("b4");
    let b5 = CellId::from_uuid_str(&cell_uuid(0, 4, 1)).expect("b5");
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(10)")
        .expect("set A1");
    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=SUM(A1:A10)")
        .expect("set B1");
    core.set_cell(&mut mirror, &sid, b2, 1, 1, "=AVERAGE(A1:A10)")
        .expect("set B2");
    core.set_cell(&mut mirror, &sid, b3, 2, 1, "=COUNT(A1:A10)")
        .expect("set B3");
    core.set_cell(&mut mirror, &sid, b4, 3, 1, "=MIN(A1:A10)")
        .expect("set B4");
    core.set_cell(&mut mirror, &sid, b5, 4, 1, "=MAX(A1:A10)")
        .expect("set B5");
    assert_mirror_number(&mirror, &b1, 55.0, "SUM");
    assert_mirror_number(&mirror, &b2, 5.5, "AVERAGE");
    assert_mirror_number(&mirror, &b3, 10.0, "COUNT");
    assert_mirror_number(&mirror, &b4, 1.0, "MIN");
    assert_mirror_number(&mirror, &b5, 10.0, "MAX");
}

/// SEQUENCE(5,3): A1=1 B1=2 C1=3 / A2=4 B2=5 C2=6 / ... / A5=13 B5=14 C5=15
#[test]
fn test_2d_spill_sum_on_phantom_column() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Null, None),
            (0, 3, CellValue::Null, None),
            (1, 3, CellValue::Null, None),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a1 = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let d1 = CellId::from_uuid_str(&cell_uuid(0, 0, 3)).expect("d1");
    let d2 = CellId::from_uuid_str(&cell_uuid(0, 1, 3)).expect("d2");
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(5,3)")
        .expect("set A1");
    assert_mirror_number(&mirror, &a1, 1.0, "A1 source");
    // Check projected values via col_data (no phantom CellIds)
    let eb = [2.0, 5.0, 8.0, 11.0, 14.0];
    for (row, exp) in eb.iter().enumerate() {
        let r = row as u32;
        assert_col_data_number(&mirror, &sid, r, 1, *exp, &format!("B{}", r + 1));
    }
    let ec = [3.0, 6.0, 9.0, 12.0, 15.0];
    for (row, exp) in ec.iter().enumerate() {
        let r = row as u32;
        assert_col_data_number(&mirror, &sid, r, 2, *exp, &format!("C{}", r + 1));
    }
    core.set_cell(&mut mirror, &sid, d1, 0, 3, "=SUM(B1:B5)")
        .expect("set D1");
    core.set_cell(&mut mirror, &sid, d2, 1, 3, "=SUM(C1:C5)")
        .expect("set D2");
    assert_mirror_number(&mirror, &d1, 40.0, "D1 SUM(B1:B5)");
    assert_mirror_number(&mirror, &d2, 45.0, "D2 SUM(C1:C5)");
}

#[test]
fn test_spill_shrinkage_updates_sum() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![(0, 0, CellValue::Null, None), (0, 1, CellValue::Null, None)],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a1 = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(10)")
        .expect("set A1");
    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=SUM(A1:A10)")
        .expect("set B1");
    assert_mirror_number(&mirror, &b1, 55.0, "B1 initial");
    // Shrink to SEQUENCE(5)
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(5)")
        .expect("shrink A1");
    assert_mirror_number(&mirror, &a1, 1.0, "A1 after shrink");
    // Verify old projected positions are cleared in col_data
    let sheet_mirror = &mirror.get_sheet(&sid).expect("sheet");
    if let Some(col_slice) = sheet_mirror.get_column_slice(0) {
        for row in 5..10u32 {
            if (row as usize) < col_slice.len() {
                assert!(
                    matches!(&col_slice[row as usize], CellValue::Null),
                    "A{} should be Null in col_data, got {:?}",
                    row + 1,
                    col_slice[row as usize]
                );
            }
        }
    }
    assert_mirror_number(&mirror, &b1, 15.0, "B1 after shrinkage");
}

#[test]
fn test_spill_expansion_updates_sum() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![(0, 0, CellValue::Null, None), (0, 1, CellValue::Null, None)],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a1 = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(5)")
        .expect("set A1");
    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=SUM(A1:A10)")
        .expect("set B1");
    assert_mirror_number(&mirror, &b1, 15.0, "B1 initial partial");
    // Expand to SEQUENCE(10)
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(10)")
        .expect("expand A1");
    assert_mirror_number(&mirror, &a1, 1.0, "A1 after expand");
    // Check projected values via col_data (no phantom CellIds)
    for row in 1..10u32 {
        assert_col_data_number(
            &mirror,
            &sid,
            row,
            0,
            (row + 1) as f64,
            &format!("A{} projected", row + 1),
        );
    }
    assert_mirror_number(&mirror, &b1, 55.0, "B1 after expansion");
}

#[test]
fn test_dependent_on_individual_phantom() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![(0, 0, CellValue::Null, None), (2, 1, CellValue::Null, None)],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a1 = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let b3 = CellId::from_uuid_str(&cell_uuid(0, 2, 1)).expect("b3");
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(5)")
        .expect("set A1");
    core.set_cell(&mut mirror, &sid, b3, 2, 1, "=A3*10")
        .expect("set B3");
    assert_mirror_number(&mirror, &b3, 30.0, "B3 = A3*10");
    // Change: A3 becomes 300
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(5,1,100,100)")
        .expect("change A1");
    assert_mirror_number(&mirror, &b3, 3000.0, "B3 after change");
}

/// User-reported scenario: A1=SEQUENCE(2) spills into A2, B2=A2 should read
/// the spilled value. Tests both interactive and initial snapshot paths.
#[test]
fn test_spill_b2_depends_on_a2_interactive() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![(0, 0, CellValue::Null, None), (1, 1, CellValue::Null, None)],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a1 = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let b2 = CellId::from_uuid_str(&cell_uuid(0, 1, 1)).expect("b2");
    // A1 = SEQUENCE(2) → A1=1, A2=2 (spilled)
    core.set_cell(&mut mirror, &sid, a1, 0, 0, "=SEQUENCE(2)")
        .expect("set A1");
    assert_mirror_number(&mirror, &a1, 1.0, "A1 source");
    // Verify A2 projected value via col_data (no phantom CellIds)
    assert_col_data_number(&mirror, &sid, 1, 0, 2.0, "A2 projected");
    // B2 = A2 → should read spilled value 2
    core.set_cell(&mut mirror, &sid, b2, 1, 1, "=A2")
        .expect("set B2");
    assert_mirror_number(&mirror, &b2, 2.0, "B2 = A2 (spilled value)");
    // Also test B2 = A2 + 1
    core.set_cell(&mut mirror, &sid, b2, 1, 1, "=A2+1")
        .expect("set B2 to A2+1");
    assert_mirror_number(&mirror, &b2, 3.0, "B2 = A2+1 (spilled value + 1)");
}

#[test]
fn test_spill_b2_depends_on_a2_initial_snapshot() {
    // Both formulas present at init time — the harder case
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Null, Some("SEQUENCE(2)")),
            (1, 1, CellValue::Null, Some("A2+1")),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    println!(
        "changed: {} spill: {} errors: {}",
        result.changed_cells.len(),
        result.projection_changes.len(),
        result.errors.len()
    );
    let a1 = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("a1");
    let b2 = CellId::from_uuid_str(&cell_uuid(0, 1, 1)).expect("b2");
    assert_mirror_number(&mirror, &a1, 1.0, "A1 SEQUENCE source");
    // B2 = A2 + 1 = 2 + 1 = 3
    assert_mirror_number(&mirror, &b2, 3.0, "B2 = A2+1 over spilled phantom");
}

#[test]
fn test_mixed_data_and_spill_sum() {
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
            (5, 0, CellValue::Null, None),
            (0, 1, CellValue::Null, None),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let a6 = CellId::from_uuid_str(&cell_uuid(0, 5, 0)).expect("a6");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    core.set_cell(&mut mirror, &sid, a6, 5, 0, "=SEQUENCE(5)")
        .expect("set A6");
    core.set_cell(&mut mirror, &sid, b1, 0, 1, "=SUM(A1:A10)")
        .expect("set B1");
    // B1 = 10+20+30+40+50+1+2+3+4+5 = 165
    assert_mirror_number(&mirror, &b1, 165.0, "B1 mixed data + spill");
}
