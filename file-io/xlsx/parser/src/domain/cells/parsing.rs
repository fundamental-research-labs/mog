//! Main parsing functions for worksheets.
//!
//! This module preserves the legacy worksheet parsing entry points while the
//! implementation is split by parser concern.

mod cell_extras;
mod data_tables;
mod fast;
mod formula_extras;
mod recovery_path;
mod row_attrs;
mod rows;
mod xml_text;

use super::types::{CellData, ParseExtras};
use crate::infra::error::ParseContext;
use ooxml_types::worksheet::RowHeight;

/// Parse worksheet XML with OOXML-specific optimizations.
///
/// This is the fast-path implementation optimized for valid XLSX files.
/// For error recovery and handling malformed files, use [`parse_worksheet_with_context`].
pub fn parse_worksheet_fast(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    row_heights: &mut Vec<RowHeight>,
    col_styles: &[Option<u32>],
) -> usize {
    fast::parse_worksheet_core(
        xml,
        shared_strings,
        cells,
        strings,
        row_heights,
        None,
        col_styles,
    )
}

/// Like `parse_worksheet_fast` but also collects postprocessing data during the
/// parse pass, eliminating the need for a separate XML rescan.
pub fn parse_worksheet_fast_with_extras(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    row_heights: &mut Vec<RowHeight>,
    extras: &mut ParseExtras,
    col_styles: &[Option<u32>],
) -> usize {
    fast::parse_worksheet_core(
        xml,
        shared_strings,
        cells,
        strings,
        row_heights,
        Some(extras),
        col_styles,
    )
}

/// Parse worksheet XML with error recovery context.
///
/// Returns `(cells_parsed, cells_skipped)`, where skipped cells had recoverable
/// errors according to the supplied [`ParseContext`].
pub fn parse_worksheet_with_context(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    context: &mut ParseContext,
    row_heights: &mut Vec<RowHeight>,
    col_styles: &[Option<u32>],
) -> (usize, usize) {
    recovery_path::parse_worksheet_with_context_impl(
        xml,
        shared_strings,
        cells,
        strings,
        context,
        row_heights,
        col_styles,
    )
}
