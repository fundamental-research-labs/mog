use cell_types::SheetId;
use formula_types::RangeType;

use crate::ast::{ASTNode, AbsFlags, CellRefNode, RangeRef};

use super::fixtures::{pos, resolved, workbook};

#[test]
fn test_display_cell_ref_a1() {
    let node = ASTNode::CellReference(CellRefNode {
        reference: pos(0, 0),
        abs_row: false,
        abs_col: false,
    });
    assert_eq!(format!("{node}"), "A1");
}

#[test]
fn test_display_cell_ref_absolute() {
    let node = ASTNode::CellReference(CellRefNode {
        reference: pos(0, 0),
        abs_row: true,
        abs_col: true,
    });
    assert_eq!(format!("{node}"), "$A$1");
}

#[test]
fn test_display_cell_ref_mixed() {
    let abs_col = ASTNode::CellReference(CellRefNode {
        reference: pos(0, 0),
        abs_row: false,
        abs_col: true,
    });
    assert_eq!(format!("{abs_col}"), "$A1");

    let abs_row = ASTNode::CellReference(CellRefNode {
        reference: pos(0, 0),
        abs_row: true,
        abs_col: false,
    });
    assert_eq!(format!("{abs_row}"), "A$1");
}

#[test]
fn test_display_cell_ref_b2() {
    let node = ASTNode::CellReference(CellRefNode {
        reference: pos(1, 1),
        abs_row: false,
        abs_col: false,
    });
    assert_eq!(format!("{node}"), "B2");
}

#[test]
fn test_display_cell_ref_aa100() {
    let node = ASTNode::CellReference(CellRefNode {
        reference: pos(99, 26),
        abs_row: false,
        abs_col: false,
    });
    assert_eq!(format!("{node}"), "AA100");
}

#[test]
fn resolved_cell_ref_displays_fallback() {
    let node = ASTNode::CellReference(CellRefNode {
        reference: resolved(42),
        abs_row: false,
        abs_col: false,
    });

    assert_eq!(format!("{node}"), "<resolved>");
}

#[test]
fn test_display_range_cell() {
    let node = ASTNode::Range(RangeRef {
        start: pos(0, 0),
        end: pos(9, 1),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    assert_eq!(format!("{node}"), "A1:B10");
}

#[test]
fn test_display_range_cell_absolute() {
    let node = ASTNode::Range(RangeRef {
        start: pos(0, 0),
        end: pos(9, 1),
        abs_start: AbsFlags {
            row: true,
            col: true,
        },
        abs_end: AbsFlags {
            row: true,
            col: true,
        },
        range_type: RangeType::CellRange,
    });
    assert_eq!(format!("{node}"), "$A$1:$B$10");
}

#[test]
fn test_display_range_column() {
    let node = ASTNode::Range(RangeRef {
        start: pos(0, 0),
        end: pos(0, 2),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::ColumnRange,
    });
    assert_eq!(format!("{node}"), "A:C");
}

#[test]
fn test_display_range_row() {
    let node = ASTNode::Range(RangeRef {
        start: pos(0, 0),
        end: pos(4, 0),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::RowRange,
    });
    assert_eq!(format!("{node}"), "1:5");
}

#[test]
fn resolved_column_and_row_ranges_display_fallbacks() {
    let column = ASTNode::Range(RangeRef {
        start: resolved(1),
        end: resolved(2),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::ColumnRange,
    });
    let row = ASTNode::Range(RangeRef {
        start: resolved(1),
        end: resolved(2),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::RowRange,
    });

    assert_eq!(format!("{column}"), "<col-range>");
    assert_eq!(format!("{row}"), "<row-range>");
}

#[test]
fn test_display_unresolved_sheet_ref() {
    let node = ASTNode::UnresolvedSheetRef {
        sheet_name: "Sheet1".to_string(),
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };
    assert_eq!(format!("{node}"), "Sheet1!A1");
}

#[test]
fn test_display_unresolved_sheet_ref_quoted() {
    let node = ASTNode::UnresolvedSheetRef {
        sheet_name: "My Sheet".to_string(),
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };
    assert_eq!(format!("{node}"), "'My Sheet'!A1");
}

#[test]
fn unresolved_sheet_ref_escapes_apostrophes() {
    let node = ASTNode::UnresolvedSheetRef {
        sheet_name: "Bob's Sheet".to_string(),
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };

    assert_eq!(format!("{node}"), "'Bob''s Sheet'!A1");
}

#[test]
fn test_display_sheet_ref_resolved() {
    let sheet = SheetId::from_raw(1);
    let node = ASTNode::SheetRef {
        sheet,
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };

    assert_eq!(format!("{node}"), format!("Sheet({sheet})!A1"));
}

#[test]
fn unresolved_three_d_ref_formats_sheet_names() {
    let node = ASTNode::UnresolvedThreeDRef {
        start_name: "Start".to_string(),
        end_name: "End".to_string(),
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };

    assert_eq!(format!("{node}"), "Start:End!A1");
}

#[test]
fn unresolved_three_d_ref_quotes_and_escapes_sheet_names() {
    let node = ASTNode::UnresolvedThreeDRef {
        start_name: "Start Sheet".to_string(),
        end_name: "Bob's End".to_string(),
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };

    assert_eq!(format!("{node}"), "'Start Sheet':'Bob''s End'!A1");
}

#[test]
fn resolved_three_d_ref_displays_debug_sheet_ids() {
    let start_sheet = SheetId::from_raw(1);
    let end_sheet = SheetId::from_raw(2);
    let node = ASTNode::ThreeDRef {
        start_sheet,
        end_sheet,
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };

    assert_eq!(
        format!("{node}"),
        format!("Sheet({start_sheet}):Sheet({end_sheet})!A1")
    );
}

#[test]
fn external_sheet_ref_formats_and_escapes() {
    let node = ASTNode::ExternalSheetRef {
        workbook: workbook("[Book.xlsx]"),
        sheet_name: "Bob's Sheet".to_string(),
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };

    assert_eq!(format!("{node}"), "'[Book.xlsx]Bob''s Sheet'!A1");
}

#[test]
fn external_three_d_ref_formats_and_escapes() {
    let node = ASTNode::ExternalThreeDRef {
        workbook: workbook("[Book.xlsx]"),
        start_sheet: "Start's".to_string(),
        end_sheet: "End's".to_string(),
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })),
    };

    assert_eq!(format!("{node}"), "'[Book.xlsx]Start''s:End''s'!A1");
}

#[test]
fn external_name_ref_formats_without_extra_escaping() {
    let node = ASTNode::ExternalNameRef {
        workbook: workbook("[Book.xlsx]"),
        name: "DefinedName".to_string(),
    };

    assert_eq!(format!("{node}"), "[Book.xlsx]DefinedName");
}
