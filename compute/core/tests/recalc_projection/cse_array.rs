use super::*;

/// Single-cell CSE TRANSPOSE should implicit-intersect to first element, not spill.
/// In legacy Excel (pre-dynamic-arrays), entering TRANSPOSE with Ctrl+Shift+Enter
/// into a single cell produces only the first element (implicit intersection).
/// The XLSX marks this with t="array" and ref="B1:B1" (1x1 range).
/// Uses horizontal source (G1:K1) so TRANSPOSE produces a 5×1 vertical result,
/// matching the corpus pattern where TRANSPOSE(row_range) returns [Nx1 array].
#[test]
fn test_single_cell_cse_transpose_implicit_intersection() {
    let snapshot = build_snapshot_with_array_ref(vec![(
        "Sheet1",
        100,
        26,
        vec![
            // Source data in G1:K1 (row 0, cols 6..10) — 1 row × 5 cols
            (0, 6, CellValue::number(10.0), None, None),
            (0, 7, CellValue::number(20.0), None, None),
            (0, 8, CellValue::number(30.0), None, None),
            (0, 9, CellValue::number(40.0), None, None),
            (0, 10, CellValue::number(50.0), None, None),
            // B1 = TRANSPOSE(G1:K1) with CSE array_ref="B1:B1" (single cell)
            // TRANSPOSE(1×5) = 5×1 → without fix, spills B1:B5 vertically
            (
                0,
                1,
                CellValue::number(10.0),
                Some("TRANSPOSE(G1:K1)"),
                Some("B1:B1"),
            ),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    // B1 should contain the scalar 10.0, not an array
    assert_mirror_number(
        &mirror,
        &b1,
        10.0,
        "B1 single-cell CSE TRANSPOSE should implicit-intersect",
    );
    // No vertical spill should occur — B2:B5 should remain empty
    assert_col_data_null_or_zero(
        &mirror,
        &sid,
        1,
        1,
        "B2 should be empty (no spill from single-cell CSE)",
    );
    assert_col_data_null_or_zero(
        &mirror,
        &sid,
        2,
        1,
        "B3 should be empty (no spill from single-cell CSE)",
    );
    assert_col_data_null_or_zero(
        &mirror,
        &sid,
        3,
        1,
        "B4 should be empty (no spill from single-cell CSE)",
    );
    assert_col_data_null_or_zero(
        &mirror,
        &sid,
        4,
        1,
        "B5 should be empty (no spill from single-cell CSE)",
    );
}

/// Single-cell CSE with negation: -TRANSPOSE($H$10:$T$10) with array_ref="D20:D20"
/// The single-cell array ref must not spill the transposed source range.
#[test]
fn test_single_cell_cse_negated_transpose() {
    let snapshot = build_snapshot_with_array_ref(vec![(
        "Sheet1",
        200,
        26,
        vec![
            // Source data in H10:T10 (row 9, cols 7..19) — 13 values
            (9, 7, CellValue::number(0.0), None, None),
            (9, 8, CellValue::number(1.0), None, None),
            (9, 9, CellValue::number(2.0), None, None),
            (9, 10, CellValue::number(3.0), None, None),
            (9, 11, CellValue::number(4.0), None, None),
            (9, 12, CellValue::number(5.0), None, None),
            (9, 13, CellValue::number(6.0), None, None),
            (9, 14, CellValue::number(7.0), None, None),
            (9, 15, CellValue::number(8.0), None, None),
            (9, 16, CellValue::number(9.0), None, None),
            (9, 17, CellValue::number(10.0), None, None),
            (9, 18, CellValue::number(11.0), None, None),
            (9, 19, CellValue::number(12.0), None, None),
            // D20 = -TRANSPOSE($H$10:$T$10) with CSE array_ref="D20:D20" (single cell)
            (
                19,
                3,
                CellValue::number(0.0),
                Some("-TRANSPOSE($H$10:$T$10)"),
                Some("D20:D20"),
            ),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let d20 = CellId::from_uuid_str(&cell_uuid(0, 19, 3)).expect("d20");
    // D20 should be -0.0 = 0.0 (negation of first element)
    assert_mirror_number(
        &mirror,
        &d20,
        0.0,
        "D20 single-cell CSE -TRANSPOSE should be 0",
    );
    // No spill below D20
    for row in 20..=31 {
        assert_col_data_null_or_zero(
            &mirror,
            &sid,
            row,
            3,
            &format!(
                "D{} should be empty (no spill from single-cell CSE)",
                row + 1
            ),
        );
    }
}

/// Multi-cell CSE TRANSPOSE with downstream dependency.
/// B1:B3 = -TRANSPOSE(E1:G1) with array_ref="B1:B3" (3-cell CSE range).
/// B4 = B3-1 depends on the last CSE spill target.
/// Verifies that CSE constrains spill to declared range AND downstream deps recalc correctly.
#[test]
fn test_multi_cell_cse_transpose_with_downstream_dependency() {
    let snapshot = build_snapshot_with_array_ref(vec![(
        "Sheet1",
        100,
        26,
        vec![
            // Source data in E1:G1
            (0, 4, CellValue::number(0.0), None, None),
            (0, 5, CellValue::number(1.0), None, None),
            (0, 6, CellValue::number(2.0), None, None),
            // B1 = -TRANSPOSE(E1:G1) with CSE array_ref="B1:B3"
            (
                0,
                1,
                CellValue::number(0.0),
                Some("-TRANSPOSE(E1:G1)"),
                Some("B1:B3"),
            ),
            // B4 = B3-1 (depends on last spill cell)
            (3, 1, CellValue::Null, Some("B3-1"), None),
        ],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let b4 = CellId::from_uuid_str(&cell_uuid(0, 3, 1)).expect("b4");
    // B1 = -0 = 0
    assert_mirror_number(&mirror, &b1, 0.0, "B1 CSE anchor");
    // B2 = -1, B3 = -2 (spill within CSE range)
    assert_col_data_number(&mirror, &sid, 1, 1, -1.0, "B2 CSE spill target");
    assert_col_data_number(&mirror, &sid, 2, 1, -2.0, "B3 CSE spill target");
    // B4 = B3 - 1 = -2 - 1 = -3
    assert_mirror_number(&mirror, &b4, -3.0, "B4 downstream of CSE spill");
}
