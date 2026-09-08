use compute_api::Sheet;
use serde_json::Value;

/// The number of rows in an Excel worksheet.
pub(crate) const EXCEL_MAX_ROWS: u32 = 1_048_576;
/// The number of columns in an Excel worksheet.
pub(crate) const EXCEL_MAX_COLUMNS: u32 = 16_384;

const LAST_ROW: u32 = EXCEL_MAX_ROWS - 1;
const LAST_COLUMN: u32 = EXCEL_MAX_COLUMNS - 1;

/// The address shape carried by an Office.js Range proxy.
///
/// `WholeSheet` is used for `Worksheet.getRange()` (an omitted address). A
/// textual full-row or full-column address remains tagged as `Rows` or
/// `Columns`, even when it happens to cover the complete worksheet extent.
/// This prevents the host from accidentally treating an unbounded range as a
/// bounded cell matrix for values/formulas or formatting operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RangeAddress {
    WholeSheet,
    Rows {
        start: u32,
        end: u32,
    },
    Columns {
        start: u32,
        end: u32,
    },
    Cells {
        start_row: u32,
        start_column: u32,
        end_row: u32,
        end_column: u32,
    },
}

impl RangeAddress {
    /// Parses an unqualified A1 range or full-row/full-column reference.
    pub(crate) fn parse(raw: &str) -> Result<Self, RangeNavigationError> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(invalid("Range address cannot be empty"));
        }

        let pieces: Vec<&str> = raw.split(':').map(str::trim).collect();
        if pieces.len() == 1 {
            return parse_single_reference(pieces[0], raw);
        }
        if pieces.len() != 2 || pieces.iter().any(|piece| piece.is_empty()) {
            return Err(invalid(format!(
                "Invalid range address '{raw}'; expected A1, A1:B2, row:row, or column:column"
            )));
        }

        if let (Some(start), Some(end)) = (
            parse_row_reference(pieces[0]),
            parse_row_reference(pieces[1]),
        ) {
            return make_rows(start, end, raw);
        }
        if let (Some(start), Some(end)) = (
            parse_column_reference(pieces[0]),
            parse_column_reference(pieces[1]),
        ) {
            return make_columns(start, end, raw);
        }

        let start =
            parse_cell_reference(pieces[0]).map_err(|message| invalid_range(raw, message))?;
        let end = parse_cell_reference(pieces[1]).map_err(|message| invalid_range(raw, message))?;
        make_cells(start.0, start.1, end.0, end.1, raw)
    }

    /// Returns the rectangular worksheet bounds represented by this shape.
    pub(crate) fn bounds(&self) -> (u32, u32, u32, u32) {
        match *self {
            Self::WholeSheet => (0, 0, LAST_ROW, LAST_COLUMN),
            Self::Rows { start, end } => (start, 0, end, LAST_COLUMN),
            Self::Columns { start, end } => (0, start, LAST_ROW, end),
            Self::Cells {
                start_row,
                start_column,
                end_row,
                end_column,
            } => (start_row, start_column, end_row, end_column),
        }
    }

    pub(crate) fn row_count(&self) -> u32 {
        let (start_row, _, end_row, _) = self.bounds();
        end_row - start_row + 1
    }

    pub(crate) fn column_count(&self) -> u32 {
        let (_, start_column, _, end_column) = self.bounds();
        end_column - start_column + 1
    }

    pub(crate) fn cell_count(&self) -> i64 {
        let count = u64::from(self.row_count()) * u64::from(self.column_count());
        if count > i32::MAX as u64 {
            -1
        } else {
            count as i64
        }
    }

    pub(crate) fn is_whole_sheet(&self) -> bool {
        matches!(self, Self::WholeSheet)
    }

    pub(crate) fn is_entire_row(&self) -> bool {
        matches!(self, Self::Rows { .. })
    }

    pub(crate) fn is_entire_column(&self) -> bool {
        matches!(self, Self::Columns { .. })
    }

    /// Renders the unqualified canonical A1 address used by Range metadata.
    pub(crate) fn to_a1(&self) -> String {
        match *self {
            Self::WholeSheet => format!("1:{EXCEL_MAX_ROWS}"),
            Self::Rows { start, end } => format!("{}:{}", start + 1, end + 1),
            Self::Columns { start, end } => {
                format!("{}:{}", column_name(start), column_name(end))
            }
            Self::Cells {
                start_row,
                start_column,
                end_row,
                end_column,
            } => {
                let start = cell_name(start_row, start_column);
                let end = cell_name(end_row, end_column);
                if start == end {
                    start
                } else {
                    format!("{start}:{end}")
                }
            }
        }
    }

    fn flags(&self) -> (bool, bool) {
        match self {
            Self::WholeSheet => (true, true),
            Self::Rows { .. } => (false, true),
            Self::Columns { .. } => (true, false),
            Self::Cells { .. } => (false, false),
        }
    }
}

/// A range returned by a navigation operation.
///
/// The worksheet is retained even though the current family never changes
/// sheets.  That keeps the result directly usable by the host's RangeRef map
/// and lets the host reject cross-sheet Range arguments before geometry runs.
#[derive(Clone)]
pub(crate) struct RangeNavigationResult {
    pub(crate) sheet: Sheet,
    pub(crate) address: RangeAddress,
}

/// Errors returned by the pure navigation dispatcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RangeNavigationError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Apply one queued `Worksheet.getCell` or `Range` navigation operation.
///
/// `address == None` represents `Worksheet.getRange()` and therefore starts
/// at A1 with the complete Excel grid. For `getBoundingRect` and
/// `getIntersection`, the host should resolve Range proxy arguments to their
/// same-sheet canonical address before calling this function. A plain string
/// argument is parsed here, including a sheet-qualified A1 address whose
/// qualifier must match `sheet`.
pub(crate) fn navigate_range(
    sheet: Sheet,
    address: Option<&str>,
    method: &str,
    args: &[Value],
) -> Result<RangeNavigationResult, RangeNavigationError> {
    let current = match address {
        Some(address) => parse_range_address(&sheet, address)?,
        None => RangeAddress::WholeSheet,
    };

    let result = match method {
        // The worksheet method is dispatched with address == None. Treating
        // it as a method alias also makes the helper convenient for callers
        // that have already distinguished Worksheet from Range in the wire
        // operation.
        "worksheet.getCell" | "Worksheet.getCell" => {
            expect_arg_count(method, args, 2)?;
            let row = number_arg(args, 0, method)?;
            let column = number_arg(args, 1, method)?;
            make_cells(row, column, row, column, method)?
        }
        "getCell" => {
            expect_arg_count(method, args, 2)?;
            let row_offset = number_arg(args, 0, method)?;
            let column_offset = number_arg(args, 1, method)?;
            let (start_row, start_column, _, _) = current.bounds();
            let row = checked_add_offset(start_row, i64::from(row_offset), "row", method)?;
            let column =
                checked_add_offset(start_column, i64::from(column_offset), "column", method)?;
            make_cells(row, column, row, column, method)?
        }
        "getRow" => {
            expect_arg_count(method, args, 1)?;
            let index = bounded_index(args, 0, current.row_count(), "row", method)?;
            let (start_row, start_column, _, end_column) = current.bounds();
            let row = start_row + index;
            make_address(
                row,
                start_column,
                row,
                end_column,
                false,
                current.flags().1,
                method,
            )?
        }
        "getColumn" => {
            expect_arg_count(method, args, 1)?;
            let index = bounded_index(args, 0, current.column_count(), "column", method)?;
            let (start_row, start_column, end_row, _) = current.bounds();
            let column = start_column + index;
            make_address(
                start_row,
                column,
                end_row,
                column,
                current.flags().0,
                false,
                method,
            )?
        }
        "getLastCell" => {
            expect_arg_count(method, args, 0)?;
            let (_, _, end_row, end_column) = current.bounds();
            make_cells(end_row, end_column, end_row, end_column, method)?
        }
        "getLastRow" => {
            expect_arg_count(method, args, 0)?;
            let (_, start_column, end_row, end_column) = current.bounds();
            make_address(
                end_row,
                start_column,
                end_row,
                end_column,
                false,
                current.flags().1,
                method,
            )?
        }
        "getLastColumn" => {
            expect_arg_count(method, args, 0)?;
            let (start_row, _, end_row, end_column) = current.bounds();
            make_address(
                start_row,
                end_column,
                end_row,
                end_column,
                current.flags().0,
                false,
                method,
            )?
        }
        "getOffsetRange" => {
            expect_arg_count(method, args, 2)?;
            let row_offset = signed_arg(args, 0, method)?;
            let column_offset = signed_arg(args, 1, method)?;
            offset_range(&current, row_offset, column_offset, method)?
        }
        "getResizedRange" => {
            expect_arg_count(method, args, 2)?;
            let delta_rows = signed_arg(args, 0, method)?;
            let delta_columns = signed_arg(args, 1, method)?;
            resize_range(&current, delta_rows, delta_columns, method)?
        }
        "getAbsoluteResizedRange" => {
            expect_arg_count(method, args, 2)?;
            let rows = positive_size_arg(args, 0, "rows", method)?;
            let columns = positive_size_arg(args, 1, "columns", method)?;
            absolute_resize_range(&current, rows, columns, method)?
        }
        "getRowsAbove" => {
            expect_optional_count(args, method)?;
            let count = optional_count(args, method)?;
            adjacent_rows(&current, count, true, method)?
        }
        "getRowsBelow" => {
            expect_optional_count(args, method)?;
            let count = optional_count(args, method)?;
            adjacent_rows(&current, count, false, method)?
        }
        "getColumnsBefore" => {
            expect_optional_count(args, method)?;
            let count = optional_count(args, method)?;
            adjacent_columns(&current, count, true, method)?
        }
        "getColumnsAfter" => {
            expect_optional_count(args, method)?;
            let count = optional_count(args, method)?;
            adjacent_columns(&current, count, false, method)?
        }
        "getEntireRow" => {
            expect_arg_count(method, args, 0)?;
            let (start_row, _, end_row, _) = current.bounds();
            make_address(start_row, 0, end_row, LAST_COLUMN, false, true, method)?
        }
        "getEntireColumn" => {
            expect_arg_count(method, args, 0)?;
            let (_, start_column, _, end_column) = current.bounds();
            make_address(0, start_column, LAST_ROW, end_column, true, false, method)?
        }
        "getBoundingRect" => {
            expect_arg_count(method, args, 1)?;
            let other = argument_range(&sheet, &args[0], method)?;
            bounding_rect(&current, &other, method)?
        }
        "getIntersection" => {
            expect_arg_count(method, args, 1)?;
            let other = argument_range(&sheet, &args[0], method)?;
            intersection(&current, &other, method)?
        }
        other => {
            return Err(invalid(format!(
                "Unsupported Range navigation method '{other}'"
            )))
        }
    };

    Ok(RangeNavigationResult {
        sheet,
        address: result,
    })
}

/// Parses an A1, full-row, or full-column address and validates an optional
/// worksheet qualifier against `sheet`.
pub(crate) fn parse_range_address(
    sheet: &Sheet,
    raw: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    let raw = raw.trim();
    let Some(separator) = raw.rfind('!') else {
        return RangeAddress::parse(raw);
    };

    let qualifier = raw[..separator].trim();
    let reference = raw[separator + 1..].trim();
    if qualifier.is_empty() || reference.is_empty() {
        return Err(invalid(format!(
            "Invalid sheet-qualified range address '{raw}'"
        )));
    }
    let qualifier = unquote_sheet_name(qualifier).ok_or_else(|| {
        invalid(format!(
            "Invalid worksheet qualifier in range address '{raw}'"
        ))
    })?;
    let sheet_name = sheet.name().map_err(|error| RangeNavigationError {
        code: "GeneralException",
        message: error.to_string(),
    })?;
    if !sheet_name.eq_ignore_ascii_case(&qualifier) {
        return Err(invalid(format!(
            "Range address '{raw}' belongs to worksheet '{qualifier}', not '{sheet_name}'"
        )));
    }
    RangeAddress::parse(reference)
}

fn argument_range(
    sheet: &Sheet,
    value: &Value,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    match value {
        Value::String(address) => parse_range_address(sheet, address),
        // The host may enrich a resolved Range proxy argument before handing
        // it to this pure helper. Accepting an `address` field keeps that
        // contract explicit while still rejecting a raw, unresolved object.
        Value::Object(object) => {
            if let Some(address) = object.get("address").and_then(Value::as_str) {
                parse_range_address(sheet, address)
            } else {
                Err(invalid(format!(
                    "{method} requires a Range object or range address"
                )))
            }
        }
        _ => Err(invalid(format!(
            "{method} requires a Range object or range address"
        ))),
    }
}

fn bounding_rect(
    left: &RangeAddress,
    right: &RangeAddress,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    let (left_start_row, left_start_column, left_end_row, left_end_column) = left.bounds();
    let (right_start_row, right_start_column, right_end_row, right_end_column) = right.bounds();
    make_address(
        left_start_row.min(right_start_row),
        left_start_column.min(right_start_column),
        left_end_row.max(right_end_row),
        left_end_column.max(right_end_column),
        left.flags().0 || right.flags().0,
        left.flags().1 || right.flags().1,
        method,
    )
}

fn intersection(
    left: &RangeAddress,
    right: &RangeAddress,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    let (left_start_row, left_start_column, left_end_row, left_end_column) = left.bounds();
    let (right_start_row, right_start_column, right_end_row, right_end_column) = right.bounds();
    let start_row = left_start_row.max(right_start_row);
    let start_column = left_start_column.max(right_start_column);
    let end_row = left_end_row.min(right_end_row);
    let end_column = left_end_column.min(right_end_column);
    if start_row > end_row || start_column > end_column {
        return Err(RangeNavigationError {
            code: "ItemNotFound",
            message: "The specified ranges do not intersect".to_string(),
        });
    }

    make_address(
        start_row,
        start_column,
        end_row,
        end_column,
        left.flags().0 && right.flags().0,
        left.flags().1 && right.flags().1,
        method,
    )
}

fn offset_range(
    current: &RangeAddress,
    row_offset: i64,
    column_offset: i64,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    let (start_row, start_column, end_row, end_column) = current.bounds();
    let (rows_unbounded, columns_unbounded) = current.flags();
    if (rows_unbounded && row_offset != 0) || (columns_unbounded && column_offset != 0) {
        return Err(invalid(format!(
            "{method} would move an entire worksheet axis outside the worksheet grid"
        )));
    }
    let start_row = checked_add_offset(start_row, row_offset, "row", method)?;
    let start_column = checked_add_offset(start_column, column_offset, "column", method)?;
    let end_row = checked_add_offset(end_row, row_offset, "row", method)?;
    let end_column = checked_add_offset(end_column, column_offset, "column", method)?;
    make_address(
        start_row,
        start_column,
        end_row,
        end_column,
        rows_unbounded,
        columns_unbounded,
        method,
    )
}

fn resize_range(
    current: &RangeAddress,
    delta_rows: i64,
    delta_columns: i64,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    let (start_row, start_column, end_row, end_column) = current.bounds();
    let end_row = checked_add_offset(end_row, delta_rows, "row", method)?;
    let end_column = checked_add_offset(end_column, delta_columns, "column", method)?;
    if end_row < start_row || end_column < start_column {
        return Err(invalid(format!(
            "{method} cannot reduce a range below one row and one column"
        )));
    }
    let (rows_unbounded, columns_unbounded) = current.flags();
    make_address(
        start_row,
        start_column,
        end_row,
        end_column,
        rows_unbounded && end_row == LAST_ROW,
        columns_unbounded && end_column == LAST_COLUMN,
        method,
    )
}

fn absolute_resize_range(
    current: &RangeAddress,
    rows: u32,
    columns: u32,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    let (start_row, start_column, _, _) = current.bounds();
    let end_row = start_row
        .checked_add(rows - 1)
        .ok_or_else(|| invalid(format!("{method} exceeds the worksheet row limit")))?;
    let end_column = start_column
        .checked_add(columns - 1)
        .ok_or_else(|| invalid(format!("{method} exceeds the worksheet column limit")))?;
    if end_row > LAST_ROW || end_column > LAST_COLUMN {
        return Err(invalid(format!("{method} exceeds the worksheet grid")));
    }

    let (rows_unbounded, columns_unbounded) = current.flags();
    make_address(
        start_row,
        start_column,
        end_row,
        end_column,
        rows_unbounded && end_row == LAST_ROW && rows == EXCEL_MAX_ROWS,
        columns_unbounded && end_column == LAST_COLUMN && columns == EXCEL_MAX_COLUMNS,
        method,
    )
}

fn adjacent_rows(
    current: &RangeAddress,
    count: i64,
    above: bool,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    if count == 0 {
        return Err(invalid(format!("{method} count cannot be zero")));
    }
    let (start_row, start_column, end_row, end_column) = current.bounds();
    let (_, columns_unbounded) = current.flags();
    let (start_row, end_row, preserve_columns_unbounded) = if count > 0 {
        let count = u32::try_from(count)
            .map_err(|_| invalid(format!("{method} count is outside the supported range")))?;
        if above {
            if count > start_row {
                return Err(invalid(format!(
                    "{method} would move above the worksheet grid"
                )));
            }
            (start_row - count, start_row - 1, columns_unbounded)
        } else {
            let end = end_row
                .checked_add(count)
                .ok_or_else(|| invalid(format!("{method} exceeds the worksheet grid")))?;
            if end > LAST_ROW {
                return Err(invalid(format!(
                    "{method} would move below the worksheet grid"
                )));
            }
            (end_row + 1, end, columns_unbounded)
        }
    } else {
        let count = count
            .checked_abs()
            .and_then(|count| u32::try_from(count).ok())
            .ok_or_else(|| invalid(format!("{method} count is outside the supported range")))?;
        let parent_rows = end_row - start_row + 1;
        if count > parent_rows {
            return Err(invalid(format!(
                "{method} count exceeds the containing range"
            )));
        }
        if above {
            (start_row, start_row + count - 1, columns_unbounded)
        } else {
            (end_row - count + 1, end_row, columns_unbounded)
        }
    };
    make_address(
        start_row,
        start_column,
        end_row,
        end_column,
        false,
        preserve_columns_unbounded,
        method,
    )
}

fn adjacent_columns(
    current: &RangeAddress,
    count: i64,
    before: bool,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    if count == 0 {
        return Err(invalid(format!("{method} count cannot be zero")));
    }
    let (start_row, start_column, end_row, end_column) = current.bounds();
    let (rows_unbounded, _) = current.flags();
    let (start_column, end_column, preserve_rows_unbounded) = if count > 0 {
        let count = u32::try_from(count)
            .map_err(|_| invalid(format!("{method} count is outside the supported range")))?;
        if before {
            if count > start_column {
                return Err(invalid(format!(
                    "{method} would move before the worksheet grid"
                )));
            }
            (start_column - count, start_column - 1, rows_unbounded)
        } else {
            let end = end_column
                .checked_add(count)
                .ok_or_else(|| invalid(format!("{method} exceeds the worksheet grid")))?;
            if end > LAST_COLUMN {
                return Err(invalid(format!(
                    "{method} would move after the worksheet grid"
                )));
            }
            (end_column + 1, end, rows_unbounded)
        }
    } else {
        let count = count
            .checked_abs()
            .and_then(|count| u32::try_from(count).ok())
            .ok_or_else(|| invalid(format!("{method} count is outside the supported range")))?;
        let parent_columns = end_column - start_column + 1;
        if count > parent_columns {
            return Err(invalid(format!(
                "{method} count exceeds the containing range"
            )));
        }
        if before {
            (start_column, start_column + count - 1, rows_unbounded)
        } else {
            (end_column - count + 1, end_column, rows_unbounded)
        }
    };
    make_address(
        start_row,
        start_column,
        end_row,
        end_column,
        preserve_rows_unbounded,
        false,
        method,
    )
}

fn make_address(
    start_row: u32,
    start_column: u32,
    end_row: u32,
    end_column: u32,
    rows_unbounded: bool,
    columns_unbounded: bool,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    if start_row > end_row || start_column > end_column {
        return Err(invalid(format!("{method} produced an empty range")));
    }
    if end_row > LAST_ROW || end_column > LAST_COLUMN {
        return Err(invalid(format!("{method} exceeds the worksheet grid")));
    }
    if rows_unbounded && end_row != LAST_ROW {
        return Err(invalid(format!(
            "{method} produced an invalid unbounded-row range"
        )));
    }
    if columns_unbounded && end_column != LAST_COLUMN {
        return Err(invalid(format!(
            "{method} produced an invalid unbounded-column range"
        )));
    }
    if rows_unbounded && start_row != 0 {
        return Err(invalid(format!(
            "{method} produced an invalid unbounded-row origin"
        )));
    }
    if columns_unbounded && start_column != 0 {
        return Err(invalid(format!(
            "{method} produced an invalid unbounded-column origin"
        )));
    }

    Ok(match (rows_unbounded, columns_unbounded) {
        (true, true) => RangeAddress::WholeSheet,
        (true, false) => RangeAddress::Columns {
            start: start_column,
            end: end_column,
        },
        (false, true) => RangeAddress::Rows {
            start: start_row,
            end: end_row,
        },
        (false, false) => RangeAddress::Cells {
            start_row,
            start_column,
            end_row,
            end_column,
        },
    })
}

fn make_cells(
    start_row: u32,
    start_column: u32,
    end_row: u32,
    end_column: u32,
    method: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    make_address(
        start_row,
        start_column,
        end_row,
        end_column,
        false,
        false,
        method,
    )
}

fn make_rows(start: u32, end: u32, raw: &str) -> Result<RangeAddress, RangeNavigationError> {
    if start > end {
        return Err(invalid_range(
            raw,
            "the first row must not be below the second row",
        ));
    }
    Ok(RangeAddress::Rows { start, end })
}

fn make_columns(start: u32, end: u32, raw: &str) -> Result<RangeAddress, RangeNavigationError> {
    if start > end {
        return Err(invalid_range(
            raw,
            "the first column must not be to the right of the second column",
        ));
    }
    Ok(RangeAddress::Columns { start, end })
}

fn parse_single_reference(
    reference: &str,
    raw: &str,
) -> Result<RangeAddress, RangeNavigationError> {
    if let Some(row) = parse_row_reference(reference) {
        return Ok(RangeAddress::Rows {
            start: row,
            end: row,
        });
    }
    if let Some(column) = parse_column_reference(reference) {
        return Ok(RangeAddress::Columns {
            start: column,
            end: column,
        });
    }
    let (row, column) =
        parse_cell_reference(reference).map_err(|message| invalid_range(raw, message))?;
    Ok(RangeAddress::Cells {
        start_row: row,
        start_column: column,
        end_row: row,
        end_column: column,
    })
}

fn parse_row_reference(reference: &str) -> Option<u32> {
    let stripped = reference
        .trim()
        .strip_prefix('$')
        .unwrap_or(reference.trim());
    if stripped.is_empty() || !stripped.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    let row = stripped.parse::<u32>().ok()?;
    (1..=EXCEL_MAX_ROWS).contains(&row).then_some(row - 1)
}

fn parse_column_reference(reference: &str) -> Option<u32> {
    let stripped = reference
        .trim()
        .strip_prefix('$')
        .unwrap_or(reference.trim());
    if stripped.is_empty()
        || !stripped
            .chars()
            .all(|character| character.is_ascii_alphabetic())
    {
        return None;
    }
    let mut value = 0u32;
    for character in stripped.bytes() {
        let digit = u32::from(character.to_ascii_uppercase() - b'A' + 1);
        value = value.checked_mul(26)?.checked_add(digit)?;
    }
    (1..=EXCEL_MAX_COLUMNS)
        .contains(&value)
        .then_some(value - 1)
}

fn parse_cell_reference(reference: &str) -> Result<(u32, u32), &'static str> {
    let stripped: String = reference
        .chars()
        .filter(|character| *character != '$')
        .collect();
    let first_digit = stripped
        .find(|character: char| character.is_ascii_digit())
        .ok_or("missing row number")?;
    if first_digit == 0 {
        return Err("missing column letters");
    }
    let column =
        parse_column_reference(&stripped[..first_digit]).ok_or("invalid column letters")?;
    let row = stripped[first_digit..]
        .parse::<u32>()
        .map_err(|_| "invalid row number")?;
    if row == 0 || row > EXCEL_MAX_ROWS {
        return Err("row is outside the worksheet grid");
    }
    Ok((row - 1, column))
}

fn unquote_sheet_name(qualifier: &str) -> Option<String> {
    if qualifier.len() >= 2 && qualifier.starts_with('\'') && qualifier.ends_with('\'') {
        let inner = &qualifier[1..qualifier.len() - 1];
        Some(inner.replace("''", "'"))
    } else if qualifier
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '.')
    {
        Some(qualifier.to_string())
    } else {
        None
    }
}

fn checked_add_offset(
    value: u32,
    offset: i64,
    axis: &str,
    method: &str,
) -> Result<u32, RangeNavigationError> {
    let result = i128::from(value) + i128::from(offset);
    let max = if axis == "row" {
        i128::from(LAST_ROW)
    } else {
        i128::from(LAST_COLUMN)
    };
    if result < 0 || result > max {
        return Err(invalid(format!(
            "{method} produced a {axis} outside the worksheet grid"
        )));
    }
    Ok(result as u32)
}

fn number_arg(args: &[Value], index: usize, method: &str) -> Result<u32, RangeNavigationError> {
    let value = args
        .get(index)
        .ok_or_else(|| invalid(format!("{method} is missing argument {}", index + 1)))?;
    let number = value.as_f64().ok_or_else(|| {
        invalid(format!(
            "{method} argument {} must be an integer",
            index + 1
        ))
    })?;
    if !number.is_finite() || number.fract() != 0.0 || number < 0.0 {
        return Err(invalid(format!(
            "{method} argument {} must be a non-negative integer",
            index + 1
        )));
    }
    if number > f64::from(u32::MAX) {
        return Err(invalid(format!(
            "{method} argument {} is outside the supported range",
            index + 1
        )));
    }
    Ok(number as u32)
}

fn signed_arg(args: &[Value], index: usize, method: &str) -> Result<i64, RangeNavigationError> {
    let value = args
        .get(index)
        .ok_or_else(|| invalid(format!("{method} is missing argument {}", index + 1)))?;
    let number = value.as_f64().ok_or_else(|| {
        invalid(format!(
            "{method} argument {} must be an integer",
            index + 1
        ))
    })?;
    if !number.is_finite() || number.fract() != 0.0 {
        return Err(invalid(format!(
            "{method} argument {} must be an integer",
            index + 1
        )));
    }
    if number < i64::MIN as f64 || number > i64::MAX as f64 {
        return Err(invalid(format!(
            "{method} argument {} is outside the supported range",
            index + 1
        )));
    }
    Ok(number as i64)
}

fn positive_size_arg(
    args: &[Value],
    index: usize,
    axis: &str,
    method: &str,
) -> Result<u32, RangeNavigationError> {
    let value = number_arg(args, index, method)?;
    if value == 0 {
        return Err(invalid(format!("{method} {axis} count must be positive")));
    }
    Ok(value)
}

fn bounded_index(
    args: &[Value],
    index: usize,
    length: u32,
    axis: &str,
    method: &str,
) -> Result<u32, RangeNavigationError> {
    let value = number_arg(args, index, method)?;
    if value >= length {
        return Err(invalid(format!(
            "{method} {axis} index {value} is outside the containing range"
        )));
    }
    Ok(value)
}

fn optional_count(args: &[Value], method: &str) -> Result<i64, RangeNavigationError> {
    if args.is_empty() {
        return Ok(1);
    }
    signed_arg(args, 0, method)
}

fn expect_optional_count(args: &[Value], method: &str) -> Result<(), RangeNavigationError> {
    if args.len() > 1 {
        return Err(invalid(format!("{method} accepts at most one argument")));
    }
    Ok(())
}

fn expect_arg_count(
    method: &str,
    args: &[Value],
    expected: usize,
) -> Result<(), RangeNavigationError> {
    if args.len() != expected {
        return Err(invalid(format!(
            "{method} expects {expected} argument{}",
            if expected == 1 { "" } else { "s" }
        )));
    }
    Ok(())
}

fn cell_name(row: u32, column: u32) -> String {
    format!("{}{}", column_name(column), row + 1)
}

fn column_name(mut column: u32) -> String {
    let mut reversed = Vec::new();
    loop {
        reversed.push((b'A' + (column % 26) as u8) as char);
        column /= 26;
        if column == 0 {
            break;
        }
        column -= 1;
    }
    reversed.into_iter().rev().collect()
}

fn invalid(message: impl Into<String>) -> RangeNavigationError {
    RangeNavigationError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn invalid_range(raw: &str, reason: impl std::fmt::Display) -> RangeNavigationError {
    invalid(format!("Invalid range address '{raw}': {reason}"))
}
