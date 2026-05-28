use crate::a1_entry::split_sheet_prefix;

use super::{ParsedExpr, SheetName};

/// Classify inputs of the shape `#REF!`, `=#REF!`, or (optional `=`)
/// `Sheet!#REF!`.
///
/// Returns `None` if the input is not one of those shapes -- the caller falls
/// through to later classification steps.
pub(super) fn classify_broken_ref(input: &str) -> Option<ParsedExpr> {
    let trimmed = input.trim();
    let stripped = trimmed.strip_prefix('=').unwrap_or(trimmed);
    if stripped.eq_ignore_ascii_case("#REF!") {
        return Some(ParsedExpr::BrokenRef { sheet: None });
    }

    let (sheet, rest) = split_sheet_prefix(stripped);
    let sheet_name = sheet?;
    if !rest.eq_ignore_ascii_case("#REF!") {
        return None;
    }
    Some(ParsedExpr::BrokenRef {
        sheet: Some(SheetName::from(sheet_name)),
    })
}
