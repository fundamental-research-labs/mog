use super::*;

// ===========================================================================
// Row Ranges
// ===========================================================================

#[test]
fn single_row_range() {
    // 1:1 -> Range(RowRange) for row 1
    let ast = p("1:1");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::RowRange);
            match (&r.start, &r.end) {
                (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                    assert_eq!(*r1, 0); // row "1" is 0-indexed
                    assert_eq!(*r2, 0);
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range(RowRange), got {other:?}"),
    }
}

#[test]
fn full_row_range() {
    // 1:1048576 -> max valid row range
    let ast = p("1:1048576");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::RowRange);
            match (&r.start, &r.end) {
                (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                    assert_eq!(*r1, 0);
                    assert_eq!(*r2, 1_048_575);
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range(RowRange), got {other:?}"),
    }
}

#[test]
fn absolute_row_range() {
    // $1:$5 -> absolute row range
    let ast = p("$1:$5");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::RowRange);
            assert!(r.abs_start.row);
            assert!(r.abs_end.row);
            match (&r.start, &r.end) {
                (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                    assert_eq!(*r1, 0);
                    assert_eq!(*r2, 4);
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range(RowRange), got {other:?}"),
    }
}

#[test]
fn mixed_absolute_row_range() {
    // $1:5 -> mixed: start absolute, end relative
    let ast = p("$1:5");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::RowRange);
            assert!(r.abs_start.row);
            assert!(!r.abs_end.row);
        }
        other => panic!("Expected Range(RowRange), got {other:?}"),
    }
}

#[test]
fn multi_row_range() {
    // 5:10 -> rows 5 through 10
    let ast = p("5:10");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::RowRange);
            match (&r.start, &r.end) {
                (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                    assert_eq!(*r1, 4);
                    assert_eq!(*r2, 9);
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range(RowRange), got {other:?}"),
    }
}

// ===========================================================================
// Column Ranges
// ===========================================================================

#[test]
fn single_column_range() {
    // A:A -> single column
    let ast = p("A:A");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::ColumnRange);
            match (&r.start, &r.end) {
                (CellRef::Positional { col: c1, .. }, CellRef::Positional { col: c2, .. }) => {
                    assert_eq!(*c1, 0);
                    assert_eq!(*c2, 0);
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range(ColumnRange), got {other:?}"),
    }
}

#[test]
fn full_column_range() {
    // A:XFD -> max valid column range
    let ast = p("A:XFD");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::ColumnRange);
            match (&r.start, &r.end) {
                (CellRef::Positional { col: c1, .. }, CellRef::Positional { col: c2, .. }) => {
                    assert_eq!(*c1, 0);
                    assert_eq!(*c2, 16383);
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range(ColumnRange), got {other:?}"),
    }
}

#[test]
fn absolute_column_range() {
    // $A:$C -> absolute column range
    let ast = p("$A:$C");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::ColumnRange);
            assert!(r.abs_start.col);
            assert!(r.abs_end.col);
            match (&r.start, &r.end) {
                (CellRef::Positional { col: c1, .. }, CellRef::Positional { col: c2, .. }) => {
                    assert_eq!(*c1, 0);
                    assert_eq!(*c2, 2);
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range(ColumnRange), got {other:?}"),
    }
}

#[test]
fn mixed_absolute_column_range() {
    // $A:C -> mixed: start absolute, end relative
    let ast = p("$A:C");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::ColumnRange);
            assert!(r.abs_start.col);
            assert!(!r.abs_end.col);
        }
        other => panic!("Expected Range(ColumnRange), got {other:?}"),
    }
}

#[test]
fn multi_column_range() {
    // B:F -> columns B through F
    let ast = p("B:F");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::ColumnRange);
            match (&r.start, &r.end) {
                (CellRef::Positional { col: c1, .. }, CellRef::Positional { col: c2, .. }) => {
                    assert_eq!(*c1, 1); // B
                    assert_eq!(*c2, 5); // F
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range(ColumnRange), got {other:?}"),
    }
}

// ===========================================================================
// Range with Absolute Refs
// ===========================================================================

#[test]
fn all_absolute() {
    // $A$1:$B$10 -> all flags true
    let ast = p("$A$1:$B$10");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::CellRange);
            assert!(r.abs_start.col, "start col should be absolute");
            assert!(r.abs_start.row, "start row should be absolute");
            assert!(r.abs_end.col, "end col should be absolute");
            assert!(r.abs_end.row, "end row should be absolute");
            match (&r.start, &r.end) {
                (
                    CellRef::Positional {
                        row: r1, col: c1, ..
                    },
                    CellRef::Positional {
                        row: r2, col: c2, ..
                    },
                ) => {
                    assert_eq!(*r1, 0);
                    assert_eq!(*c1, 0);
                    assert_eq!(*r2, 9);
                    assert_eq!(*c2, 1);
                }
                _ => panic!("Expected Positional refs"),
            }
        }
        other => panic!("Expected Range, got {other:?}"),
    }
}

#[test]
fn row_absolute_only() {
    // A$1:B$10 -> only row absolute
    let ast = p("A$1:B$10");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::CellRange);
            assert!(!r.abs_start.col);
            assert!(r.abs_start.row);
            assert!(!r.abs_end.col);
            assert!(r.abs_end.row);
        }
        other => panic!("Expected Range, got {other:?}"),
    }
}

#[test]
fn col_absolute_only() {
    // $A1:$B10 -> only col absolute
    let ast = p("$A1:$B10");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::CellRange);
            assert!(r.abs_start.col);
            assert!(!r.abs_start.row);
            assert!(r.abs_end.col);
            assert!(!r.abs_end.row);
        }
        other => panic!("Expected Range, got {other:?}"),
    }
}

#[test]
fn mixed_absolute_start_end() {
    // $A$1:B10 -> start all absolute, end all relative
    let ast = p("$A$1:B10");
    match &ast {
        ASTNode::Range(r) => {
            assert_eq!(r.range_type, RangeType::CellRange);
            assert!(r.abs_start.col);
            assert!(r.abs_start.row);
            assert!(!r.abs_end.col);
            assert!(!r.abs_end.row);
        }
        other => panic!("Expected Range, got {other:?}"),
    }
}

#[test]
fn all_relative() {
    // A1:B10 -> all relative (baseline)
    let ast = p("A1:B10");
    match &ast {
        ASTNode::Range(r) => {
            assert!(!r.abs_start.col);
            assert!(!r.abs_start.row);
            assert!(!r.abs_end.col);
            assert!(!r.abs_end.row);
        }
        other => panic!("Expected Range, got {other:?}"),
    }
}
