//! Office.js `Range` structural operations.
//!
//! This module is deliberately a translation boundary.  Range insert/delete
//! operations must move the engine's existing cell identities so formulas,
//! formats, and references follow the moved cells.  Merge operations must use
//! the engine merge implementation as well: it retains the origin cell and
//! applies Excel's child-cell data-loss behavior.  Copying values through the
//! Office host would lose those semantics.

use compute_api::{CellRange, ComputeApiError, Sheet};
use serde::Deserialize;

use crate::range_navigation::{parse_range_address, RangeNavigationError};

/// Error returned by a Range structural operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RangeStructureError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// A bounded, validated range in zero-based worksheet coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RangeBounds {
    pub(crate) start_row: u32,
    pub(crate) start_col: u32,
    pub(crate) end_row: u32,
    pub(crate) end_col: u32,
}

/// The two documented values accepted by `Excel.GroupOption`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GroupOption {
    ByRows,
    ByColumns,
}

impl GroupOption {
    pub(crate) fn from_wire(value: &str) -> Result<Self, RangeStructureError> {
        match value {
            "ByRows" => Ok(Self::ByRows),
            "ByColumns" => Ok(Self::ByColumns),
            other => Err(invalid(format!(
                "Range group option must be 'ByRows' or 'ByColumns', got '{other}'"
            ))),
        }
    }
}

/// The scalar result exposed by `Excel.Range.removeDuplicates`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RemoveDuplicatesResult {
    pub(crate) removed: u32,
    pub(crate) unique_remaining: u32,
}

/// The compute-api result payload uses names from its lower-level operation.
/// Keep that translation private so the Office.js result remains the exact
/// `removed`/`uniqueRemaining` contract from the pinned declarations.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComputeRemoveDuplicatesResult {
    duplicates_removed: u32,
    unique_values_remaining: u32,
}

impl RangeBounds {
    fn row_count(self) -> Result<u32, RangeStructureError> {
        self.end_row
            .checked_sub(self.start_row)
            .and_then(|span| span.checked_add(1))
            .ok_or_else(|| invalid("Range row bounds are inverted"))
    }

    fn col_count(self) -> Result<u32, RangeStructureError> {
        self.end_col
            .checked_sub(self.start_col)
            .and_then(|span| span.checked_add(1))
            .ok_or_else(|| invalid("Range column bounds are inverted"))
    }
}

/// The two documented values accepted by `Excel.Range.insert`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InsertShiftDirection {
    Down,
    Right,
}

impl InsertShiftDirection {
    pub(crate) fn from_wire(value: &str) -> Result<Self, RangeStructureError> {
        match value {
            "Down" => Ok(Self::Down),
            "Right" => Ok(Self::Right),
            other => Err(invalid(format!(
                "Range.insert shift must be 'Down' or 'Right', got '{other}'"
            ))),
        }
    }

    fn shifts_right(self) -> bool {
        matches!(self, Self::Right)
    }
}

/// The two documented values accepted by `Excel.Range.delete`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeleteShiftDirection {
    Up,
    Left,
}

impl DeleteShiftDirection {
    pub(crate) fn from_wire(value: &str) -> Result<Self, RangeStructureError> {
        match value {
            "Up" => Ok(Self::Up),
            "Left" => Ok(Self::Left),
            other => Err(invalid(format!(
                "Range.delete shift must be 'Up' or 'Left', got '{other}'"
            ))),
        }
    }

    fn shifts_left(self) -> bool {
        matches!(self, Self::Left)
    }
}

/// Insert the current range and return the same bounded address.
///
/// The returned address is the blank space created by the insertion.  The
/// caller uses it to bind the `Range` proxy returned by `Range.insert`; the
/// engine mutation itself is performed by `SheetStructure`.
pub(crate) fn insert(
    sheet: &Sheet,
    address: &str,
    shift: &str,
) -> Result<RangeBounds, RangeStructureError> {
    let bounds = parse_bounds(address)?;
    let direction = InsertShiftDirection::from_wire(shift)?;
    let row_count = bounds.row_count()?;
    let col_count = bounds.col_count()?;

    sheet
        .structure()
        .insert_cells_with_shift(
            bounds.start_row,
            bounds.start_col,
            row_count,
            col_count,
            direction.shifts_right(),
        )
        .map_err(engine)?;
    Ok(bounds)
}

/// Delete the current range and shift adjacent cells in the requested
/// direction.
pub(crate) fn delete(sheet: &Sheet, address: &str, shift: &str) -> Result<(), RangeStructureError> {
    let bounds = parse_bounds(address)?;
    let direction = DeleteShiftDirection::from_wire(shift)?;
    let row_count = bounds.row_count()?;
    let col_count = bounds.col_count()?;

    sheet
        .structure()
        .delete_cells_with_shift(
            bounds.start_row,
            bounds.start_col,
            row_count,
            col_count,
            direction.shifts_left(),
        )
        .map_err(engine)?;
    Ok(())
}

/// Merge the current range.  When `across` is true, the engine creates one
/// merge per row, matching `Range.merge(true)`.
pub(crate) fn merge(sheet: &Sheet, address: &str, across: bool) -> Result<(), RangeStructureError> {
    let bounds = parse_bounds(address)?;
    if across {
        sheet
            .structure()
            .merge_across(
                bounds.start_row,
                bounds.start_col,
                bounds.end_row,
                bounds.end_col,
            )
            .map_err(engine)?;
    } else {
        sheet
            .structure()
            .merge_range(
                bounds.start_row,
                bounds.start_col,
                bounds.end_row,
                bounds.end_col,
            )
            .map_err(engine)?;
    }
    Ok(())
}

/// Unmerge merge regions whose origins are in the current range.
pub(crate) fn unmerge(sheet: &Sheet, address: &str) -> Result<(), RangeStructureError> {
    let bounds = parse_bounds(address)?;
    sheet
        .structure()
        .unmerge_range(
            bounds.start_row,
            bounds.start_col,
            bounds.end_row,
            bounds.end_col,
        )
        .map_err(engine)?;
    Ok(())
}

/// Remove duplicate rows from the current range through `SheetStructure`.
///
/// Office.js column indexes are relative to the range.  The compute-api
/// primitive receives worksheet column indexes, so translate them after
/// validating that every selected column is inside this range.  Passing an
/// out-of-range index through would make the lower layer silently ignore the
/// selection and report that no rows were removed.
///
/// The production primitive currently compacts authored values only; it does
/// not carry formulas or cell properties along with a copied row. Keep that
/// fidelity gap at the core boundary rather than reconstructing rows here,
/// since a proxy-side copy would lose the engine's identity semantics.
pub(crate) fn remove_duplicates(
    sheet: &Sheet,
    address: &str,
    columns: &[u32],
    includes_header: bool,
) -> Result<RemoveDuplicatesResult, RangeStructureError> {
    if columns.is_empty() {
        return Err(invalid(
            "Range.removeDuplicates requires at least one column",
        ));
    }

    let bounds = parse_bounds(address)?;
    let absolute_columns = columns
        .iter()
        .copied()
        .map(|column| {
            if column >= bounds.col_count()? {
                return Err(invalid(format!(
                    "Range.removeDuplicates column index {column} is outside the range"
                )));
            }
            bounds
                .start_col
                .checked_add(column)
                .ok_or_else(|| invalid("Range.removeDuplicates column index overflowed"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let result = sheet
        .structure()
        .remove_duplicates(
            bounds.start_row,
            bounds.start_col,
            bounds.end_row,
            bounds.end_col,
            absolute_columns,
            includes_header,
        )
        .map_err(engine)?;

    let data = result
        .extract_data::<ComputeRemoveDuplicatesResult>()
        .ok_or_else(|| engine("SheetStructure.remove_duplicates returned no result data"))?;
    Ok(RemoveDuplicatesResult {
        removed: data.duplicates_removed,
        unique_remaining: data.unique_values_remaining,
    })
}

/// Group rows or columns in the current range through `SheetOutline`.
///
/// A full-row/full-column range rejects the opposite axis, matching the
/// Office.js `groupOption` contract.  For a bounded cell range, the selected
/// option chooses the corresponding row or column span, which also matches
/// the Office.js ungroup examples that pass a rectangular range.
pub(crate) fn group(
    sheet: &Sheet,
    address: &str,
    group_option: &str,
) -> Result<(), RangeStructureError> {
    apply_grouping(sheet, address, group_option, false)
}

/// Remove the innermost row or column groups intersecting the current range.
pub(crate) fn ungroup(
    sheet: &Sheet,
    address: &str,
    group_option: &str,
) -> Result<(), RangeStructureError> {
    apply_grouping(sheet, address, group_option, true)
}

fn apply_grouping(
    sheet: &Sheet,
    address: &str,
    group_option: &str,
    ungroup: bool,
) -> Result<(), RangeStructureError> {
    let parsed = parse_range_address(sheet, address).map_err(map_navigation_error)?;
    let option = GroupOption::from_wire(group_option)?;
    if parsed.is_whole_sheet() {
        return Err(invalid(
            "Range group operations require a row, column, or bounded cell range",
        ));
    }
    if parsed.is_entire_row() && matches!(option, GroupOption::ByColumns) {
        return Err(invalid("A full-row range cannot be grouped by columns"));
    }
    if parsed.is_entire_column() && matches!(option, GroupOption::ByRows) {
        return Err(invalid("A full-column range cannot be grouped by rows"));
    }

    let (start_row, start_col, end_row, end_col) = parsed.bounds();
    let outline = sheet.outline();
    match (option, ungroup) {
        (GroupOption::ByRows, false) => outline
            .group_rows(start_row, end_row)
            .map_err(engine)
            .map(|_| ()),
        (GroupOption::ByRows, true) => outline
            .ungroup_rows(start_row, end_row)
            .map_err(engine)
            .map(|_| ()),
        (GroupOption::ByColumns, false) => outline
            .group_columns(start_col, end_col)
            .map_err(engine)
            .map(|_| ()),
        (GroupOption::ByColumns, true) => outline
            .ungroup_columns(start_col, end_col)
            .map_err(engine)
            .map(|_| ()),
    }
}

/// Parse a bounded A1 address for a structural operation.
///
/// Qualified addresses are accepted because `Worksheet.getRange` accepts
/// them.  The host has already validated that a qualifier belongs to the
/// current worksheet; this helper only removes it before handing the cell
/// reference to `compute-api::CellRange`.
pub(crate) fn parse_bounds(address: &str) -> Result<RangeBounds, RangeStructureError> {
    let address = address.trim();
    if address.is_empty() {
        return Err(invalid("Range address cannot be empty"));
    }

    let reference = address
        .rsplit_once('!')
        .map(|(_, reference)| reference.trim())
        .unwrap_or(address);
    if reference.is_empty() {
        return Err(invalid(format!("Invalid range address '{address}'")));
    }

    let (start_row, start_col, end_row, end_col) = CellRange::from(reference)
        .resolve()
        .map_err(map_address_error)?;
    if start_row > end_row {
        return Err(invalid(format!(
            "Range '{address}' has start row {start_row} after end row {end_row}"
        )));
    }
    if start_col > end_col {
        return Err(invalid(format!(
            "Range '{address}' has start column {start_col} after end column {end_col}"
        )));
    }

    Ok(RangeBounds {
        start_row,
        start_col,
        end_row,
        end_col,
    })
}

fn map_address_error(error: ComputeApiError) -> RangeStructureError {
    match error {
        ComputeApiError::InvalidAddress { address, reason } => {
            invalid(format!("invalid address: {address} — {reason}"))
        }
        ComputeApiError::InvalidRange { range, reason } => {
            invalid(format!("invalid range: {range} — {reason}"))
        }
        other => engine(other),
    }
}

fn map_navigation_error(error: RangeNavigationError) -> RangeStructureError {
    RangeStructureError {
        code: error.code,
        message: error.message,
    }
}

fn invalid(message: impl Into<String>) -> RangeStructureError {
    RangeStructureError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn engine(error: impl std::fmt::Display) -> RangeStructureError {
    RangeStructureError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bounded_and_qualified_addresses() {
        assert_eq!(
            parse_bounds("'Sheet 1'!$B$2:$D$5").unwrap(),
            RangeBounds {
                start_row: 1,
                start_col: 1,
                end_row: 4,
                end_col: 3,
            }
        );
    }

    #[test]
    fn rejects_inverted_and_unbounded_addresses() {
        assert_eq!(parse_bounds("B2:A1").unwrap_err().code, "InvalidArgument");
        assert_eq!(parse_bounds("1:1").unwrap_err().code, "InvalidArgument");
        assert_eq!(parse_bounds("A:A").unwrap_err().code, "InvalidArgument");
    }

    #[test]
    fn shift_directions_are_exact_wire_tokens() {
        assert_eq!(
            InsertShiftDirection::from_wire("Down").unwrap(),
            InsertShiftDirection::Down
        );
        assert_eq!(
            InsertShiftDirection::from_wire("Right").unwrap(),
            InsertShiftDirection::Right
        );
        assert_eq!(
            DeleteShiftDirection::from_wire("Up").unwrap(),
            DeleteShiftDirection::Up
        );
        assert_eq!(
            DeleteShiftDirection::from_wire("Left").unwrap(),
            DeleteShiftDirection::Left
        );
        assert!(InsertShiftDirection::from_wire("down").is_err());
        assert!(DeleteShiftDirection::from_wire("right").is_err());
    }

    #[test]
    fn group_options_are_exact_wire_tokens() {
        assert_eq!(
            GroupOption::from_wire("ByRows").unwrap(),
            GroupOption::ByRows
        );
        assert_eq!(
            GroupOption::from_wire("ByColumns").unwrap(),
            GroupOption::ByColumns
        );
        assert!(GroupOption::from_wire("Rows").is_err());
        assert!(GroupOption::from_wire("byRows").is_err());
    }

    #[test]
    fn remove_duplicates_result_uses_office_scalar_names() {
        let json = serde_json::json!({
            "duplicatesRemoved": 3,
            "uniqueValuesRemaining": 5
        });
        let result: ComputeRemoveDuplicatesResult = serde_json::from_value(json).unwrap();
        assert_eq!(result.duplicates_removed, 3);
        assert_eq!(result.unique_values_remaining, 5);
    }
}
