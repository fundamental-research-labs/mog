//! Main parsing functions for worksheets.
//!
//! Contains the core worksheet parsing logic including both the fast-path
//! implementation and the error-recovery version.
//!
//! UTF-8 boundary guard: the two `&ref_val[n..]` / `&ref_val[..n]` slices in
//! this file split `A1:B2`-shaped range-ref attribute strings on
//! `find(':')` — ASCII colon, single byte, char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use super::adapters::{find_byte, find_sequence, skip_whitespace};
use super::helpers::{
    CellEnd, ScanResult, extract_formula_extras_fused, find_cell_end, find_sheet_data,
    parse_a1_reference, parse_cell_ref_fast, parse_row_number, scan_cell,
};
use super::recovery::{CellParseResult, parse_cell_element_with_context};
use super::types::{
    CellData, DataTableEntry, ParseExtras, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA,
};
use crate::infra::error::{ErrorCode, ErrorLocation, ParseContext, ParseErrorDetail};
use ooxml_types::worksheet::RowHeight;

/// Classify a single XLSX `<f t="dataTable">` `r1` / `r2` attribute into the
/// typed `formula_types::CellRef` form.
///
/// Typed data-table input refs: boundary 1.5 / 1.6: replaces the prior `Option<String>` field
/// on `DataTableEntry`. `#REF!`, missing, or non-cell shapes (e.g. ranges,
/// sheet-qualified refs, garbage) collapse to `None` — preserving the
/// pre-W4.b behavior where `is_broken_cell_ref` filtered the same set.
///
/// Lives here (not in `infra::a1`) because it is the parser-side classifier
/// for one specific XLSX attribute pair; other A1 entry points already exist
/// in `compute_parser` for general-purpose use.
fn parse_data_table_input_ref(s: &str) -> Option<formula_types::CellRef> {
    compute_parser::parse_a1_cell(s).map(|node| node.reference)
}

#[inline]
fn validated_xml_text(bytes: &[u8]) -> String {
    std::str::from_utf8(bytes)
        .expect("worksheet XML was validated as UTF-8 at the archive boundary")
        .to_owned()
}

// =============================================================================
// Single-pass row attribute parser
// =============================================================================

/// All attributes extracted from a `<row>` tag in one pass.
#[derive(Default)]
struct RowAttrs<'a> {
    height: Option<f64>,
    height_str: Option<&'a [u8]>,
    custom_height: bool,
    hidden: Option<bool>,
    collapsed: Option<bool>,
    thick_top: bool,
    thick_bot: bool,
    outline_level: Option<u8>,
    custom_format: bool,
    style: Option<u32>,
    dy_descent: Option<f64>,
    spans: Option<&'a [u8]>,
}

/// Parse all row attributes from `tag_bytes` (the slice between `<row` and `>`)
/// in a single forward scan, avoiding repeated `find_sequence` calls.
#[inline]
fn parse_row_attrs<'a>(tag_bytes: &'a [u8]) -> RowAttrs<'a> {
    let mut attrs = RowAttrs::default();
    let len = tag_bytes.len();
    let mut i = 0;

    // Walk through the tag bytes, finding attribute boundaries
    while i < len {
        // Skip to the next space (attribute separator)
        if tag_bytes[i] != b' ' {
            i += 1;
            continue;
        }
        i += 1; // skip the space
        if i >= len {
            break;
        }

        // Match on the first byte of the attribute name for fast dispatch
        match tag_bytes[i] {
            b'h' => {
                // ht="..." or hidden="..."
                if i + 4 <= len && &tag_bytes[i..i + 3] == b"ht=" && tag_bytes[i + 3] == b'"' {
                    // ht="..."
                    let vs = i + 4;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        if let Ok(s) = std::str::from_utf8(&tag_bytes[vs..qe]) {
                            attrs.height_str = Some(&tag_bytes[vs..qe]);
                            attrs.height = s.parse::<f64>().ok();
                        }
                        i = qe + 1;
                        continue;
                    }
                } else if i + 8 <= len
                    && &tag_bytes[i..i + 7] == b"hidden="
                    && tag_bytes[i + 7] == b'"'
                {
                    let vs = i + 8;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        attrs.hidden = match &tag_bytes[vs..qe] {
                            b"1" | b"true" => Some(true),
                            b"0" | b"false" => Some(false),
                            _ => None,
                        };
                        i = qe + 1;
                        continue;
                    }
                }
            }
            b'c' => {
                // customHeight="1", customFormat="1", collapsed="..."
                if i + 15 <= len && &tag_bytes[i..i + 14] == b"customHeight=\"" {
                    attrs.custom_height = tag_bytes.get(i + 14) == Some(&b'1');
                    i += 16; // skip past customHeight="X"
                    continue;
                } else if i + 15 <= len && &tag_bytes[i..i + 14] == b"customFormat=\"" {
                    attrs.custom_format = tag_bytes.get(i + 14) == Some(&b'1');
                    i += 16;
                    continue;
                } else if i + 11 <= len
                    && &tag_bytes[i..i + 10] == b"collapsed="
                    && tag_bytes[i + 10] == b'"'
                {
                    let vs = i + 11;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        attrs.collapsed = match &tag_bytes[vs..qe] {
                            b"1" | b"true" => Some(true),
                            b"0" | b"false" => Some(false),
                            _ => None,
                        };
                        i = qe + 1;
                        continue;
                    }
                }
            }
            b't' => {
                // thickTop="1", thickBot="1"
                if i + 11 <= len && &tag_bytes[i..i + 10] == b"thickTop=\"" {
                    attrs.thick_top = tag_bytes.get(i + 10) == Some(&b'1');
                    i += 12;
                    continue;
                } else if i + 11 <= len && &tag_bytes[i..i + 10] == b"thickBot=\"" {
                    attrs.thick_bot = tag_bytes.get(i + 10) == Some(&b'1');
                    i += 12;
                    continue;
                }
            }
            b'o' => {
                // outlineLevel="N"
                if i + 14 <= len && &tag_bytes[i..i + 14] == b"outlineLevel=\"" {
                    let vs = i + 14;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        attrs.outline_level = std::str::from_utf8(&tag_bytes[vs..qe])
                            .ok()
                            .and_then(|s| s.parse::<u8>().ok());
                        i = qe + 1;
                        continue;
                    }
                }
            }
            b's' => {
                // s="N" (style) or spans="..."
                if i + 3 <= len && tag_bytes[i + 1] == b'=' && tag_bytes[i + 2] == b'"' {
                    // s="..."
                    let vs = i + 3;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        if let Ok(s) = std::str::from_utf8(&tag_bytes[vs..qe]) {
                            attrs.style = s.parse::<u32>().ok();
                        }
                        i = qe + 1;
                        continue;
                    }
                } else if i + 7 <= len
                    && &tag_bytes[i..i + 6] == b"spans="
                    && tag_bytes[i + 6] == b'"'
                {
                    let vs = i + 7;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        attrs.spans = Some(&tag_bytes[vs..qe]);
                        i = qe + 1;
                        continue;
                    }
                }
            }
            b'd' | b'x' => {
                // dyDescent="..." or x14ac:dyDescent="..."
                let dy_prefix = if tag_bytes[i] == b'd' {
                    b"dyDescent=\"" as &[u8]
                } else if i + 15 <= len && &tag_bytes[i..i + 15] == b"x14ac:dyDescent" {
                    b"x14ac:dyDescent=\"" as &[u8]
                } else {
                    &[]
                };
                if !dy_prefix.is_empty()
                    && i + dy_prefix.len() <= len
                    && &tag_bytes[i..i + dy_prefix.len()] == dy_prefix
                {
                    let vs = i + dy_prefix.len();
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        if let Ok(s) = std::str::from_utf8(&tag_bytes[vs..qe]) {
                            attrs.dy_descent = s.parse::<f64>().ok();
                        }
                        i = qe + 1;
                        continue;
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }

    // Style only counts if customFormat is set
    if !attrs.custom_format {
        attrs.style = None;
    }

    attrs
}

/// Find a byte in a slice starting from `start`. Returns offset within the slice.
#[inline(always)]
fn find_byte_in(bytes: &[u8], needle: u8, start: usize) -> Option<usize> {
    memchr::memchr(needle, &bytes[start..]).map(|p| p + start)
}

/// Parse worksheet XML with OOXML-specific optimizations.
///
/// This is the fast-path implementation optimized for valid XLSX files.
/// For error recovery and handling malformed files, use [`parse_worksheet_with_context`].
///
/// # Arguments
/// * `xml` - Raw XML bytes of the worksheet
/// * `shared_strings` - Array of shared string references
/// * `cells` - Output buffer for cell data (pre-allocated)
/// * `strings` - Output buffer for string values
///
/// # Returns
/// Number of cells parsed
///
/// # Performance
/// - Zero allocations in the hot path
/// - Uses SIMD-optimized scanning functions
/// - Skips directly to sheetData section
///
/// # Note
/// Invalid cells (malformed references, invalid values) are silently skipped.
/// Use [`parse_worksheet_with_context`] to track errors and configure recovery behavior.
pub fn parse_worksheet_fast(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    row_heights: &mut Vec<RowHeight>,
    col_styles: &[Option<u32>],
) -> usize {
    parse_worksheet_core(
        xml,
        shared_strings,
        cells,
        strings,
        row_heights,
        None,
        col_styles,
    )
}

/// Like `parse_worksheet_fast` but also collects postprocessing data (shared formulas,
/// cached values, data tables) during the parse pass, eliminating the need for a
/// separate XML rescan via `postprocess_worksheet`.
pub fn parse_worksheet_fast_with_extras(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    row_heights: &mut Vec<RowHeight>,
    extras: &mut ParseExtras,
    col_styles: &[Option<u32>],
) -> usize {
    parse_worksheet_core(
        xml,
        shared_strings,
        cells,
        strings,
        row_heights,
        Some(extras),
        col_styles,
    )
}

/// Core parse implementation shared by `parse_worksheet_fast` and `parse_worksheet_fast_with_extras`.
fn parse_worksheet_core(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    row_heights: &mut Vec<RowHeight>,
    mut extras: Option<&mut ParseExtras>,
    col_styles: &[Option<u32>],
) -> usize {
    let mut cell_idx = 0;
    let mut pos = 0;

    // Skip to <sheetData> - this is where all cell data lives
    pos = match find_sheet_data(xml, pos) {
        Some(p) => p,
        None => return 0,
    };

    // Find the end of sheetData for bounds checking
    let sheet_data_end = find_sequence(xml, b"</sheetData>", pos).unwrap_or(xml.len());

    // Current row number (used when row doesn't have explicit r attribute)
    let mut current_row: u32 = 0;
    let mut current_row_style: Option<u32> = None;

    // Main parsing loop
    while pos < sheet_data_end && cell_idx < cells.len() {
        // Find next tag start — find_byte('<') implicitly skips any whitespace
        // between elements, so no separate skip_whitespace call is needed.
        if let Some(tag_start) = find_byte(xml, b'<', pos) {
            if tag_start >= sheet_data_end {
                break;
            }
            pos = tag_start + 1;

            // Check what tag we found
            if pos + 3 < xml.len()
                && xml[pos] == b'r'
                && xml[pos + 1] == b'o'
                && xml[pos + 2] == b'w'
            {
                // Found <row> element - extract row number
                if let Some(row_num) = parse_row_number(xml, pos) {
                    current_row = row_num.saturating_sub(1); // Convert to 0-indexed
                }
                // Skip to end of opening tag, extracting all row attributes in one pass
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    let tag_bytes = &xml[pos..gt];
                    let ra = parse_row_attrs(tag_bytes);

                    // Build RowHeight entry from parsed attributes
                    {
                        let has_attrs = ra.height.is_some()
                            || ra.custom_height
                            || ra.hidden.is_some()
                            || ra.collapsed.is_some()
                            || ra.thick_top
                            || ra.thick_bot
                            || ra.outline_level.is_some();
                        if has_attrs {
                            let mut rh = RowHeight::new(current_row, ra.height.unwrap_or(0.0));
                            rh.height_str = ra
                                .height_str
                                .and_then(|b| std::str::from_utf8(b).ok())
                                .map(|s| s.to_string());
                            rh.custom_height = ra.custom_height;
                            rh.hidden = ra.hidden;
                            rh.collapsed = ra.collapsed;
                            rh.thick_top = ra.thick_top;
                            rh.thick_bot = ra.thick_bot;
                            rh.outline_level = ra.outline_level;
                            row_heights.push(rh);
                        }
                    }

                    // Extract row style (style is already filtered by customFormat in parse_row_attrs)
                    let row_style = ra.style;
                    let has_custom_format = ra.custom_format;
                    current_row_style = row_style;

                    // If row has a style or customFormat, ensure a RowHeight entry carries it
                    if row_style.is_some() || has_custom_format {
                        if let Some(last_rh) = row_heights.last_mut() {
                            if last_rh.row == current_row {
                                if let Some(style) = row_style {
                                    last_rh.style = Some(style);
                                }
                                last_rh.custom_format = has_custom_format;
                            } else {
                                let mut rh = RowHeight::new(current_row, 0.0);
                                rh.custom_format = has_custom_format;
                                if let Some(style) = row_style {
                                    rh.style = Some(style);
                                }
                                row_heights.push(rh);
                            }
                        } else {
                            let mut rh = RowHeight::new(current_row, 0.0);
                            rh.custom_format = has_custom_format;
                            if let Some(style) = row_style {
                                rh.style = Some(style);
                            }
                            row_heights.push(rh);
                        }
                    }

                    // Apply extras from single-pass results
                    if let Some(ref mut ext) = extras {
                        if let Some(descent) = ra.dy_descent {
                            ext.row_descents.push((current_row, descent));
                        }

                        let has_spans = if let Some(spans_bytes) = ra.spans {
                            if let Ok(sp_str) = std::str::from_utf8(spans_bytes) {
                                ext.row_spans.push((current_row, sp_str.to_string()));
                                true
                            } else {
                                false
                            }
                        } else {
                            false
                        };

                        // Detect bare empty rows: self-closing <row r="N"/> with no
                        // meaningful attributes. These must survive the round-trip.
                        let is_self_closing = gt > 0 && xml[gt - 1] == b'/';
                        if is_self_closing
                            && row_style.is_none()
                            && !has_spans
                            && ra.dy_descent.is_none()
                            && ra.height.is_none()
                            && ra.hidden.is_none()
                            && ra.collapsed.is_none()
                            && ra.outline_level.is_none()
                            && !ra.custom_format
                        {
                            ext.bare_empty_rows.push(current_row);
                        }
                    }

                    pos = gt + 1;
                }
            } else if xml[pos] == b'c'
                && (xml.get(pos + 1).map_or(true, |&c| c == b' ' || c == b'>'))
            {
                // Found <c> element - parse cell using fused scanner
                let cell_start = tag_start;

                // Fused scan: combines find_cell_end + parse_cell_element in one pass.
                // Row-style filter is always enabled — empty cells matching the row
                // default style are skipped. The OOXML <row> element carries the
                // style attribute, so the writer doesn't need individual <c> entries.
                let effective_row_style = current_row_style;
                let ScanResult {
                    cell: cell_opt,
                    end: cell_end,
                    is_self_closing,
                    has_cm,
                    vm_val,
                    has_explicit_s,
                    has_xml_space_v,
                    sst_raw_idx,
                    authored_style_only,
                } = match scan_cell(
                    xml,
                    cell_start,
                    current_row,
                    shared_strings,
                    strings,
                    effective_row_style,
                    col_styles,
                ) {
                    Some(sr) => sr,
                    None => break,
                };

                let cell_parsed = if let Some(cell_data) = cell_opt {
                    cells[cell_idx] = cell_data;
                    cell_idx += 1;
                    true
                } else {
                    false
                };

                // Collect extras for single-pass postprocessing (when enabled).
                // Opening-tag extras (cm, vm, s) and <v> extras (xml_space, sst_raw_idx)
                // are already extracted by scan_cell — no re-scanning needed.
                if let Some(ref mut ext) = extras {
                    if let Some(style_only) = authored_style_only {
                        ext.authored_style_only_cells.push(style_only);
                    }
                }
                if cell_parsed {
                    if let Some(ref mut ext) = extras {
                        let last_idx = cell_idx - 1;
                        let cd = cells[last_idx];

                        // Use pre-extracted opening-tag extras from scan_cell
                        if has_cm {
                            ext.cm_cells.push(last_idx);
                        }
                        if let Some(vm) = vm_val {
                            ext.vm_cells.push((last_idx, vm));
                        }
                        if has_explicit_s {
                            ext.explicit_style_cells.push(last_idx);
                        }
                        if has_xml_space_v {
                            ext.xml_space_value_indices.push(last_idx);
                        }
                        if let Some(idx) = sst_raw_idx {
                            ext.sst_indices.push((last_idx, idx));
                        }

                        // Only formula cells need the remaining extras — the vast majority
                        // of cells are plain values and can skip this for zero overhead.
                        if !is_self_closing
                            && (cd.value_type == VALUE_TYPE_FORMULA
                                || cd.value_type == VALUE_TYPE_CACHED_FORMULA)
                        {
                            let cell_xml = &xml[cell_start..cell_end];

                            // Single-pass extraction of all formula extras from the
                            // cell XML, replacing 7-9 sequential find_sequence() calls.
                            let fe = extract_formula_extras_fused(cell_xml);

                            // xml:space="preserve" on <v> (if not already found by scan_cell)
                            if !has_xml_space_v && fe.v_xml_space {
                                ext.xml_space_value_indices.push(last_idx);
                            }

                            // Shared formula collection
                            if let Some(sf) = &fe.shared {
                                if let Some((cell_row, cell_col)) = parse_cell_ref_fast(cell_xml) {
                                    if sf.is_master {
                                        // For master cells, formula_text lives in fe.formula_text
                                        if let Some(formula_bytes) = fe.formula_text {
                                            let formula_text = if formula_bytes.contains(&b'&') {
                                                let mut decoded =
                                                    Vec::with_capacity(formula_bytes.len());
                                                crate::domain::strings::read::decode_xml_entities_full(formula_bytes, &mut decoded);
                                                validated_xml_text(&decoded)
                                            } else {
                                                validated_xml_text(formula_bytes)
                                            };
                                            let ref_range_str = sf
                                                .ref_range
                                                .map(validated_xml_text)
                                                .unwrap_or_default();
                                            ext.sf_masters.insert(
                                                sf.si,
                                                crate::domain::cells::types::SharedFormulaMaster {
                                                    formula_text,
                                                    master_row: cell_row,
                                                    master_col: cell_col,
                                                    ref_range: ref_range_str,
                                                },
                                            );
                                        }
                                    } else {
                                        ext.sf_refs.push((sf.si, cell_row, cell_col));
                                    }
                                }
                            }

                            // Cached <v> value for formula cells
                            if cd.value_type == VALUE_TYPE_FORMULA {
                                if fe.v_self_closing {
                                    // Self-closing <v/> — empty cached value
                                    let offset = strings.len() as u32;
                                    ext.cached_values.push((last_idx, offset, 0));
                                } else if let Some(cached_bytes) = fe.v_content {
                                    let offset = strings.len() as u32;
                                    let len = cached_bytes.len() as u32;
                                    strings.extend_from_slice(cached_bytes);
                                    ext.cached_values.push((last_idx, offset, len));
                                }
                            }

                            // ca="1" — needs recalculation flag
                            if fe.ca {
                                ext.force_recalc_indices.push(last_idx);
                            }

                            // aca="1" — always calculate array
                            if fe.aca {
                                ext.aca_indices.push(last_idx);
                            }

                            // xml:space="preserve" on <f>
                            if fe.f_xml_space {
                                ext.xml_space_formula_indices.push(last_idx);
                            }

                            // Array formulas: <f t="array" ref="A1:C5">
                            if fe.is_array {
                                if let Some(ref_bytes) = fe.f_ref {
                                    let ref_val = validated_xml_text(ref_bytes);
                                    ext.array_refs.push((last_idx, ref_val));
                                }
                            }

                            // Data table detection
                            if fe.is_data_table && cd.value_type == VALUE_TYPE_CACHED_FORMULA {
                                let r1_str = fe.r1.map(validated_xml_text);
                                let r2_str = fe.r2.map(validated_xml_text);
                                let r1_typed =
                                    r1_str.as_deref().and_then(parse_data_table_input_ref);
                                let r2_typed =
                                    r2_str.as_deref().and_then(parse_data_table_input_ref);
                                let r1_raw = r1_typed.as_ref().and(r1_str);
                                let r2_raw = r2_typed.as_ref().and(r2_str);

                                let mut pushed = false;
                                if let Some(ref_bytes) = fe.f_ref {
                                    let ref_val = validated_xml_text(ref_bytes);
                                    if let Some(colon) = ref_val.find(':') {
                                        let start_ref = &ref_val[..colon];
                                        let end_ref = &ref_val[colon + 1..];
                                        if let (Some((sr, sc)), Some((er, ec))) = (
                                            parse_a1_reference(start_ref.as_bytes()),
                                            parse_a1_reference(end_ref.as_bytes()),
                                        ) {
                                            ext.data_tables.push(DataTableEntry {
                                                start_row: sr,
                                                start_col: sc,
                                                end_row: er,
                                                end_col: ec,
                                                row_input_ref: r1_typed,
                                                col_input_ref: r2_typed,
                                                r1: r1_raw.clone(),
                                                r2: r2_raw.clone(),
                                                dt2d: fe.dt2d,
                                                aca: fe.aca,
                                                ca: fe.ca,
                                                bx: fe.bx,
                                                dtr: fe.dtr,
                                                del1: fe.del1,
                                                del2: fe.del2,
                                            });
                                            pushed = true;
                                        }
                                    }
                                }
                                if !pushed {
                                    if let Some((cell_row, cell_col)) =
                                        parse_cell_ref_fast(cell_xml)
                                    {
                                        ext.data_tables.push(DataTableEntry {
                                            start_row: cell_row,
                                            start_col: cell_col,
                                            end_row: cell_row,
                                            end_col: cell_col,
                                            row_input_ref: r1_typed,
                                            col_input_ref: r2_typed,
                                            r1: r1_raw.clone(),
                                            r2: r2_raw.clone(),
                                            dt2d: fe.dt2d,
                                            aca: fe.aca,
                                            ca: fe.ca,
                                            bx: fe.bx,
                                            dtr: fe.dtr,
                                            del1: fe.del1,
                                            del2: fe.del2,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                pos = cell_end;
            } else if xml[pos] == b'/' {
                // Closing tag - skip it
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    pos = gt + 1;
                }
            } else {
                // Unknown tag - skip to end
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    pos = gt + 1;
                }
            }
        } else {
            break;
        }
    }

    cell_idx
}

/// Parse worksheet XML with error recovery context.
///
/// This function extends `parse_worksheet_fast` with comprehensive error handling
/// and recovery capabilities. Use this when you need to handle malformed or
/// corrupted XLSX files gracefully.
///
/// # Arguments
/// * `xml` - Raw XML bytes of the worksheet
/// * `shared_strings` - Array of shared string references
/// * `cells` - Output buffer for cell data (pre-allocated)
/// * `strings` - Output buffer for string values
/// * `context` - Parse context for error tracking and recovery settings
///
/// # Returns
/// A tuple of (cells_parsed, cells_skipped) where:
/// - `cells_parsed` is the number of valid cells written to the buffer
/// - `cells_skipped` is the number of cells that had errors and were skipped
///
/// # Error Recovery
///
/// The function handles these error cases based on the context's parse mode:
///
/// | Error Case | Recovery Strategy |
/// |------------|------------------|
/// | Invalid cell reference | Skip cell or use (0,0) in permissive mode |
/// | Invalid shared string index | Use "#REF!" placeholder or skip cell |
/// | Malformed XML in cell | Skip cell, continue to next |
/// | Invalid type attribute | Default to string type |
/// | Invalid style index | Use style 0 (default) |
/// | Missing value element | Treat as empty cell |
/// | Invalid number value | Use 0.0 or skip cell |
///
/// # Example
///
/// ```rust
/// use xlsx_parser::domain::cells::{parse_worksheet_with_context, CellData};
/// use xlsx_parser::ParseContext;
///
/// let xml = b"<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><v>42</v></c></row></sheetData></worksheet>";
/// let shared_strings: Vec<&str> = vec![];
/// let mut cells = vec![CellData::default(); 100];
/// let mut strings = Vec::new();
/// let mut ctx = ParseContext::lenient();
///
/// let (parsed, skipped) = parse_worksheet_with_context(
///     xml, &shared_strings, &mut cells, &mut strings, &mut ctx, &mut Vec::new(), &[]
/// );
/// ```
pub fn parse_worksheet_with_context(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    context: &mut ParseContext,
    row_heights: &mut Vec<RowHeight>,
    _col_styles: &[Option<u32>],
) -> (usize, usize) {
    let mut cell_idx = 0;
    let mut skipped_count = 0;
    let mut pos = 0;

    // Skip to <sheetData> - this is where all cell data lives
    pos = match find_sheet_data(xml, pos) {
        Some(p) => p,
        None => {
            // No sheetData found - this could be valid (empty sheet) or an error
            context.report_warning(
                ErrorCode::MissingAttribute,
                "No <sheetData> element found in worksheet",
            );
            return (0, 0);
        }
    };

    // Find the end of sheetData for bounds checking
    let sheet_data_end = find_sequence(xml, b"</sheetData>", pos).unwrap_or(xml.len());

    // Current row number (used when row doesn't have explicit r attribute)
    let mut current_row: u32 = 0;

    // Main parsing loop
    while pos < sheet_data_end && cell_idx < cells.len() {
        // Check if we should stop due to errors in strict mode
        if context.should_stop() {
            break;
        }

        // Skip whitespace
        pos = skip_whitespace(xml, pos);
        if pos >= sheet_data_end {
            break;
        }

        // Look for <row or <c elements
        if let Some(tag_start) = find_byte(xml, b'<', pos) {
            if tag_start >= sheet_data_end {
                break;
            }
            pos = tag_start + 1;

            // Check what tag we found
            if pos + 3 < xml.len()
                && xml[pos] == b'r'
                && xml[pos + 1] == b'o'
                && xml[pos + 2] == b'w'
            {
                // Found <row> element - extract row number
                if let Some(row_num) = parse_row_number(xml, pos) {
                    current_row = row_num.saturating_sub(1); // Convert to 0-indexed
                }
                // Skip to end of opening tag, extracting ht and row style attributes
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    let tag_bytes = &xml[pos..gt];

                    // Extract row height if ht attribute is present
                    // Parse row attributes: height, customHeight, hidden, outlineLevel, etc.
                    {
                        // Use " ht=\"" (with leading space) to avoid matching
                        // inside "customHeight=\"..." which also contains "ht=\"".
                        let (height, height_str) = match find_sequence(tag_bytes, b" ht=\"", 0) {
                            Some(ht_pos) => {
                                let vs = ht_pos + 5; // len of b" ht=\""
                                match find_byte(tag_bytes, b'"', vs) {
                                    Some(qe) => {
                                        let raw = std::str::from_utf8(&tag_bytes[vs..qe]).ok();
                                        let val = raw.and_then(|s| s.parse::<f64>().ok());
                                        (val, raw.map(|s| s.to_string()))
                                    }
                                    None => (None, None),
                                }
                            }
                            None => (None, None),
                        };
                        let has_custom =
                            find_sequence(tag_bytes, b"customHeight=\"1\"", 0).is_some();
                        // Parse hidden with any value ("0" or "1") for round-trip fidelity
                        let hidden_val: Option<bool> = find_sequence(tag_bytes, b"hidden=\"", 0)
                            .and_then(|hp| {
                                let vs = hp + 8; // len of b"hidden=\""
                                find_byte(tag_bytes, b'"', vs).and_then(|qe| {
                                    match &tag_bytes[vs..qe] {
                                        b"1" | b"true" => Some(true),
                                        b"0" | b"false" => Some(false),
                                        _ => None,
                                    }
                                })
                            });
                        // Parse collapsed with any value ("0" or "1") for round-trip fidelity
                        let collapsed_val: Option<bool> =
                            find_sequence(tag_bytes, b" collapsed=\"", 0).and_then(|cp| {
                                let vs = cp + 12; // len of b" collapsed=\""
                                find_byte(tag_bytes, b'"', vs).and_then(|qe| {
                                    match &tag_bytes[vs..qe] {
                                        b"1" | b"true" => Some(true),
                                        b"0" | b"false" => Some(false),
                                        _ => None,
                                    }
                                })
                            });
                        let has_thick_top =
                            find_sequence(tag_bytes, b"thickTop=\"1\"", 0).is_some();
                        let has_thick_bot =
                            find_sequence(tag_bytes, b"thickBot=\"1\"", 0).is_some();
                        let outline_lvl =
                            find_sequence(tag_bytes, b"outlineLevel=\"", 0).and_then(|ol_pos| {
                                let vs = ol_pos + 14;
                                find_byte(tag_bytes, b'"', vs).and_then(|qe| {
                                    std::str::from_utf8(&tag_bytes[vs..qe])
                                        .ok()?
                                        .parse::<u8>()
                                        .ok()
                                })
                            });
                        let has_attrs = height.is_some()
                            || has_custom
                            || hidden_val.is_some()
                            || collapsed_val.is_some()
                            || has_thick_top
                            || has_thick_bot
                            || outline_lvl.is_some();
                        if has_attrs {
                            let mut rh = RowHeight::new(current_row, height.unwrap_or(0.0));
                            rh.height_str = height_str;
                            rh.custom_height = has_custom;
                            rh.hidden = hidden_val;
                            rh.collapsed = collapsed_val;
                            rh.thick_top = has_thick_top;
                            rh.thick_bot = has_thick_bot;
                            rh.outline_level = outline_lvl;
                            row_heights.push(rh);
                        }
                    }

                    // Extract row style: s="..." requires customFormat="1"
                    let mut row_style: Option<u32> = None;
                    let has_custom_format =
                        find_sequence(tag_bytes, b"customFormat=\"1\"", 0).is_some();
                    if has_custom_format {
                        if let Some(s_pos) = find_sequence(tag_bytes, b" s=\"", 0) {
                            let val_start = s_pos + 4; // len of ' s="'
                            if let Some(quote_end) = find_byte(tag_bytes, b'"', val_start) {
                                if let Ok(s_str) =
                                    std::str::from_utf8(&tag_bytes[val_start..quote_end])
                                {
                                    if let Ok(style) = s_str.parse::<u32>() {
                                        row_style = Some(style);
                                    }
                                }
                            }
                        }
                    }
                    // If row has a style or customFormat, ensure a RowHeight entry carries it
                    if row_style.is_some() || has_custom_format {
                        if let Some(last_rh) = row_heights.last_mut() {
                            if last_rh.row == current_row {
                                if let Some(style) = row_style {
                                    last_rh.style = Some(style);
                                }
                                last_rh.custom_format = has_custom_format;
                            } else {
                                let mut rh = RowHeight::new(current_row, 0.0);
                                rh.custom_format = has_custom_format;
                                if let Some(style) = row_style {
                                    rh.style = Some(style);
                                }
                                row_heights.push(rh);
                            }
                        } else {
                            let mut rh = RowHeight::new(current_row, 0.0);
                            rh.custom_format = has_custom_format;
                            if let Some(style) = row_style {
                                rh.style = Some(style);
                            }
                            row_heights.push(rh);
                        }
                    }

                    pos = gt + 1;
                }
            } else if xml[pos] == b'c'
                && (xml.get(pos + 1).map_or(true, |&c| c == b' ' || c == b'>'))
            {
                // Found <c> element - parse cell with error recovery
                let cell_start = tag_start;

                // Find the end of the cell element
                let CellEnd {
                    end: cell_end,
                    is_self_closing,
                } =
                    match find_cell_end(xml, pos) {
                        Some(ce) => ce,
                        None => {
                            // Malformed XML - cannot find cell end
                            context.report_error_detail(
                                ParseErrorDetail::error(
                                    ErrorCode::MalformedXml,
                                    "Cannot find end of cell element",
                                )
                                .with_location(
                                    ErrorLocation::cell(&context.current_part, current_row + 1, 0),
                                ),
                            );
                            if context.should_stop() {
                                return (cell_idx, skipped_count);
                            }
                            skipped_count += 1;
                            // Try to recover by finding next < tag
                            if let Some(next_lt) = find_byte(xml, b'<', pos) {
                                pos = next_lt;
                                continue;
                            }
                            break;
                        }
                    };

                // Parse cell attributes and value with error recovery
                match parse_cell_element_with_context(
                    &xml[cell_start..cell_end],
                    current_row,
                    shared_strings,
                    strings,
                    context,
                    is_self_closing,
                ) {
                    CellParseResult::Success(cell_data) => {
                        cells[cell_idx] = cell_data;
                        cell_idx += 1;
                    }
                    CellParseResult::Skipped => {
                        skipped_count += 1;
                    }
                    CellParseResult::Stop => {
                        return (cell_idx, skipped_count);
                    }
                }

                pos = cell_end;
            } else if xml[pos] == b'/' {
                // Closing tag - skip it
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    pos = gt + 1;
                }
            } else {
                // Unknown tag - skip to end
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    pos = gt + 1;
                }
            }
        } else {
            break;
        }
    }

    (cell_idx, skipped_count)
}

#[cfg(test)]
mod data_table_input_ref_tests {
    //! Typed data-table input refs: regression tests for `parse_data_table_input_ref`,
    //! the parser-side classifier for `<f t="dataTable">` r1/r2 attributes.

    use super::parse_data_table_input_ref;
    use formula_types::CellRef;

    #[test]
    fn classifies_simple_absolute_cell() {
        let r = parse_data_table_input_ref("$A$1").expect("absolute cell ref");
        match r {
            CellRef::Positional { row, col, .. } => {
                assert_eq!((row, col), (0, 0));
            }
            CellRef::Resolved(_) => panic!("expected positional"),
        }
    }

    #[test]
    fn classifies_simple_relative_cell() {
        let r = parse_data_table_input_ref("K36").expect("relative cell ref");
        match r {
            CellRef::Positional { row, col, .. } => {
                assert_eq!((row, col), (35, 10));
            }
            CellRef::Resolved(_) => panic!("expected positional"),
        }
    }

    #[test]
    fn ref_error_token_is_none() {
        // `is_broken_cell_ref` (deleted in W3) used to filter `#REF!`
        // tokens. Post-W4.b the typed classifier reaches the same
        // result via `compute_parser::parse_a1_cell` returning `None`.
        assert!(parse_data_table_input_ref("#REF!").is_none());
    }

    #[test]
    fn empty_string_is_none() {
        assert!(parse_data_table_input_ref("").is_none());
    }

    #[test]
    fn range_form_is_none() {
        // r1/r2 are single-cell only.
        assert!(parse_data_table_input_ref("A1:B2").is_none());
    }

    #[test]
    fn non_ascii_does_not_panic() {
        // UTF-8 boundary incident class: byte-level shadow parsers panicked
        // on `&str[n..]` slices at non-UTF-8 boundaries. The typed
        // classifier delegates to `compute_parser::parse_a1_cell`,
        // which is proptest-covered against arbitrary Unicode (W1).
        // This regression test pins one concrete case.
        let _ = parse_data_table_input_ref("Πλήρης_Εκτύπωση"); // must not panic
        let _ = parse_data_table_input_ref("'Sheet 1'!Α1"); // must not panic
        let _ = parse_data_table_input_ref("μμμμμμ"); // must not panic
        let _ = parse_data_table_input_ref(""); // empty
        let _ = parse_data_table_input_ref("\u{0}"); // NUL
    }
}
