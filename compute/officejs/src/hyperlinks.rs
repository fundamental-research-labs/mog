//! Office.js `Range.hyperlink` translation.
//!
//! A RangeHyperlink is a compound scalar in Office.js.  The adapter keeps the
//! wire value deliberately small (`address`, `documentReference`, `screenTip`,
//! and `textToDisplay`) and delegates persistence to the sheet hyperlink
//! facade.  It never keeps a second hyperlink map in the Office.js host.

use std::collections::HashMap;

use compute_api::{CellRange, ComputeApiError, Sheet};
use serde_json::{Map, Value, json};

use crate::range_navigation::{RangeNavigationError, parse_range_address};

/// Error returned by the Office.js hyperlink projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HyperlinkError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct RangeHyperlinkInput {
    address: Option<String>,
    document_reference: Option<String>,
    screen_tip: Option<String>,
    text_to_display: Option<String>,
}

/// Load the RangeHyperlink represented by the first hyperlink in `address`.
///
/// Excel exposes one compound value for a Range.  When a range contains more
/// than one hyperlink, the top-left hyperlink is the deterministic projection;
/// this also matches the `textToDisplay` declaration, which names the top-left
/// cell in the range.  An unlinked range is represented by an empty object,
/// because `Range.hyperlink` itself is a non-null `RangeHyperlink` value.
pub(crate) fn load(sheet: &Sheet, address: &str) -> Result<HashMap<String, Value>, HyperlinkError> {
    let bounds = resolve_bounded(sheet, address)?;
    let links = sheet.hyperlinks().get_all_hyperlinks().map_err(engine)?;

    let selected = links
        .into_iter()
        .filter_map(|link| {
            let (row, col) = hyperlink_anchor_top_left(&link.cell_ref)?;
            (row >= bounds.0 && row <= bounds.2 && col >= bounds.1 && col <= bounds.3)
                .then_some((row, col, link))
        })
        .min_by_key(|(row, col, _)| (*row, *col))
        .map(|(_, _, link)| link);

    let value = selected
        .map(range_hyperlink_value)
        .unwrap_or_else(|| Value::Object(Map::new()));
    Ok(HashMap::from([(String::from("hyperlink"), value)]))
}

/// Return the top-left coordinate for either a cell or a range hyperlink.
/// Imported XLSX can preserve a single `<hyperlink ref="A1:B2">` on the
/// top-left cell map, so parsing only `CellAddress` would make that durable
/// hyperlink invisible to Range.hyperlink reads.
fn hyperlink_anchor_top_left(cell_ref: &str) -> Option<(u32, u32)> {
    let reference = cell_ref
        .rsplit_once('!')
        .map(|(_, reference)| reference)
        .unwrap_or(cell_ref);
    let (row, col, _, _) = CellRange::from(reference).resolve().ok()?;
    Some((row, col))
}

/// Set a Range.hyperlink value on the top-left cell of the bounded range.
///
/// The typed sheet facade receives all four Office.js members, including
/// empty-but-explicit display/tooltip strings.  If neither target member is
/// present, the operation is interpreted as clearing the hyperlink in the
/// range; this gives the optional RangeHyperlink shape a useful clear form and
/// remains content/format preserving.
pub(crate) fn set(sheet: &Sheet, address: &str, value: &Value) -> Result<(), HyperlinkError> {
    let bounds = resolve_bounded(sheet, address)?;
    let input = parse_input(value)?;
    let (row, col) = (bounds.0, bounds.1);

    if input.address.is_none() && input.document_reference.is_none() {
        return sheet
            .clear_with_mode(CellRange::Bounds(row, col, row, col), "hyperlinks")
            .map(|_| ())
            .map_err(engine);
    }

    sheet
        .hyperlinks()
        .set_hyperlink_with_metadata(
            row,
            col,
            input.address.as_deref(),
            input.document_reference.as_deref(),
            input.text_to_display.as_deref(),
            input.screen_tip.as_deref(),
        )
        .map(|_| ())
        .map_err(engine)
}

/// Clear hyperlinks for a Range.clear operation.
///
/// `RemoveHyperlinks` has the documented Excel behavior of clearing both
/// hyperlinks and direct cell formatting while preserving values, conditional
/// formats, and data validation.  The compute-api format clear is scoped to
/// direct cell formats, so it composes with the hyperlink clear without
/// touching those other features.
pub(crate) fn clear(sheet: &Sheet, address: &str, apply_to: &str) -> Result<(), HyperlinkError> {
    let bounds = resolve_bounded(sheet, address)?;
    let range = CellRange::Bounds(bounds.0, bounds.1, bounds.2, bounds.3);
    match apply_to {
        "Hyperlinks" | "hyperlinks" => sheet
            .clear_with_mode(range, "hyperlinks")
            .map(|_| ())
            .map_err(engine),
        "RemoveHyperlinks" | "removeHyperlinks" => {
            sheet
                .clear_with_mode(range.clone(), "hyperlinks")
                .map_err(engine)?;
            sheet
                .clear_with_mode(range, "formats")
                .map(|_| ())
                .map_err(engine)
        }
        other => Err(invalid(format!(
            "Unsupported Range hyperlink clear mode '{other}'"
        ))),
    }
}

fn resolve_bounded(sheet: &Sheet, address: &str) -> Result<(u32, u32, u32, u32), HyperlinkError> {
    let parsed = parse_range_address(sheet, address).map_err(navigation)?;
    if parsed.is_whole_sheet() || parsed.is_entire_row() || parsed.is_entire_column() {
        return Err(invalid(
            "Range.hyperlink requires a bounded cell range".to_string(),
        ));
    }
    Ok(parsed.bounds())
}

fn parse_input(value: &Value) -> Result<RangeHyperlinkInput, HyperlinkError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Range.hyperlink must be a plain object".to_string()))?;

    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "address" | "documentReference" | "screenTip" | "textToDisplay"
        ) {
            return Err(invalid(format!(
                "Unsupported Range.hyperlink property '{key}'"
            )));
        }
    }

    let read_string = |name: &str| -> Result<Option<String>, HyperlinkError> {
        match object.get(name) {
            None => Ok(None),
            Some(Value::String(value)) => Ok(Some(value.clone())),
            Some(_) => Err(invalid(format!("Range.hyperlink.{name} must be a string"))),
        }
    };

    let address = read_string("address")?;
    let document_reference = read_string("documentReference")?;
    let screen_tip = read_string("screenTip")?;
    let text_to_display = read_string("textToDisplay")?;

    if address.as_deref().is_some_and(|value| value.is_empty())
        && document_reference
            .as_deref()
            .is_none_or(|value| value.is_empty())
    {
        return Err(invalid(
            "Range.hyperlink requires a non-empty address or documentReference".to_string(),
        ));
    }
    if document_reference
        .as_deref()
        .is_some_and(|value| value.is_empty())
        && address.as_deref().is_none_or(|value| value.is_empty())
    {
        return Err(invalid(
            "Range.hyperlink requires a non-empty address or documentReference".to_string(),
        ));
    }

    Ok(RangeHyperlinkInput {
        address,
        document_reference,
        screen_tip,
        text_to_display,
    })
}

fn range_hyperlink_value(link: impl serde::Serialize) -> Value {
    let source = serde_json::to_value(link).unwrap_or(Value::Null);
    let mut result = Map::new();
    if let Some(address) = source.get("target").and_then(Value::as_str) {
        result.insert("address".to_string(), json!(address));
    }
    if let Some(document_reference) = source.get("location").and_then(Value::as_str) {
        result.insert("documentReference".to_string(), json!(document_reference));
    }
    if let Some(screen_tip) = source.get("tooltip").and_then(Value::as_str) {
        result.insert("screenTip".to_string(), json!(screen_tip));
    }
    if let Some(text_to_display) = source.get("display").and_then(Value::as_str) {
        result.insert("textToDisplay".to_string(), json!(text_to_display));
    }
    Value::Object(result)
}

fn navigation(error: RangeNavigationError) -> HyperlinkError {
    HyperlinkError {
        code: error.code,
        message: error.message,
    }
}

fn engine(error: ComputeApiError) -> HyperlinkError {
    let code = match &error {
        ComputeApiError::InvalidAddress { .. } | ComputeApiError::InvalidRange { .. } => {
            "InvalidArgument"
        }
        ComputeApiError::Compute(value_types::ComputeError::InvalidInput { .. }) => {
            "InvalidArgument"
        }
        _ => "GeneralException",
    };
    HyperlinkError {
        code,
        message: error.to_string(),
    }
}

fn invalid(message: impl Into<String>) -> HyperlinkError {
    HyperlinkError {
        code: "InvalidArgument",
        message: message.into(),
    }
}
