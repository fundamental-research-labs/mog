//! Tests for SUBTOTAL and AGGREGATE hidden-row filtering.
//!
//! The test mirror has a 5x5 grid with values Number(row*10 + col).
//! Column 0 values: row0=0, row1=10, row2=20, row3=30, row4=40.

use super::*;

/// Helper: build a range ref for (sheet, start_row, start_col) to (sheet, end_row, end_col).
fn range_ref(sheet: SheetId, r0: u32, c0: u32, r1: u32, c1: u32) -> ASTNode {
    ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet,
            row: r0,
            col: c0,
        },
        end: CellRef::Positional {
            sheet,
            row: r1,
            col: c1,
        },
        abs_start: AbsFlags {
            row: false,
            col: false,
        },
        abs_end: AbsFlags {
            row: false,
            col: false,
        },
        range_type: RangeType::CellRange,
    })
}

// -----------------------------------------------------------------------
// SUBTOTAL func codes 1-11: always include all rows (even hidden)
// -----------------------------------------------------------------------

#[test]
fn subtotal_9_sum_includes_hidden_rows() {
    let (mut m, s) = test_mirror();
    // Hide rows 1 and 3
    m.set_row_hidden(&s, 1, true);
    m.set_row_hidden(&s, 3, true);
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(9, A1:A5) = SUM of col 0, rows 0-4 = 0+10+20+30+40 = 100
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(9.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(100.0));
}

#[test]
fn subtotal_1_average_includes_hidden_rows() {
    let (mut m, s) = test_mirror();
    m.set_row_hidden(&s, 1, true);
    m.set_row_hidden(&s, 3, true);
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(1, A1:A5) = AVERAGE of col 0 = (0+10+20+30+40)/5 = 20
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(1.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(20.0));
}

// -----------------------------------------------------------------------
// SUBTOTAL func codes 101-111: skip hidden rows
// -----------------------------------------------------------------------

#[test]
fn subtotal_109_sum_skips_hidden_rows() {
    let (mut m, s) = test_mirror();
    // Hide rows 1 and 3 (values 10, 30)
    m.set_row_hidden(&s, 1, true);
    m.set_row_hidden(&s, 3, true);
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(109, A1:A5) = SUM of visible: 0+20+40 = 60
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(109.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(60.0));
}

#[test]
fn subtotal_101_average_skips_hidden_rows() {
    let (mut m, s) = test_mirror();
    // Hide rows 1 and 3
    m.set_row_hidden(&s, 1, true);
    m.set_row_hidden(&s, 3, true);
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(101, A1:A5) = AVERAGE of visible: (0+20+40)/3 = 20
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(101.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(20.0));
}

#[test]
fn subtotal_102_count_skips_hidden_rows() {
    let (mut m, s) = test_mirror();
    // Hide rows 1 and 3
    m.set_row_hidden(&s, 1, true);
    m.set_row_hidden(&s, 3, true);
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(102, A1:A5) = COUNT of visible numeric values = 3
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(102.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn subtotal_104_max_skips_hidden_rows() {
    let (mut m, s) = test_mirror();
    // Hide row 4 (value 40, the max)
    m.set_row_hidden(&s, 4, true);
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(104, A1:A5) = MAX of visible: max(0,10,20,30) = 30
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(104.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(30.0));
}

#[test]
fn subtotal_105_min_skips_hidden_rows() {
    let (mut m, s) = test_mirror();
    // Hide row 0 (value 0, the min)
    m.set_row_hidden(&s, 0, true);
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(105, A1:A5) = MIN of visible: min(10,20,30,40) = 10
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(105.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(10.0));
}

// -----------------------------------------------------------------------
// Edge: no hidden rows — 109 behaves identically to 9
// -----------------------------------------------------------------------

#[test]
fn subtotal_109_no_hidden_rows_equals_subtotal_9() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    let node_9 = func(
        "SUBTOTAL",
        vec![ASTNode::Number(9.0), range_ref(s, 0, 0, 4, 0)],
    );
    let node_109 = func(
        "SUBTOTAL",
        vec![ASTNode::Number(109.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node_9, &ctx), eval(&node_109, &ctx));
}

// -----------------------------------------------------------------------
// Edge: all rows hidden — 109 returns 0 (empty sum)
// -----------------------------------------------------------------------

#[test]
fn subtotal_109_all_hidden_returns_zero() {
    let (mut m, s) = test_mirror();
    for r in 0..5 {
        m.set_row_hidden(&s, r, true);
    }
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(109, A1:A5) = SUM of no values = 0
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(109.0), range_ref(s, 0, 0, 4, 0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

// -----------------------------------------------------------------------
// Multi-column range: hidden rows skip entire row
// -----------------------------------------------------------------------

#[test]
fn subtotal_109_multi_column_skips_full_row() {
    let (mut m, s) = test_mirror();
    // Hide row 2 (values: col0=20, col1=21, col2=22)
    m.set_row_hidden(&s, 2, true);
    let ctx = make_ctx(&m, s);

    // SUBTOTAL(109, A1:C3) — rows 0-2, cols 0-2
    // Visible rows 0,1: (0+1+2) + (10+11+12) = 36
    let node = func(
        "SUBTOTAL",
        vec![ASTNode::Number(109.0), range_ref(s, 0, 0, 2, 2)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(36.0));
}

// -----------------------------------------------------------------------
// AGGREGATE with ignore-hidden options
// -----------------------------------------------------------------------

#[test]
fn aggregate_option_5_ignore_hidden_and_nested() {
    let (mut m, s) = test_mirror();
    // Hide rows 1 and 3 (values 10, 30)
    m.set_row_hidden(&s, 1, true);
    m.set_row_hidden(&s, 3, true);
    let ctx = make_ctx(&m, s);

    // AGGREGATE(9, 5, A1:A5) = SUM, option 5 = ignore hidden + nested
    // Visible: 0+20+40 = 60
    let node = func(
        "AGGREGATE",
        vec![
            ASTNode::Number(9.0),
            ASTNode::Number(5.0),
            range_ref(s, 0, 0, 4, 0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(60.0));
}

#[test]
fn aggregate_option_4_no_hidden_skipping() {
    let (mut m, s) = test_mirror();
    // Hide rows 1 and 3
    m.set_row_hidden(&s, 1, true);
    m.set_row_hidden(&s, 3, true);
    let ctx = make_ctx(&m, s);

    // AGGREGATE(9, 4, A1:A5) = SUM, option 4 = ignore nested only (NOT hidden)
    // All rows: 0+10+20+30+40 = 100
    let node = func(
        "AGGREGATE",
        vec![
            ASTNode::Number(9.0),
            ASTNode::Number(4.0),
            range_ref(s, 0, 0, 4, 0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(100.0));
}
