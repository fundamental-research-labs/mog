//! Integration tests for the `@` (implicit-intersection) prefix operator and
//! modern Excel's auto-spill of bare-range formulas.
//!
//! Replaces the old TS-side `normalizeAtOperator` / `normalizeStandaloneRange`
//! string-rewriter hack with first-class Rust parser/AST/evaluator support.
//!
//! Behaviour matrix (all under the dynamic-array engine):
//!
//! | Formula              | Cell  | Expected                                         |
//! |----------------------|-------|--------------------------------------------------|
//! | `=A1:A5`             | C1    | spills C1:C5 = row1..row5                        |
//! | `=A1:A5+B1:B5`       | D1    | spills D1:D5 (element-wise lifted)               |
//! | `=@A1:A5`            | C3    | "row3" (row-aligned to caller, NO spill)         |
//! | `=@A1:A5`            | C7    | #VALUE! (caller row 7 not in 1..=5)              |
//! | `=@Sheet2!A1:A5`     | C2    | sheet2 row 2 (cross-sheet @ alignment)           |
//! | `=@A1`               | any   | identity (single cell, @ is a no-op)             |

#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::SheetId;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use value_types::{CellError, CellValue};

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

#[test]
fn bare_column_range_auto_spills() {
    // `=A1:A5` typed (without CSE) at C1 must auto-spill into C1:C5.
    // This replaces the TS hack of rewriting `=A1:A5` → `=VSTACK(A1:A5)`.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, text("row1"), None),
            (1, 0, text("row2"), None),
            (2, 0, text("row3"), None),
            (3, 0, text("row4"), None),
            (4, 0, text("row5"), None),
            (0, 2, CellValue::Null, Some("A1:A5")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // C1 is the origin (registered cell); C2..C5 are projection targets.
    assert_mirror_text(&mirror, 0, 0, 2, "row1");
    for (row, expected) in [(1u32, "row2"), (2, "row3"), (3, "row4"), (4, "row5")] {
        let actual = mirror
            .get_cell_value_at(&sid(0), cell_types::SheetPos::new(row, 2))
            .cloned()
            .unwrap_or(CellValue::Null);
        match &actual {
            CellValue::Text(t) => {
                assert_eq!(t.as_ref(), expected, "C{} text mismatch", row + 1)
            }
            other => panic!("C{} expected text {:?}, got {:?}", row + 1, expected, other),
        }
    }
}

#[test]
fn binary_op_on_two_ranges_still_spills() {
    // Existing behaviour: `=A1:A3+B1:B3` is a binary op with multi-cell range
    // operands, which already auto-spills (element-wise lifting). Re-verify
    // we did not regress it when adding the bare-Range root check.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(1.0), None),
            (1, 0, CellValue::number(2.0), None),
            (2, 0, CellValue::number(3.0), None),
            (0, 1, CellValue::number(10.0), None),
            (1, 1, CellValue::number(20.0), None),
            (2, 1, CellValue::number(30.0), None),
            (0, 3, CellValue::Null, Some("A1:A3+B1:B3")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number(&mirror, 0, 0, 3, 11.0);
    assert_pos_number(&mirror, 0, 1, 3, 22.0);
    assert_pos_number(&mirror, 0, 2, 3, 33.0);
}

#[test]
fn at_operator_picks_row_aligned_cell() {
    // `=@A1:A5` typed at C3 must pick A3 (row-aligned to the caller's row),
    // and must NOT spill into C4:C5.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, text("row1"), None),
            (1, 0, text("row2"), None),
            (2, 0, text("row3"), None),
            (3, 0, text("row4"), None),
            (4, 0, text("row5"), None),
            (2, 2, CellValue::Null, Some("@A1:A5")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_text(&mirror, 0, 2, 2, "row3");

    // C4 must remain empty — @ never spills.
    let c4 = mirror.get_cell_value_at(&sid(0), cell_types::SheetPos::new(3, 2));
    assert!(
        matches!(c4, None | Some(&CellValue::Null)),
        "C4 must be empty (no spill from @ operator), got {c4:?}",
    );
}

#[test]
fn at_operator_returns_value_error_when_no_row_alignment() {
    // `=@A1:A5` typed at C7 → caller row 6 (0-based) is outside the range
    // rows 0..=4, so implicit intersection has no aligned row. Excel: #VALUE!.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, text("row1"), None),
            (1, 0, text("row2"), None),
            (2, 0, text("row3"), None),
            (3, 0, text("row4"), None),
            (4, 0, text("row5"), None),
            (6, 2, CellValue::Null, Some("@A1:A5")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_error(&mirror, 0, 6, 2, CellError::Value);
}

#[test]
fn at_operator_on_single_cell_is_identity() {
    // `=@A1` is a no-op (the operand is already a scalar) — must return A1.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(42.0), None),
            (5, 5, CellValue::Null, Some("@A1")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number(&mirror, 0, 5, 5, 42.0);
}

#[test]
fn at_operator_picks_column_aligned_cell_for_row_range() {
    // Mirror of the column-range case: `=@A1:E1` typed in row D2 must pick
    // the column-aligned cell — D1 (column 3) — when the caller's column is
    // within the range's column span.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, text("col-A"), None),
            (0, 1, text("col-B"), None),
            (0, 2, text("col-C"), None),
            (0, 3, text("col-D"), None),
            (0, 4, text("col-E"), None),
            (0, 4, text("col-E"), None),
            (1, 3, CellValue::Null, Some("@A1:E1")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_text(&mirror, 0, 1, 3, "col-D");
}

#[test]
fn cross_sheet_bare_range_auto_spills() {
    // Replaces the `normalizeStandaloneRange` hack: `=Sheet2!A1:A5` typed on
    // Sheet1 must spill 5 rows on Sheet1.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            100,
            26,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1:A5"))],
        ),
        (
            "Sheet2",
            100,
            26,
            vec![
                (0, 0, text("s2-a"), None),
                (1, 0, text("s2-b"), None),
                (2, 0, text("s2-c"), None),
                (3, 0, text("s2-d"), None),
                (4, 0, text("s2-e"), None),
            ],
        ),
    ]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // A1 origin lives on Sheet1 and shows "s2-a"; A2..A5 are spill targets.
    assert_mirror_text(&mirror, 0, 0, 0, "s2-a");
    for (row, expected) in [(1u32, "s2-b"), (2, "s2-c"), (3, "s2-d"), (4, "s2-e")] {
        let actual = mirror
            .get_cell_value_at(&sid(0), cell_types::SheetPos::new(row, 0))
            .cloned()
            .unwrap_or(CellValue::Null);
        match &actual {
            CellValue::Text(t) => {
                assert_eq!(t.as_ref(), expected, "Sheet1 A{} mismatch", row + 1)
            }
            other => panic!(
                "Sheet1 A{} expected {:?}, got {:?}",
                row + 1,
                expected,
                other
            ),
        }
    }
}

#[test]
fn cross_sheet_at_operator_picks_caller_row() {
    // Cross-sheet variant: `=@Sheet2!A1:A5` typed in C2 of Sheet1 must pick
    // Sheet2!A2 (caller row=1 (0-based) aligned), NOT spill on Sheet1.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            100,
            26,
            vec![(1, 2, CellValue::Null, Some("@Sheet2!A1:A5"))],
        ),
        (
            "Sheet2",
            100,
            26,
            vec![
                (0, 0, text("s2-a"), None),
                (1, 0, text("s2-b"), None),
                (2, 0, text("s2-c"), None),
                (3, 0, text("s2-d"), None),
                (4, 0, text("s2-e"), None),
            ],
        ),
    ]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_text(&mirror, 0, 1, 2, "s2-b");

    // Sheet1 C3 must remain empty (no spill).
    let c3 = mirror.get_cell_value_at(&sid(0), cell_types::SheetPos::new(2, 2));
    assert!(
        matches!(c3, None | Some(&CellValue::Null)),
        "Sheet1 C3 must be empty, got {c3:?}",
    );
}

#[test]
fn single_function_matches_at_for_row_and_column_aligned_ranges() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, text("row1"), None),
            (1, 0, text("row2"), None),
            (2, 0, text("row3"), None),
            (3, 0, text("row4"), None),
            (4, 0, text("row5"), None),
            (0, 1, text("col-B"), None),
            (0, 2, text("col-C"), None),
            (0, 3, text("col-D"), None),
            (0, 4, text("col-E"), None),
            (2, 2, CellValue::Null, Some("SINGLE(A1:A5)")),
            (2, 3, CellValue::Null, Some("@A1:A5")),
            (1, 3, CellValue::Null, Some("SINGLE(A1:E1)")),
            (1, 4, CellValue::Null, Some("@A1:E1")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_text(&mirror, 0, 2, 2, "row3");
    assert_mirror_text(&mirror, 0, 2, 3, "row3");
    assert_mirror_text(&mirror, 0, 1, 3, "col-D");
    assert_mirror_text(&mirror, 0, 1, 4, "col-E");
}

#[test]
fn single_function_matches_at_for_two_dimensional_cross_sheet_range() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            100,
            26,
            vec![
                (2, 2, CellValue::Null, Some("SINGLE(Sheet2!A1:E5)")),
                (2, 3, CellValue::Null, Some("@Sheet2!A1:E5")),
            ],
        ),
        (
            "Sheet2",
            100,
            26,
            vec![(2, 2, text("s2-c3"), None), (2, 3, text("s2-d3"), None)],
        ),
    ]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_text(&mirror, 0, 2, 2, "s2-c3");
    assert_mirror_text(&mirror, 0, 2, 3, "s2-d3");
}

#[test]
fn single_function_uses_at_reference_wrappers_and_array_fallback() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, text("row1"), None),
            (1, 0, text("row2"), None),
            (2, 0, text("row3"), None),
            (2, 2, CellValue::Null, Some("SINGLE((A1:A3))")),
            (2, 3, CellValue::Null, Some("@(A1:A3)")),
            (5, 2, CellValue::Null, Some("SINGLE({1,2;3,4})")),
            (5, 3, CellValue::Null, Some("@{1,2;3,4}")),
            (6, 2, CellValue::Null, Some("SINGLE(A1:A3)")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_text(&mirror, 0, 2, 2, "row3");
    assert_mirror_text(&mirror, 0, 2, 3, "row3");
    assert_mirror_number(&mirror, 0, 5, 2, 1.0);
    assert_mirror_number(&mirror, 0, 5, 3, 1.0);
    assert_mirror_error(&mirror, 0, 6, 2, CellError::Value);
}

#[test]
fn xlsx_normalized_single_readback_strips_xlfn_prefix() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, text("row1"), None),
            (1, 0, text("row2"), None),
            (1, 2, CellValue::Null, Some("_xlfn.SINGLE(A1:A5)")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_text(&mirror, 0, 1, 2, "row2");
    assert_eq!(core.get_formula(&cid(0, 1, 2)), Some("=SINGLE(A1:A5)"));
}

#[test]
fn anchorarray_function_hash_and_xlfn_forms_share_spill_source_path() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Null, Some("SEQUENCE(3)")),
            (0, 2, CellValue::Null, Some("SUM(A1#)")),
            (1, 2, CellValue::Null, Some("SUM(ANCHORARRAY(A1))")),
            (2, 2, CellValue::Null, Some("SUM(_xlfn.ANCHORARRAY(A1))")),
            (3, 2, CellValue::Null, Some("ANCHORARRAY(C1)")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number(&mirror, 0, 0, 2, 6.0);
    assert_mirror_number(&mirror, 0, 1, 2, 6.0);
    assert_mirror_number(&mirror, 0, 2, 2, 6.0);
    assert_mirror_error(&mirror, 0, 3, 2, CellError::Value);
    assert_eq!(core.get_formula(&cid(0, 0, 2)), Some("=SUM(A1#)"));
    assert_eq!(
        core.get_formula(&cid(0, 2, 2)),
        Some("=SUM(ANCHORARRAY(A1))")
    );
}

#[test]
fn formula_text_round_trips_unchanged() {
    // The formula bar must reflect what the user typed — exactly. Adding
    // `@` and bare-range support directly to the parser means we no longer
    // mutate the formula string on the way in (the old TS hack would store
    // `=VSTACK(A1:A5)` instead of `=A1:A5`).
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, text("a"), None),
            (1, 0, text("b"), None),
            (0, 2, CellValue::Null, Some("A1:A5")),
            (5, 5, CellValue::Null, Some("@A1:A5")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Formulas read back via the engine match exactly what was parsed in;
    // the parser preserves user-typed `@` and bare ranges in the AST and
    // round-trips them via Display.
    let f1 = core.get_formula(&cid(0, 0, 2));
    assert_eq!(
        f1,
        Some("=A1:A5"),
        "bare-range formula text must round-trip without VSTACK wrap",
    );

    let f2 = core.get_formula(&cid(0, 5, 5));
    assert_eq!(
        f2,
        Some("=@A1:A5"),
        "@-prefixed formula text must round-trip without SINGLE wrap",
    );
}
