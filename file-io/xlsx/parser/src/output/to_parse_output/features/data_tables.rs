use super::*;

// =============================================================================
// Domain conversions: Data table regions
// =============================================================================

/// Convert parser `DataTableInfo` items (per-sheet) into domain `DataTableRegion` items.
///
/// Typed data-table input refs: input refs are typed `Option<CellRef>` on both sides — this
/// is a pure structural copy plus the r1/r2 swap. No string round-trip; the
/// lowering boundary is stateless.
pub(crate) fn convert_data_tables(
    tables: &[DataTableInfo],
    sheet_index: u32,
) -> Vec<DataTableRegion> {
    tables
        .iter()
        .map(|dt| DataTableRegion {
            sheet_index,
            start_row: dt.start_row,
            start_col: dt.start_col,
            end_row: dt.end_row,
            end_col: dt.end_col,
            // Two-variable tables and dtr=1 use r1 for top-row values.
            // A one-variable dtr=0 table instead uses r1 for left-column
            // values. Domain "row" means row-varying, not Excel's UI label.
            row_input_ref: if dt.ooxml_flags.as_ref().is_some_and(|f| !f.dt2d && !f.dtr) {
                dt.row_input_ref
            } else {
                dt.col_input_ref
            },
            col_input_ref: if dt.ooxml_flags.as_ref().is_some_and(|f| !f.dt2d && !f.dtr) {
                dt.col_input_ref
            } else {
                dt.row_input_ref
            },
            ooxml_flags: dt.ooxml_flags.clone(),
        })
        .collect()
}
