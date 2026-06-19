//! Sparkline bridge functions (orphan rule workaround).
//!
//! Sparkline types live in `domain_types::domain::sparkline` —
//! import from there directly.

use domain_types::domain::sparkline::SparklineDataRange;

use super::ranges::PositionRange;

// ============================================================================
// Bridge: SparklineDataRange <-> PositionRange (cell-types SheetRange)
//
// Cannot use `From` impls because both types are from external crates (orphan rule).
// ============================================================================

pub fn sparkline_data_range_to_position_range(r: &SparklineDataRange) -> PositionRange {
    PositionRange::new(r.start_row, r.start_col, r.end_row, r.end_col)
}

pub fn position_range_to_sparkline_data_range(r: &PositionRange) -> SparklineDataRange {
    SparklineDataRange {
        source_sheet_name: None,
        start_row: r.start_row(),
        start_col: r.start_col(),
        end_row: r.end_row(),
        end_col: r.end_col(),
    }
}
