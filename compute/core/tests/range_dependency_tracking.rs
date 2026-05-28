//! Class II — Range dependency tracking under dynamic extent.
//!
//! **Invariant.** A cell inside a full-column / full-row / named / table /
//! 3D / INDIRECT range is a dependent of that formula regardless of:
//! - Whether the cell was populated when the formula was first evaluated.
//! - Edit history on adjacent cells.
//! - Growth or shrinkage of the sheet's populated extent between the op
//!   and the inverse.
//!
//! **Bug pin.** Directly targets the `Ib6CYMnT` hypothesis (full-column
//! bbox cache growing on forward writes, not shrinking on revert). The
//! named test `regression_ib6cymnt_fullcol_bbox_extent_miss` is expected
//! to **fail today**.
//!
//! **Methodology.** White-box-ish — asserts via dependent formula value,
//! never internal bbox-cache state. Tests survive refactors of the
//! invalidation machinery.
//!
//! Run:
//!   cargo test -p compute-core --test range_dependency_tracking -- --nocapture

// `matrix.rs` declares axis enums / the `cartesian` combiner for use by
// Class I, Class III, Class V. Class II only consumes the Stage-4
// appended axes (`Extent`, `AggregatorShape`, `CoverageReason`), so the
// rest of the module is legitimately dead here.
#![allow(dead_code)]

// Import only the matrix scaffolding. Bypass `support/mod.rs` because a
// concurrent agent has appended formula-shape variants to
// `DependentShape` without updating the `workbook_with_topology` match
// in `fixtures.rs`, which breaks the build for every test file that
// pulls the full `support` module. We don't need `fixtures` or
// `assertions` for Class II — matrix.rs is self-contained.
#[path = "support/matrix.rs"]
mod matrix;

#[cfg(feature = "audit-tests")]
use matrix::{EditPosition as V2EditPos, ValueType as V2ValueType};

#[cfg(feature = "audit-tests")]
#[path = "range_dependency_tracking/audit_summary.rs"]
mod audit_summary;
#[path = "range_dependency_tracking/fullcol.rs"]
mod fullcol;
#[path = "range_dependency_tracking/helpers.rs"]
mod helpers;
#[path = "range_dependency_tracking/indirect.rs"]
mod indirect;
#[path = "range_dependency_tracking/named.rs"]
mod named;
#[path = "range_dependency_tracking/offset.rs"]
mod offset;
#[path = "range_dependency_tracking/regression_ib6cymnt.rs"]
mod regression_ib6cymnt;
#[path = "range_dependency_tracking/summary.rs"]
mod summary;
#[path = "range_dependency_tracking/table_refs.rs"]
mod table_refs;
#[path = "range_dependency_tracking/three_d.rs"]
mod three_d;
#[cfg(feature = "audit-tests")]
#[path = "range_dependency_tracking/v2_matrix.rs"]
mod v2_matrix;

#[test]
fn class_ii_fullcol_family() {
    fullcol::class_ii_fullcol_family();
}

#[test]
fn class_ii_indirect_family() {
    indirect::class_ii_indirect_family();
}

#[test]
fn class_ii_offset_family() {
    offset::class_ii_offset_family();
}

#[test]
fn class_ii_named_family() {
    named::class_ii_named_family();
}

#[test]
fn class_ii_3d_family() {
    three_d::class_ii_3d_family();
}

#[test]
fn class_ii_table_refs_family_deferred() {
    table_refs::class_ii_table_refs_family_deferred();
}

#[test]
fn regression_ib6cymnt_fullcol_bbox_extent_miss() {
    regression_ib6cymnt::regression_ib6cymnt_fullcol_bbox_extent_miss();
}

#[cfg(feature = "audit-tests")]
#[test]
fn class_ii_total_summary() {
    audit_summary::class_ii_total_summary();
}

macro_rules! class_ii_matrix_edit_value_test {
    ($name:ident, $label:expr, $edit:expr, $value:expr) => {
        #[cfg(feature = "audit-tests")]
        #[test]
        fn $name() {
            let (_p, failed, _fail_list) = v2_matrix::run_class_ii_v2_split($label, $edit, $value);
            assert_eq!(
                failed, 0,
                "Class II V2 ({}): {} failures — see stderr above.",
                $label, failed
            );
        }
    };
}

// 5 EditPositions × 13 ValueTypes = 65 audit-only tests, each iterates 20
// full-column cases (4 shapes × 5 extents).
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_int,
    "inside__int",
    V2EditPos::Inside,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_largeint,
    "inside__largeint",
    V2EditPos::Inside,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_floatclean,
    "inside__floatclean",
    V2EditPos::Inside,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_floatcascade,
    "inside__floatcascade",
    V2EditPos::Inside,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_bool,
    "inside__bool",
    V2EditPos::Inside,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_textshort,
    "inside__textshort",
    V2EditPos::Inside,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_textlong,
    "inside__textlong",
    V2EditPos::Inside,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_leadingapos,
    "inside__leadingapos",
    V2EditPos::Inside,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_whitespace,
    "inside__whitespace",
    V2EditPos::Inside,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_nullempty,
    "inside__nullempty",
    V2EditPos::Inside,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_error,
    "inside__error",
    V2EditPos::Inside,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_dateserial,
    "inside__dateserial",
    V2EditPos::Inside,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_timeserial,
    "inside__timeserial",
    V2EditPos::Inside,
    V2ValueType::TimeSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_int,
    "outside_nearby__int",
    V2EditPos::OutsideNearby,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_largeint,
    "outside_nearby__largeint",
    V2EditPos::OutsideNearby,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_floatclean,
    "outside_nearby__floatclean",
    V2EditPos::OutsideNearby,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_floatcascade,
    "outside_nearby__floatcascade",
    V2EditPos::OutsideNearby,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_bool,
    "outside_nearby__bool",
    V2EditPos::OutsideNearby,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_textshort,
    "outside_nearby__textshort",
    V2EditPos::OutsideNearby,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_textlong,
    "outside_nearby__textlong",
    V2EditPos::OutsideNearby,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_leadingapos,
    "outside_nearby__leadingapos",
    V2EditPos::OutsideNearby,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_whitespace,
    "outside_nearby__whitespace",
    V2EditPos::OutsideNearby,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_nullempty,
    "outside_nearby__nullempty",
    V2EditPos::OutsideNearby,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_error,
    "outside_nearby__error",
    V2EditPos::OutsideNearby,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_dateserial,
    "outside_nearby__dateserial",
    V2EditPos::OutsideNearby,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_timeserial,
    "outside_nearby__timeserial",
    V2EditPos::OutsideNearby,
    V2ValueType::TimeSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_int,
    "far_outside__int",
    V2EditPos::FarOutside,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_largeint,
    "far_outside__largeint",
    V2EditPos::FarOutside,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_floatclean,
    "far_outside__floatclean",
    V2EditPos::FarOutside,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_floatcascade,
    "far_outside__floatcascade",
    V2EditPos::FarOutside,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_bool,
    "far_outside__bool",
    V2EditPos::FarOutside,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_textshort,
    "far_outside__textshort",
    V2EditPos::FarOutside,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_textlong,
    "far_outside__textlong",
    V2EditPos::FarOutside,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_leadingapos,
    "far_outside__leadingapos",
    V2EditPos::FarOutside,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_whitespace,
    "far_outside__whitespace",
    V2EditPos::FarOutside,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_nullempty,
    "far_outside__nullempty",
    V2EditPos::FarOutside,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_error,
    "far_outside__error",
    V2EditPos::FarOutside,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_dateserial,
    "far_outside__dateserial",
    V2EditPos::FarOutside,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_timeserial,
    "far_outside__timeserial",
    V2EditPos::FarOutside,
    V2ValueType::TimeSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_int,
    "boundary__int",
    V2EditPos::Boundary,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_largeint,
    "boundary__largeint",
    V2EditPos::Boundary,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_floatclean,
    "boundary__floatclean",
    V2EditPos::Boundary,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_floatcascade,
    "boundary__floatcascade",
    V2EditPos::Boundary,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_bool,
    "boundary__bool",
    V2EditPos::Boundary,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_textshort,
    "boundary__textshort",
    V2EditPos::Boundary,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_textlong,
    "boundary__textlong",
    V2EditPos::Boundary,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_leadingapos,
    "boundary__leadingapos",
    V2EditPos::Boundary,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_whitespace,
    "boundary__whitespace",
    V2EditPos::Boundary,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_nullempty,
    "boundary__nullempty",
    V2EditPos::Boundary,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_error,
    "boundary__error",
    V2EditPos::Boundary,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_dateserial,
    "boundary__dateserial",
    V2EditPos::Boundary,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_timeserial,
    "boundary__timeserial",
    V2EditPos::Boundary,
    V2ValueType::TimeSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_int,
    "other_sheet__int",
    V2EditPos::OtherSheet,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_largeint,
    "other_sheet__largeint",
    V2EditPos::OtherSheet,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_floatclean,
    "other_sheet__floatclean",
    V2EditPos::OtherSheet,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_floatcascade,
    "other_sheet__floatcascade",
    V2EditPos::OtherSheet,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_bool,
    "other_sheet__bool",
    V2EditPos::OtherSheet,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_textshort,
    "other_sheet__textshort",
    V2EditPos::OtherSheet,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_textlong,
    "other_sheet__textlong",
    V2EditPos::OtherSheet,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_leadingapos,
    "other_sheet__leadingapos",
    V2EditPos::OtherSheet,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_whitespace,
    "other_sheet__whitespace",
    V2EditPos::OtherSheet,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_nullempty,
    "other_sheet__nullempty",
    V2EditPos::OtherSheet,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_error,
    "other_sheet__error",
    V2EditPos::OtherSheet,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_dateserial,
    "other_sheet__dateserial",
    V2EditPos::OtherSheet,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_timeserial,
    "other_sheet__timeserial",
    V2EditPos::OtherSheet,
    V2ValueType::TimeSerial
);
