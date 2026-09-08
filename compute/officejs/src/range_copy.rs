//! Office.js `Range.copyFrom` and `Range.moveTo` adapters.
//!
//! The JavaScript proxy only records the source/destination object path.  This
//! module resolves bounded A1 ranges and routes the mutation to the typed
//! `compute-api` facade.  `copyFrom` deliberately uses the engine's copy
//! mutation, which preserves formulas and formats according to `CopyType`;
//! `moveTo` uses the identity-preserving relocation mutation rather than the
//! legacy value-only relocation helper.

use compute_api::{CellRange, ComputeApiError, CopyType, Sheet};

/// Number of rows and columns in the Excel worksheet grid.
const LAST_ROW: u32 = 1_048_575;
const LAST_COLUMN: u32 = 16_383;

/// Error returned by the Office.js range-copy boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RangeCopyError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl RangeCopyError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidArgument",
            message: message.into(),
        }
    }

    fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "UnsupportedOperation",
            message: message.into(),
        }
    }
}

impl From<ComputeApiError> for RangeCopyError {
    fn from(error: ComputeApiError) -> Self {
        match error {
            ComputeApiError::InvalidAddress { .. }
            | ComputeApiError::InvalidRange { .. }
            | ComputeApiError::InvalidOperation(_) => Self::invalid(error.to_string()),
            ComputeApiError::SheetNotFound { .. } => Self {
                code: "ItemNotFound",
                message: error.to_string(),
            },
            other => Self {
                code: "GeneralException",
                message: other.to_string(),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Bounds {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

impl Bounds {
    fn parse(address: &str, operation: &str) -> Result<Self, RangeCopyError> {
        let (start_row, start_col, end_row, end_col) = CellRange::from(address)
            .resolve()
            .map_err(|error| RangeCopyError::invalid(format!("{operation}: {error}")))?;
        if start_row > end_row || start_col > end_col {
            return Err(RangeCopyError::invalid(format!(
                "{operation} range '{address}' has its end before its start"
            )));
        }
        if end_row > LAST_ROW || end_col > LAST_COLUMN {
            return Err(RangeCopyError::invalid(format!(
                "{operation} range '{address}' exceeds the worksheet grid"
            )));
        }
        Ok(Self {
            start_row,
            start_col,
            end_row,
            end_col,
        })
    }

    fn rows(self) -> u32 {
        self.end_row - self.start_row + 1
    }

    fn cols(self) -> u32 {
        self.end_col - self.start_col + 1
    }
}

/// Parse the Office.js `RangeCopyType` wire token.
///
/// `Link` is part of the pinned declaration but the compute engine has no
/// linked-data copy primitive.  Keep it explicit so it cannot silently become
/// an ordinary value copy.
pub(crate) fn copy_type(value: &str) -> Result<CopyType, RangeCopyError> {
    match value {
        "All" => Ok(CopyType::All),
        "Formulas" => Ok(CopyType::Formulas),
        "Values" => Ok(CopyType::Values),
        "Formats" => Ok(CopyType::Formats),
        "Link" => Err(RangeCopyError::unsupported(
            "Range.copyFrom copyType 'Link' requires linked-data support, which this engine does not provide",
        )),
        other => Err(RangeCopyError::invalid(format!(
            "Unsupported Range.copyFrom copyType '{other}'"
        ))),
    }
}

fn validate_extent(
    start_row: u32,
    start_col: u32,
    rows: u32,
    cols: u32,
    operation: &str,
) -> Result<(), RangeCopyError> {
    let end_row = start_row.checked_add(rows.checked_sub(1).ok_or_else(|| {
        RangeCopyError::invalid(format!("{operation} requires a non-empty source range"))
    })?);
    let end_col = start_col.checked_add(cols.checked_sub(1).ok_or_else(|| {
        RangeCopyError::invalid(format!("{operation} requires a non-empty source range"))
    })?);
    if end_row.is_none_or(|row| row > LAST_ROW) || end_col.is_none_or(|col| col > LAST_COLUMN) {
        return Err(RangeCopyError::invalid(format!(
            "{operation} destination exceeds the worksheet grid"
        )));
    }
    Ok(())
}

/// Copy a source range to the current destination range.
///
/// The source and target addresses are unqualified, canonical A1 ranges.  A
/// host resolving a sheet-qualified Office.js string must select the source
/// sheet first and pass only its range portion here.  The destination starts at
/// the top-left cell of `target_address`; when it is smaller than the source,
/// the target is expanded.  Exact multiples of the source shape are repeated
/// using the same production copy mutation for each tile.
pub(crate) fn copy_from(
    source_sheet: &Sheet,
    source_address: &str,
    target_sheet: &Sheet,
    target_address: &str,
    copy_type_wire: &str,
    skip_blanks: bool,
    transpose: bool,
) -> Result<(), RangeCopyError> {
    let copy_type = copy_type(copy_type_wire)?;
    let source = Bounds::parse(source_address, "Range.copyFrom source")?;
    let target = Bounds::parse(target_address, "Range.copyFrom destination")?;

    let source_rows = source.rows();
    let source_cols = source.cols();
    let tile_rows = if transpose { source_cols } else { source_rows };
    let tile_cols = if transpose { source_rows } else { source_cols };

    // Office.js expands a destination that is smaller than the source.  When
    // the destination is larger, a source is repeated only along dimensions
    // that are exact multiples; a non-multiple dimension receives one source
    // tile and retains cells beyond that tile.
    let target_rows = target.rows().max(tile_rows);
    let target_cols = target.cols().max(tile_cols);
    let row_tiles = if target.rows() > tile_rows && target.rows() % tile_rows == 0 {
        target.rows() / tile_rows
    } else {
        1
    };
    let col_tiles = if target.cols() > tile_cols && target.cols() % tile_cols == 0 {
        target.cols() / tile_cols
    } else {
        1
    };
    validate_extent(
        target.start_row,
        target.start_col,
        target_rows,
        target_cols,
        "Range.copyFrom",
    )?;

    // The engine snapshots its source for each individual copy mutation. When
    // an exact-multiple destination overlaps the source, issuing every tile
    // against the original source would let an earlier tile overwrite source
    // cells needed by a later tile. For the ordinary (non-skip-blanks) copy
    // contract, the first destination tile is itself a complete source
    // snapshot; use it as the source for subsequent tiles. Formula rebasing
    // composes across that first copy, and transposition is applied only on
    // the first leg so later tiles retain the transposed shape.
    //
    // With skipBlanks, a blank source cell intentionally leaves the first
    // destination tile's existing value in place, so that tile cannot be used
    // as a faithful source snapshot. Keep the original source for each tile
    // in that mode; the engine still snapshots each individual operation.
    let mut use_staged_source = !skip_blanks && (row_tiles > 1 || col_tiles > 1);
    let mut copy_source_sheet = source_sheet;
    let mut copy_source = source;
    let mut copy_transpose = transpose;

    for row_tile in 0..row_tiles {
        for col_tile in 0..col_tiles {
            let row_offset = row_tile
                .checked_mul(tile_rows)
                .ok_or_else(|| RangeCopyError::invalid("Range.copyFrom destination overflow"))?;
            let col_offset = col_tile
                .checked_mul(tile_cols)
                .ok_or_else(|| RangeCopyError::invalid("Range.copyFrom destination overflow"))?;
            let destination_row = target
                .start_row
                .checked_add(row_offset)
                .ok_or_else(|| RangeCopyError::invalid("Range.copyFrom destination overflow"))?;
            let destination_col = target
                .start_col
                .checked_add(col_offset)
                .ok_or_else(|| RangeCopyError::invalid("Range.copyFrom destination overflow"))?;

            target_sheet
                .copy_range(
                    copy_source_sheet.id(),
                    copy_source.start_row,
                    copy_source.start_col,
                    copy_source.end_row,
                    copy_source.end_col,
                    destination_row,
                    destination_col,
                    copy_type,
                    skip_blanks,
                    copy_transpose,
                )
                .map_err(RangeCopyError::from)?;

            if use_staged_source {
                // Every destination tile has the transposed dimensions after
                // the first copy. It is safe to switch to the first tile as a
                // source because all later copies use the same target sheet.
                let staged_end_row =
                    destination_row.checked_add(tile_rows - 1).ok_or_else(|| {
                        RangeCopyError::invalid("Range.copyFrom destination overflow")
                    })?;
                let staged_end_col =
                    destination_col.checked_add(tile_cols - 1).ok_or_else(|| {
                        RangeCopyError::invalid("Range.copyFrom destination overflow")
                    })?;
                copy_source_sheet = target_sheet;
                copy_source = Bounds {
                    start_row: destination_row,
                    start_col: destination_col,
                    end_row: staged_end_row,
                    end_col: staged_end_col,
                };
                copy_transpose = false;
                use_staged_source = false;
            }
        }
    }
    Ok(())
}

/// Move the source range to the top-left cell of the destination range.
///
/// This calls the CellId-preserving relocation facade.  Moving the source
/// range therefore carries formulas, formats, and references with the cells;
/// callers must not substitute the legacy value-only `relocate_cells` method.
pub(crate) fn move_to(
    source_sheet: &Sheet,
    source_address: &str,
    target_sheet: &Sheet,
    target_address: &str,
) -> Result<(), RangeCopyError> {
    let source = Bounds::parse(source_address, "Range.moveTo source")?;
    let target = Bounds::parse(target_address, "Range.moveTo destination")?;
    validate_extent(
        target.start_row,
        target.start_col,
        source.rows(),
        source.cols(),
        "Range.moveTo",
    )?;

    target_sheet
        .relocate_cells_yrs(
            source_sheet.id(),
            source.start_row,
            source.start_col,
            source.end_row,
            source.end_col,
            target.start_row,
            target.start_col,
        )
        .map_err(RangeCopyError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_type_maps_supported_tokens_and_rejects_link() {
        assert_eq!(copy_type("All").unwrap(), CopyType::All);
        assert_eq!(copy_type("Formulas").unwrap(), CopyType::Formulas);
        assert_eq!(copy_type("Values").unwrap(), CopyType::Values);
        assert_eq!(copy_type("Formats").unwrap(), CopyType::Formats);
        assert_eq!(copy_type("Link").unwrap_err().code, "UnsupportedOperation");
    }

    #[test]
    fn copy_destination_expansion_checks_the_transposed_extent() {
        let target = Bounds::parse("XFD1", "target").unwrap();
        assert!(validate_extent(target.start_row, target.start_col, 1, 2, "copy").is_err());
        assert!(validate_extent(0, 0, 2, 1, "copy").is_ok());
    }
}
