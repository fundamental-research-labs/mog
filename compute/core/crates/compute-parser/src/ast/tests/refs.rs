use cell_types::SheetId;
use formula_types::RangeType;

use crate::ast::{AbsFlags, RangeRef};

use super::fixtures::{pos, pos_on, resolved};

#[test]
fn abs_flags_default_is_relative() {
    let flags = AbsFlags::default();

    assert!(!flags.row);
    assert!(!flags.col);
}

#[test]
fn range_ref_new_uses_relative_flags() {
    let range = RangeRef::new(pos(0, 0), pos(1, 1), RangeType::CellRange);

    assert_eq!(range.abs_start, AbsFlags::default());
    assert_eq!(range.abs_end, AbsFlags::default());
}

#[test]
fn range_ref_with_abs_preserves_endpoint_flags() {
    let start = AbsFlags {
        row: true,
        col: false,
    };
    let end = AbsFlags {
        row: false,
        col: true,
    };
    let range = RangeRef::with_abs(pos(0, 0), pos(1, 1), RangeType::CellRange, start, end);

    assert_eq!(range.abs_start, start);
    assert_eq!(range.abs_end, end);
}

#[test]
fn range_ref_builders_update_individual_flags() {
    let range = RangeRef::new(pos(0, 0), pos(1, 1), RangeType::CellRange)
        .with_abs_start_row(true)
        .with_abs_start_col(true)
        .with_abs_end_row(true)
        .with_abs_end_col(true);

    assert!(range.abs_start.row);
    assert!(range.abs_start.col);
    assert!(range.abs_end.row);
    assert!(range.abs_end.col);
}

#[test]
fn range_ref_same_sheet_returns_common_positional_sheet() {
    let range = RangeRef::new(pos_on(7, 0, 0), pos_on(7, 1, 1), RangeType::CellRange);

    assert_eq!(range.same_sheet(), Some(SheetId::from_raw(7)));
}

#[test]
fn range_ref_same_sheet_returns_none_for_mixed_sheets() {
    let range = RangeRef::new(pos_on(7, 0, 0), pos_on(8, 1, 1), RangeType::CellRange);

    assert_eq!(range.same_sheet(), None);
}

#[test]
fn range_ref_same_sheet_returns_none_for_resolved_refs() {
    let resolved_range = RangeRef::new(resolved(1), resolved(2), RangeType::CellRange);
    let mixed_range = RangeRef::new(pos_on(7, 0, 0), resolved(2), RangeType::CellRange);

    assert_eq!(resolved_range.same_sheet(), None);
    assert_eq!(mixed_range.same_sheet(), None);
}
