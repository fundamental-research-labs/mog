use super::*;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use value_types::FiniteF64;

// Coverage is split by parser behavior, format hints, storage round trips,
// and CellInput dispatch. Shared deterministic fixtures live in support.
mod support;
mod parse_input_basic;
mod formatted_numbers;
mod dates;
mod format_hints;
mod storage_roundtrip;
mod cell_input_dispatch;
