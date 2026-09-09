use super::*;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use value_types::FiniteF64;

// Coverage is split by parser behavior, format hints, storage round trips,
// and CellInput dispatch. Shared deterministic fixtures live in support.
mod dates;
mod format_hints;
mod formatted_numbers;
mod parse_input_basic;
mod storage_roundtrip;
mod support;

fn parse_input_value(input: &str, target: Option<compute_formats::FormatType>) -> ParsedValue {
    parse_input_value_with_context(input, &InputParseContext::default_for_target(target)).value
}
