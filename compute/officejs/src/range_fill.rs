//! Office.js `Range.autoFill` and `Range.flashFill` adapters.
//!
//! The JavaScript proxy queues only object-path information. This module owns
//! the typed boundary: it resolves bounded A1 ranges, validates the
//! destination geometry against the Office.js contract, maps the exact
//! `AutoFillType` strings to the production compute-fill modes, and calls the
//! compute-api fill facade. `Range.flashFill` uses the adjacent populated
//! column as its source, matching the Excel operation's surrounding-data
//! behavior.

use compute_api::{ComputeApiError, Sheet};
use serde_json::{json, Value};

use crate::dispatch::{ExtensionHandler, HostDispatchContext};
use crate::host::{BatchError, RangeRef};
use crate::range_navigation::{
    parse_range_address, RangeAddress, RangeNavigationError, EXCEL_MAX_COLUMNS, EXCEL_MAX_ROWS,
};

/// Error returned by the Office.js range-fill boundary.
///
/// `Host` maps this to a Rich API error when the queued operation is
/// synchronized. Keeping the Office error code here makes unsupported fill
/// variants explicit instead of turning them into a silent no-op.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RangeFillError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Bounds {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

impl Bounds {
    fn from_range(address: &RangeAddress, label: &str) -> Result<Self, RangeFillError> {
        if address.is_whole_sheet() || address.is_entire_row() || address.is_entire_column() {
            return Err(invalid(format!(
                "Range.{label} requires a bounded cell range"
            )));
        }

        let (start_row, start_col, end_row, end_col) = address.bounds();
        if start_row > end_row || start_col > end_col {
            return Err(invalid(format!("Range.{label} requires a non-empty range")));
        }
        if end_row >= EXCEL_MAX_ROWS || end_col >= EXCEL_MAX_COLUMNS {
            return Err(invalid(format!(
                "Range.{label} destination is outside the worksheet grid"
            )));
        }
        Ok(Self {
            start_row,
            start_col,
            end_row,
            end_col,
        })
    }

    fn row_count(self) -> u32 {
        self.end_row - self.start_row + 1
    }

    fn col_count(self) -> u32 {
        self.end_col - self.start_col + 1
    }

    fn contains(self, other: Self) -> bool {
        self.start_row <= other.start_row
            && self.start_col <= other.start_col
            && self.end_row >= other.end_row
            && self.end_col >= other.end_col
    }

    fn to_wire(self) -> Value {
        json!({
            "startRow": self.start_row,
            "startCol": self.start_col,
            "endRow": self.end_row,
            "endCol": self.end_col,
        })
    }
}

/// The exact string-valued enum members declared by Microsoft for
/// `Excel.AutoFillType`. Keep this list in one place so validation and tests
/// cannot drift from the pinned declarations.
pub(crate) const AUTO_FILL_TYPES: &[&str] = &[
    "FillDefault",
    "FillCopy",
    "FillSeries",
    "FillFormats",
    "FillValues",
    "FillDays",
    "FillWeekdays",
    "FillMonths",
    "FillYears",
    "LinearTrend",
    "GrowthTrend",
    "FlashFill",
];

/// Queue target-independent autofill data for a host caller.
///
/// The host passes the current Range address and, when supplied, the
/// destination Range address. `None` follows Excel's double-click fill-handle
/// behavior by looking for a contiguous populated neighboring lane. A
/// destination must contain the source range and extend it on exactly one
/// axis, because the pinned Office.js contract says it can extend horizontally
/// or vertically.
pub(crate) fn auto_fill(
    sheet: &Sheet,
    source_address: &str,
    destination_address: Option<&str>,
    auto_fill_type: Option<&str>,
) -> Result<(), RangeFillError> {
    let source = bounds_for(sheet, source_address, "autoFill source")?;
    let kind = auto_fill_type.unwrap_or("FillDefault");
    validate_auto_fill_type(kind)?;

    // The compute-fill engine has a separate Flash Fill input contract. It
    // cannot faithfully interpret AutoFillType.FlashFill as a source-to-
    // destination series, so reject this enum member rather than mapping it
    // to ordinary autofill and producing the wrong data.
    if kind == "FlashFill" {
        return Err(unsupported(
            "Range.autoFill with AutoFillType.FlashFill is not supported; use Range.flashFill()"
                .to_string(),
        ));
    }

    let destination = match destination_address {
        Some(address) => bounds_for(sheet, address, "autoFill destination")?,
        None => match infer_destination(sheet, source)? {
            Some((destination, _direction)) => destination,
            None => {
                // Excel's fill-handle operation has no target when there is
                // no adjacent data. Treat it as an empty operation, matching
                // the host's no-op behavior while retaining validation for an
                // invalid explicit destination.
                return Ok(());
            }
        },
    };

    let direction = validate_destination(source, destination)?;
    let mode = mode_for_auto_fill_type(kind);
    let request = json!({
        "sourceRange": source.to_wire(),
        "targetRange": destination.to_wire(),
        "direction": direction,
        "mode": mode,
        "includeFormulas": true,
        "includeValues": true,
        "includeFormats": true,
        "stepValue": 1.0,
    });

    // The compute-api facade owns the typed BridgeAutoFillRequest and invokes
    // the production compute-fill engine. Deserializing through Value keeps
    // this adapter independent of the core crate's internal module path; the
    // argument type is inferred by Sheet::auto_fill.
    sheet
        .auto_fill(serde_json::from_value(request).map_err(|error| encoding(error.to_string()))?)
        .map(|_| ())
        .map_err(engine)
}

/// Apply `Range.flashFill` to a bounded single-column range.
///
/// The production flash-fill engine consumes an input column and an example
/// output column. Office.js exposes only the output Range, so the host chooses
/// the populated immediate neighbor (left first on a tie) as the input column.
/// Both ranges have exactly the selected row span; the compute engine then
/// infers the transformation from already-entered examples in the target.
pub(crate) fn flash_fill(sheet: &Sheet, target_address: &str) -> Result<(), RangeFillError> {
    let target = bounds_for(sheet, target_address, "flashFill")?;
    if target.col_count() != 1 {
        return Err(invalid(
            "Range.flashFill requires a single-column range".to_string(),
        ));
    }

    let source_col = neighboring_source_column(sheet, target)?;
    let source = Bounds {
        start_row: target.start_row,
        end_row: target.end_row,
        start_col: source_col,
        end_col: source_col,
    };
    let request = json!({
        "sourceRange": source.to_wire(),
        "targetRange": target.to_wire(),
    });

    sheet
        .flash_fill(serde_json::from_value(request).map_err(|error| encoding(error.to_string()))?)
        .map(|_| ())
        .map_err(engine)
}

fn bounds_for(sheet: &Sheet, address: &str, label: &str) -> Result<Bounds, RangeFillError> {
    let parsed = parse_range_address(sheet, address).map_err(navigation)?;
    Bounds::from_range(&parsed, label)
}

fn validate_auto_fill_type(kind: &str) -> Result<(), RangeFillError> {
    if AUTO_FILL_TYPES.contains(&kind) {
        Ok(())
    } else {
        Err(invalid(format!(
            "Unsupported AutoFillType '{kind}'; expected one of {}",
            AUTO_FILL_TYPES.join(", ")
        )))
    }
}

fn mode_for_auto_fill_type(kind: &str) -> &'static str {
    match kind {
        "FillCopy" => "copy",
        "FillSeries" => "series",
        "FillFormats" => "formats",
        "FillValues" => "values",
        "FillDays" => "days",
        "FillWeekdays" => "weekdays",
        "FillMonths" => "months",
        "FillYears" => "years",
        "LinearTrend" => "linearTrend",
        "GrowthTrend" => "growthTrend",
        // FillDefault is the engine's pattern-detecting mode.
        "FillDefault" => "auto",
        // Validated before this function is called. Keep a total match for
        // future enum additions while ensuring FlashFill is never coerced.
        "FlashFill" => "auto",
        _ => "auto",
    }
}

fn validate_destination(
    source: Bounds,
    destination: Bounds,
) -> Result<&'static str, RangeFillError> {
    if !destination.contains(source) {
        return Err(invalid(
            "Range.autoFill destination must contain the source range".to_string(),
        ));
    }

    let rows_extended =
        destination.start_row < source.start_row || destination.end_row > source.end_row;
    let cols_extended =
        destination.start_col < source.start_col || destination.end_col > source.end_col;
    if rows_extended && cols_extended {
        return Err(invalid(
            "Range.autoFill destination may extend the source horizontally or vertically, not both"
                .to_string(),
        ));
    }

    if rows_extended {
        if destination.start_col != source.start_col || destination.end_col != source.end_col {
            return Err(invalid(
                "Range.autoFill vertical fill requires the source columns to stay aligned"
                    .to_string(),
            ));
        }
        if destination.start_row < source.start_row && destination.end_row > source.end_row {
            return Err(invalid(
                "Range.autoFill cannot extend above and below the source in one operation"
                    .to_string(),
            ));
        }
        return Ok(if destination.end_row > source.end_row {
            "down"
        } else {
            "up"
        });
    }

    if cols_extended {
        if destination.start_row != source.start_row || destination.end_row != source.end_row {
            return Err(invalid(
                "Range.autoFill horizontal fill requires the source rows to stay aligned"
                    .to_string(),
            ));
        }
        if destination.start_col < source.start_col && destination.end_col > source.end_col {
            return Err(invalid(
                "Range.autoFill cannot extend left and right of the source in one operation"
                    .to_string(),
            ));
        }
        return Ok(if destination.end_col > source.end_col {
            "right"
        } else {
            "left"
        });
    }

    // An exact source/destination range is a valid no-op. The direction does
    // not affect the result, but Down is the engine's documented default.
    Ok("down")
}

/// Infer the destination used by `autoFill(null)` from contiguous data in an
/// immediate neighboring lane. Returns the longest candidate, with a stable
/// Down, Up, Right, Left tie-break order.
fn infer_destination(
    sheet: &Sheet,
    source: Bounds,
) -> Result<Option<(Bounds, &'static str)>, RangeFillError> {
    let mut candidates = Vec::new();

    if source.end_row + 1 < EXCEL_MAX_ROWS {
        for col in neighboring_columns(source) {
            if let Some(end_row) = contiguous_down(sheet, col, source.end_row + 1)? {
                candidates.push((
                    Bounds {
                        start_row: source.start_row,
                        start_col: source.start_col,
                        end_row,
                        end_col: source.end_col,
                    },
                    "down",
                ));
            }
        }
    }
    if source.start_row > 0 {
        for col in neighboring_columns(source) {
            if let Some(start_row) = contiguous_up(sheet, col, source.start_row - 1)? {
                candidates.push((
                    Bounds {
                        start_row,
                        start_col: source.start_col,
                        end_row: source.end_row,
                        end_col: source.end_col,
                    },
                    "up",
                ));
            }
        }
    }
    if source.end_col + 1 < EXCEL_MAX_COLUMNS {
        for row in source.start_row..=source.end_row {
            if let Some(end_col) = contiguous_right(sheet, row, source.end_col + 1)? {
                candidates.push((
                    Bounds {
                        start_row: source.start_row,
                        start_col: source.start_col,
                        end_row: source.end_row,
                        end_col,
                    },
                    "right",
                ));
            }
        }
    }
    if source.start_col > 0 {
        for row in source.start_row..=source.end_row {
            if let Some(start_col) = contiguous_left(sheet, row, source.start_col - 1)? {
                candidates.push((
                    Bounds {
                        start_row: source.start_row,
                        start_col,
                        end_row: source.end_row,
                        end_col: source.end_col,
                    },
                    "left",
                ));
            }
        }
    }

    Ok(candidates.into_iter().max_by_key(|(bounds, direction)| {
        let extension = match *direction {
            "down" | "up" => bounds.row_count() - source.row_count(),
            "right" | "left" => bounds.col_count() - source.col_count(),
            _ => 0,
        };
        // The direction rank is inverted into a tie-break key only after the
        // extension length. `max_by_key` therefore prefers Left on a tie;
        // reorder the rank so Down is the greatest stable preference.
        let rank = match *direction {
            "down" => 4u32,
            "up" => 3,
            "right" => 2,
            "left" => 1,
            _ => 0,
        };
        (extension, rank)
    }))
}

fn neighboring_columns(source: Bounds) -> impl Iterator<Item = u32> {
    let left = source.start_col.checked_sub(1);
    let right = (source.end_col + 1 < EXCEL_MAX_COLUMNS).then_some(source.end_col + 1);
    left.into_iter().chain(right)
}

fn contiguous_down(sheet: &Sheet, col: u32, first_row: u32) -> Result<Option<u32>, RangeFillError> {
    let mut row = first_row;
    let mut last = None;
    while row < EXCEL_MAX_ROWS && populated(sheet, row, col)? {
        last = Some(row);
        row += 1;
    }
    Ok(last)
}

fn contiguous_up(sheet: &Sheet, col: u32, first_row: u32) -> Result<Option<u32>, RangeFillError> {
    let mut row = first_row;
    let mut first = None;
    loop {
        if !populated(sheet, row, col)? {
            break;
        }
        first = Some(row);
        if row == 0 {
            break;
        }
        row -= 1;
    }
    Ok(first)
}

fn contiguous_right(
    sheet: &Sheet,
    row: u32,
    first_col: u32,
) -> Result<Option<u32>, RangeFillError> {
    let mut col = first_col;
    let mut last = None;
    while col < EXCEL_MAX_COLUMNS && populated(sheet, row, col)? {
        last = Some(col);
        col += 1;
    }
    Ok(last)
}

fn contiguous_left(sheet: &Sheet, row: u32, first_col: u32) -> Result<Option<u32>, RangeFillError> {
    let mut col = first_col;
    let mut first = None;
    loop {
        if !populated(sheet, row, col)? {
            break;
        }
        first = Some(col);
        if col == 0 {
            break;
        }
        col -= 1;
    }
    Ok(first)
}

fn neighboring_source_column(sheet: &Sheet, target: Bounds) -> Result<u32, RangeFillError> {
    let left = target.start_col.checked_sub(1);
    let right = (target.end_col + 1 < EXCEL_MAX_COLUMNS).then_some(target.end_col + 1);
    let mut candidates = Vec::new();
    if let Some(col) = left {
        candidates.push((
            non_empty_count(sheet, target.start_row, target.end_row, col)?,
            col,
            1,
        ));
    }
    if let Some(col) = right {
        candidates.push((
            non_empty_count(sheet, target.start_row, target.end_row, col)?,
            col,
            0,
        ));
    }
    let (count, col, _) = candidates
        .into_iter()
        .max_by_key(|(count, _col, left_preference)| (*count, *left_preference))
        .ok_or_else(|| {
            invalid("Range.flashFill cannot find a neighboring worksheet column".to_string())
        })?;
    if count == 0 {
        return Err(invalid(
            "Range.flashFill requires populated data in a neighboring worksheet column".to_string(),
        ));
    }
    Ok(col)
}

fn non_empty_count(
    sheet: &Sheet,
    start_row: u32,
    end_row: u32,
    col: u32,
) -> Result<u32, RangeFillError> {
    let mut count = 0;
    for row in start_row..=end_row {
        if populated(sheet, row, col)? {
            count += 1;
        }
    }
    Ok(count)
}

fn populated(sheet: &Sheet, row: u32, col: u32) -> Result<bool, RangeFillError> {
    sheet
        .get_cell_value((row, col))
        .map(|value| !matches!(value, compute_api::CellValue::Null))
        .map_err(engine)
}

fn navigation(error: RangeNavigationError) -> RangeFillError {
    RangeFillError {
        code: error.code,
        message: error.message,
    }
}

fn engine(error: ComputeApiError) -> RangeFillError {
    match error {
        ComputeApiError::InvalidAddress { .. }
        | ComputeApiError::InvalidRange { .. }
        | ComputeApiError::InvalidOperation(_) => invalid(error.to_string()),
        ComputeApiError::SheetNotFound { .. } => RangeFillError {
            code: "ItemNotFound",
            message: error.to_string(),
        },
        ComputeApiError::Compute(value_types::ComputeError::InvalidInput { .. }) => {
            invalid(error.to_string())
        }
        other => RangeFillError {
            code: "GeneralException",
            message: other.to_string(),
        },
    }
}

fn invalid(message: String) -> RangeFillError {
    RangeFillError {
        code: "InvalidArgument",
        message,
    }
}

fn unsupported(message: String) -> RangeFillError {
    RangeFillError {
        code: "UnsupportedOperation",
        message,
    }
}

fn encoding(message: String) -> RangeFillError {
    RangeFillError {
        code: "GeneralException",
        message: format!("Range fill request conversion failed: {message}"),
    }
}

// ---------------------------------------------------------------------------
// Host extension dispatch
// ---------------------------------------------------------------------------

/// Host dispatcher for the two Range fill operations emitted by
/// `range_fill.js`. The central host keeps the operation enum stable; this
/// handler resolves the existing Range proxy bindings and delegates all
/// address, shape, inference, and engine validation to the helpers above.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct RangeFillHandler;

/// Construct the handler for registration by the runtime host owner.
pub(crate) fn handler() -> RangeFillHandler {
    RangeFillHandler
}

impl ExtensionHandler for RangeFillHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(operation, "rangeAutoFill" | "rangeFlashFill")
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let operation_name = required_string(operation, "op")?;
        match operation_name {
            "rangeAutoFill" => handle_auto_fill_operation(operation, context),
            "rangeFlashFill" => handle_flash_fill_operation(operation, context),
            _ => Ok(false),
        }
    }
}

fn handle_auto_fill_operation(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<bool, BatchError> {
    let source_id = required_string(operation, "id")?;
    let source = context.range(source_id)?;
    let source_sheet = source.sheet();
    let source_address = bounded_address(&source, "Range.autoFill source")?.to_string();

    // The proxy emits exactly one of these fields for an explicit destination,
    // and emits neither for an omitted or null destination. Reject a payload
    // carrying both so a caller cannot silently choose one object path over a
    // conflicting raw address.
    let destination_id = optional_string(operation, "destinationRangeId")?;
    let destination_wire = optional_string(operation, "destinationAddress")?;
    if destination_id.is_some() && destination_wire.is_some() {
        return Err(invalid_batch(
            "Range.autoFill destination cannot contain both a Range object and an address",
        ));
    }

    let destination_address = if let Some(destination_id) = destination_id {
        let destination = context.range(destination_id)?;
        if destination.is_null_object() {
            return Err(BatchError {
                code: "InvalidObjectPath",
                message: "Range.autoFill destination Range is a null object.".to_string(),
            });
        }
        let destination_sheet = destination.sheet();
        if destination_sheet.id() != source_sheet.id() {
            return Err(invalid_batch(
                "Range.autoFill source and destination must belong to the same worksheet",
            ));
        }
        Some(bounded_address(&destination, "Range.autoFill destination")?.to_string())
    } else {
        destination_wire.map(str::to_owned)
    };

    let auto_fill_type = optional_string(operation, "autoFillType")?;
    auto_fill(
        &source_sheet,
        &source_address,
        destination_address.as_deref(),
        auto_fill_type,
    )
    .map_err(batch_error)?;
    Ok(true)
}

fn handle_flash_fill_operation(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<bool, BatchError> {
    let target_id = required_string(operation, "id")?;
    let target = context.range(target_id)?;
    let target_sheet = target.sheet();
    let target_address = bounded_address(&target, "Range.flashFill target")?.to_string();
    flash_fill(&target_sheet, &target_address).map_err(batch_error)?;
    Ok(true)
}

fn bounded_address<'a>(range: &'a RangeRef, operation: &str) -> Result<&'a str, BatchError> {
    if range.is_null_object() {
        return Err(BatchError {
            code: "InvalidObjectPath",
            message: format!("{operation} cannot use a null Range object"),
        });
    }
    range
        .address()
        .ok_or_else(|| invalid_batch(format!("{operation} requires a bounded cell range")))
}

fn required_string<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            invalid_batch(format!(
                "range fill operation requires a non-empty string '{field}'"
            ))
        })
}

fn optional_string<'a>(operation: &'a Value, field: &str) -> Result<Option<&'a str>, BatchError> {
    match operation.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(Some)
            .ok_or_else(|| {
                invalid_batch(format!(
                    "range fill operation field '{field}' must be a non-empty string"
                ))
            }),
    }
}

fn invalid_batch(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn batch_error(error: RangeFillError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}
