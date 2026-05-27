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
            // Excel's naming is inverted: r1 ("row input cell") receives top-row
            // (col-varying) values, r2 ("column input cell") receives left-column
            // (row-varying) values. Swap here so downstream semantics are correct.
            row_input_ref: dt.col_input_ref,
            col_input_ref: dt.row_input_ref,
            ooxml_flags: dt.ooxml_flags.clone(),
        })
        .collect()
}
