//! Helper functions for the cell parser.
//!
//! Contains utility functions for cell reference parsing, type parsing,
//! value extraction, and column letter conversion.

use super::adapters::{find_byte, find_sequence};
use super::types::{
    AuthoredStyleOnlyCell, CELL_TYPE_BOOL, CELL_TYPE_ERROR, CELL_TYPE_FORMULA_STRING,
    CELL_TYPE_NUMBER, CELL_TYPE_STRING, CellData, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA,
    VALUE_TYPE_INLINE, VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};
pub use crate::infra::a1::col_to_letters;

/// Result of scanning a single cell element.
pub(crate) struct ScanResult {
    /// The parsed cell data, or None if the cell was skipped (redundant style).
    pub cell: Option<CellData>,
    /// Position in the XML after this cell element ends (past `/>` or `</c>`).
    pub end: usize,
    /// True if the element was self-closing (`<c ... />`).
    pub is_self_closing: bool,
    // --- Extras extracted during the scan (avoids re-scanning) ---
    /// `cm="..."` attribute present on `<c>` tag (cell metadata / dynamic arrays).
    pub has_cm: bool,
    /// `vm="N"` attribute value on `<c>` tag (value metadata index).
    pub vm_val: Option<u32>,
    /// Explicit `s="..."` attribute present on `<c>` tag.
    pub has_explicit_s: bool,
    /// `xml:space="preserve"` on `<v>` element.
    pub has_xml_space_v: bool,
    /// Raw SST index from `<v>N</v>` for shared-string cells.
    pub sst_raw_idx: Option<u32>,
    /// Authored style-only blank cell side channel.
    pub authored_style_only: Option<AuthoredStyleOnlyCell>,
}

/// Fused cell scanner: combines find_cell_end + parse_cell_element into a single pass,
/// also extracting extras data inline to avoid re-scanning.
///
/// Walks the cell XML exactly once:
/// 1. Scans the opening `<c ...>` tag for r/s/t attributes AND cm/vm extras
/// 2. If self-closing (`/>`): emits immediately
/// 3. Otherwise: extracts value from child elements AND captures <v> extras
/// 4. Finds `</c>` to determine the end position
///
/// Safe because `<c>` children in OOXML are always flat (`<f>`, `<v>`, `<is>`).
#[inline(always)]
pub(crate) fn scan_cell<'a>(
    xml: &'a [u8],
    cell_start: usize, // position of '<' in '<c ...'
    fallback_row: u32,
    shared_strings: &'a [&'a str],
    strings: &mut Vec<u8>,
    _row_style_idx: Option<u32>,
    _col_styles: &[Option<u32>],
) -> Option<ScanResult> {
    let len = xml.len();
    let mut pos = cell_start + 2; // Skip past "<c"

    // --- Step 1: scan opening tag for r/s/t attributes + extras (cm, vm, s) ---
    let mut row = fallback_row;
    let mut col = 0u32;
    let mut style_idx: u16 = 0;
    let mut cell_type: u8 = CELL_TYPE_NUMBER;
    let mut has_cm = false;
    let mut vm_val: Option<u32> = None;
    let mut has_explicit_s = false;
    let mut has_explicit_t = false;

    loop {
        if pos >= len {
            return None;
        }
        let b = xml[pos];

        if b == b'>' {
            pos += 1;
            break; // End of opening tag, not self-closing
        }

        if b == b'/' && pos + 1 < len && xml[pos + 1] == b'>' {
            // Self-closing <c ... />
            let end = pos + 2;

            if has_explicit_s && !has_cm && vm_val.is_none() && !has_explicit_t {
                return Some(ScanResult {
                    cell: None,
                    end,
                    is_self_closing: true,
                    has_cm,
                    vm_val,
                    has_explicit_s,
                    has_xml_space_v: false,
                    sst_raw_idx: None,
                    authored_style_only: Some(AuthoredStyleOnlyCell {
                        row,
                        col,
                        style_idx: style_idx as u32,
                    }),
                });
            }

            let value_offset = strings.len() as u32;
            return Some(ScanResult {
                cell: Some(CellData {
                    row,
                    col,
                    cell_type,
                    style_idx,
                    value_type: VALUE_TYPE_NONE,
                    value_offset,
                    value_len: 0,
                }),
                end,
                is_self_closing: true,
                has_cm,
                vm_val,
                has_explicit_s,
                has_xml_space_v: false,
                sst_raw_idx: None,
                authored_style_only: None,
            });
        }

        if b == b' ' || b == b'\t' || b == b'\n' || b == b'\r' {
            pos += 1;
            continue;
        }

        // Attribute parsing
        if pos + 2 < len && xml[pos + 1] == b'=' && xml[pos + 2] == b'"' {
            // Single-char attribute: x="..."
            let val_start = pos + 3;
            let mut val_end = val_start;
            while val_end < len && xml[val_end] != b'"' {
                val_end += 1;
            }

            match b {
                b'r' => {
                    if let Some((r, c)) = parse_a1_reference(&xml[val_start..val_end]) {
                        row = r;
                        col = c;
                    }
                }
                b's' => {
                    has_explicit_s = true;
                    let mut val: u16 = 0;
                    for &d in &xml[val_start..val_end] {
                        if d.is_ascii_digit() {
                            val = val.wrapping_mul(10).wrapping_add((d - b'0') as u16);
                        } else {
                            break;
                        }
                    }
                    style_idx = val;
                }
                b't' => {
                    has_explicit_t = true;
                    if val_start < val_end {
                        cell_type = match xml[val_start] {
                            b'n' => CELL_TYPE_NUMBER,
                            b's' => {
                                if val_start + 1 < val_end && xml[val_start + 1] == b't' {
                                    CELL_TYPE_FORMULA_STRING
                                } else {
                                    CELL_TYPE_STRING
                                }
                            }
                            b'i' => CELL_TYPE_STRING,
                            b'b' => CELL_TYPE_BOOL,
                            b'e' => CELL_TYPE_ERROR,
                            _ => CELL_TYPE_NUMBER,
                        };
                    }
                }
                _ => {}
            }
            pos = if val_end < len { val_end + 1 } else { len };
        } else {
            // Multi-char attribute — extract cm/vm, skip others
            let attr_name_start = pos;
            while pos < len && xml[pos] != b'=' && xml[pos] != b'>' && xml[pos] != b'/' {
                pos += 1;
            }
            let attr_name_len = pos - attr_name_start;

            if pos < len && xml[pos] == b'=' {
                if pos + 1 < len && xml[pos + 1] == b'"' {
                    let val_start = pos + 2;
                    pos = val_start;
                    while pos < len && xml[pos] != b'"' {
                        pos += 1;
                    }
                    let val_end = pos;

                    // Check for cm and vm attributes
                    if attr_name_len == 2 {
                        let a = xml[attr_name_start];
                        let b2 = xml[attr_name_start + 1];
                        if a == b'c' && b2 == b'm' {
                            has_cm = true;
                        } else if a == b'v' && b2 == b'm' {
                            vm_val = parse_u32(&xml[val_start..val_end]);
                        }
                    }

                    if pos < len {
                        pos += 1;
                    }
                } else {
                    pos += 1;
                }
            }
            // If we hit '>' or '/', the loop will handle it next iteration
        }
    }

    // --- Step 2: extract value from body with inline <v> extras ---
    // pos is now right after the opening '>'
    let body_start = pos;
    let mut has_xml_space_v = false;
    let mut sst_raw_idx: Option<u32> = None;
    // Track scan end position so step 3 can find </c> faster
    let mut scan_end: usize = body_start;

    // Fast path: in most cells, the first child '<' immediately follows the opening '>'
    // (e.g., `<c r="A1"><v>42</v></c>`). Check the byte directly to avoid SIMD find_byte overhead.
    let first_lt_opt = if body_start < len && xml[body_start] == b'<' {
        Some(body_start)
    } else {
        find_byte(xml, b'<', body_start)
    };
    let (value_type, value_bytes): (u8, &[u8]) = if let Some(first_lt) = first_lt_opt {
        let next = first_lt + 1;
        if next < len {
            match xml[next] {
                b'f' => extract_formula_forward(xml, first_lt, cell_type, shared_strings),
                b'v' => {
                    // Inline <v> extraction to also capture xml_space and sst_raw_idx
                    let after_v = first_lt + 2;
                    if after_v >= len {
                        (VALUE_TYPE_NONE, b"" as &[u8])
                    } else {
                        match xml[after_v] {
                            b'>' => {
                                // <v>content</v> — find </v> by scanning for '<'
                                // Cell values are typically short (1-20 bytes for numbers,
                                // 1-10 bytes for SST indices), so a simple byte scan
                                // beats SIMD find_sequence overhead.
                                let content_start = after_v + 1;
                                let v_end = {
                                    let mut p = content_start;
                                    while p < len && xml[p] != b'<' {
                                        p += 1;
                                    }
                                    p
                                };
                                if v_end < len {
                                    // Verify it's actually </v> (should always be true in well-formed XML)
                                    scan_end = v_end + 4; // past "</v>"
                                    let value_bytes = &xml[content_start..v_end];
                                    if cell_type == CELL_TYPE_STRING {
                                        let raw_idx = parse_u32(value_bytes);
                                        sst_raw_idx = raw_idx;
                                        if let Some(idx) = raw_idx {
                                            if let Some(shared_str) =
                                                shared_strings.get(idx as usize)
                                            {
                                                (VALUE_TYPE_SHARED_STRING, shared_str.as_bytes())
                                            } else {
                                                (VALUE_TYPE_INLINE, value_bytes)
                                            }
                                        } else {
                                            (VALUE_TYPE_INLINE, value_bytes)
                                        }
                                    } else {
                                        (VALUE_TYPE_INLINE, value_bytes)
                                    }
                                } else {
                                    (VALUE_TYPE_NONE, b"" as &[u8])
                                }
                            }
                            b'/' if after_v + 1 < len && xml[after_v + 1] == b'>' => {
                                scan_end = after_v + 2; // past "<v/>"
                                (VALUE_TYPE_INLINE, b"" as &[u8]) // <v/>
                            }
                            _ => {
                                // <v ...> (attributes like xml:space="preserve")
                                let tag_region_start = after_v;
                                match find_byte(xml, b'>', tag_region_start) {
                                    Some(gt) => {
                                        let tag_bytes = &xml[first_lt..=gt];
                                        if tag_bytes.windows(9).any(|w| w == b"xml:space") {
                                            has_xml_space_v = true;
                                        }
                                        let content_start = gt + 1;
                                        if let Some(v_end) =
                                            find_sequence(xml, b"</v>", content_start)
                                        {
                                            scan_end = v_end + 4;
                                            let value_bytes = &xml[content_start..v_end];
                                            if cell_type == CELL_TYPE_STRING {
                                                let raw_idx = parse_u32(value_bytes);
                                                sst_raw_idx = raw_idx;
                                                if let Some(idx) = raw_idx {
                                                    if let Some(shared_str) =
                                                        shared_strings.get(idx as usize)
                                                    {
                                                        (
                                                            VALUE_TYPE_SHARED_STRING,
                                                            shared_str.as_bytes(),
                                                        )
                                                    } else {
                                                        (VALUE_TYPE_INLINE, value_bytes)
                                                    }
                                                } else {
                                                    (VALUE_TYPE_INLINE, value_bytes)
                                                }
                                            } else {
                                                (VALUE_TYPE_INLINE, value_bytes)
                                            }
                                        } else {
                                            (VALUE_TYPE_NONE, b"" as &[u8])
                                        }
                                    }
                                    None => (VALUE_TYPE_NONE, b"" as &[u8]),
                                }
                            }
                        }
                    }
                }
                b'i' => extract_inline_string_forward(xml, first_lt),
                _ => (VALUE_TYPE_NONE, b"" as &[u8]),
            }
        } else {
            (VALUE_TYPE_NONE, b"" as &[u8])
        }
    } else {
        (VALUE_TYPE_NONE, b"" as &[u8])
    };

    // --- Step 3: find </c> end ---
    // Fast path: after the last child element's closing tag, </c> is usually
    // immediate (0-2 bytes of whitespace). Use a simple byte scan instead of
    // SIMD find_sequence when scan_end is close to the actual </c>.
    let cell_end = 'find_end: {
        if scan_end > body_start {
            // We know where the last child element ended — scan forward
            let mut p = scan_end;
            // Skip optional whitespace between </v> and </c>
            while p < len
                && (xml[p] == b' ' || xml[p] == b'\n' || xml[p] == b'\r' || xml[p] == b'\t')
            {
                p += 1;
            }
            if p + 3 < len
                && xml[p] == b'<'
                && xml[p + 1] == b'/'
                && xml[p + 2] == b'c'
                && xml[p + 3] == b'>'
            {
                break 'find_end p + 4;
            }
        }
        // Fallback: SIMD search for unusual cell structures or formula cells
        match find_sequence(xml, b"</c>", body_start) {
            Some(p) => p + 4,
            None => return None,
        }
    };

    let make_result = |cell| ScanResult {
        cell,
        end: cell_end,
        is_self_closing: false,
        has_cm,
        vm_val,
        has_explicit_s,
        has_xml_space_v,
        sst_raw_idx,
        authored_style_only: None,
    };

    if value_type == VALUE_TYPE_NONE
        && has_explicit_s
        && !has_cm
        && vm_val.is_none()
        && !has_explicit_t
    {
        return Some(ScanResult {
            cell: None,
            end: cell_end,
            is_self_closing: false,
            has_cm,
            vm_val,
            has_explicit_s,
            has_xml_space_v,
            sst_raw_idx,
            authored_style_only: Some(AuthoredStyleOnlyCell {
                row,
                col,
                style_idx: style_idx as u32,
            }),
        });
    }

    let value_offset = strings.len() as u32;
    let value_len = value_bytes.len() as u32;
    strings.extend_from_slice(value_bytes);

    Some(make_result(Some(CellData {
        row,
        col,
        cell_type,
        style_idx,
        value_type,
        value_offset,
        value_len,
    })))
}

/// Parse A1-style cell reference without allocation.
///
/// Handles columns A-XFD (up to 16,384) and rows 1-1,048,576.
/// Returns 0-indexed (row, col) tuple.
///
/// # Examples
/// - "A1" -> (0, 0)
/// - "B2" -> (1, 1)
/// - "AA10" -> (9, 26)
/// - "XFD1048576" -> (1048575, 16383)
pub fn parse_cell_ref_fast(xml: &[u8]) -> Option<(u32, u32)> {
    // Find r=" attribute
    let r_pos = find_sequence(xml, b"r=\"", 0)?;
    let start = r_pos + 3;

    // Find the closing quote
    let end = find_byte(xml, b'"', start)?;

    parse_a1_reference(&xml[start..end])
}

/// Parse an A1 reference string directly (e.g., "A1", "XFD1048576")
///
/// Returns 0-indexed (row, col) tuple.
#[inline]
pub fn parse_a1_reference(reference: &[u8]) -> Option<(u32, u32)> {
    if reference.is_empty() {
        return None;
    }

    let mut pos = 0;

    // Extract column letters (1-3 uppercase letters)
    let mut col: u32 = 0;
    while pos < reference.len() && reference[pos].is_ascii_uppercase() {
        col = col
            .saturating_mul(26)
            .saturating_add((reference[pos] - b'A' + 1) as u32);
        pos += 1;
    }

    if col == 0 || pos == 0 {
        return None;
    }
    col -= 1; // Convert to 0-indexed

    // Extract row number
    let mut row: u32 = 0;
    while pos < reference.len() && reference[pos].is_ascii_digit() {
        row = row
            .saturating_mul(10)
            .saturating_add((reference[pos] - b'0') as u32);
        pos += 1;
    }

    if row == 0 {
        return None;
    }
    row -= 1; // Convert to 0-indexed

    // Validate ranges: max col = XFD (16383), max row = 1048575
    if col > 16383 || row > 1048575 {
        return None;
    }

    Some((row, col))
}

/// Parse cell type from the 't' attribute.
///
/// OOXML cell types:
/// - (none) or "n" -> number (default)
/// - "s" -> shared string index
/// - "str" -> inline string
/// - "inlineStr" -> inline string with rich text
/// - "b" -> boolean
/// - "e" -> error
///
/// Returns cell_type constant (CELL_TYPE_*)
pub fn parse_cell_type(xml: &[u8]) -> u8 {
    // Only search for t=" within the opening <c ...> tag, NOT in nested elements.
    // This prevents matching t="shared" on <f> formula elements which would
    // incorrectly be interpreted as t="s" (shared string reference).
    let search_end = find_byte(xml, b'>', 0).unwrap_or(xml.len());
    let search_region = &xml[..search_end];

    // Look for t=" attribute in the <c> opening tag only
    if let Some(t_pos) = find_sequence(search_region, b"t=\"", 0) {
        let start = t_pos + 3;

        // Read the type value (up to closing quote)
        if start < search_region.len() {
            match search_region[start] {
                b'n' => CELL_TYPE_NUMBER,
                b's' => {
                    // Could be "s" (shared string) or "str" (inline formula string)
                    if start + 1 < search_region.len() && search_region[start + 1] == b't' {
                        // "str" - inline formula string result (<v> is literal text, NOT a shared string index)
                        CELL_TYPE_FORMULA_STRING
                    } else {
                        // "s" - shared string reference (<v> is an index into shared strings table)
                        CELL_TYPE_STRING
                    }
                }
                b'i' => {
                    // "inlineStr"
                    CELL_TYPE_STRING
                }
                b'b' => CELL_TYPE_BOOL,
                b'e' => CELL_TYPE_ERROR,
                b'"' => CELL_TYPE_NUMBER, // Empty t="" defaults to number
                _ => CELL_TYPE_NUMBER,
            }
        } else {
            CELL_TYPE_NUMBER
        }
    } else {
        // No t attribute means number
        CELL_TYPE_NUMBER
    }
}

/// Parse style index from the 's' attribute.
///
/// The style index references an entry in the styles.xml cellXfs array.
pub fn parse_style_idx(xml: &[u8]) -> u16 {
    // Look for s=" attribute (space before to avoid matching other attrs ending in 's')
    // We check both " s=" and start of tag "<c s="
    let patterns: [&[u8]; 2] = [b" s=\"", b"<c s=\""];

    for pattern in patterns {
        if let Some(s_pos) = find_sequence(xml, pattern, 0) {
            let start = s_pos + pattern.len();
            let mut style_idx: u16 = 0;
            let mut pos = start;

            while pos < xml.len() && xml[pos].is_ascii_digit() {
                style_idx = style_idx
                    .saturating_mul(10)
                    .saturating_add((xml[pos] - b'0') as u16);
                pos += 1;
            }

            return style_idx;
        }
    }

    0 // Default style
}

/// Extract cell value from the cell element.
///
/// Returns (value_type, value_bytes) where:
/// - value_type indicates how to interpret the bytes
/// - value_bytes is a slice of the actual value data
///
/// Handles:
/// - `<v>` (value) elements for numbers and shared string indices
/// - `<f>` (formula) elements (simple and with attributes like t="shared")
/// - `<f/>` or `<f .../>` (self-closing formula - shared formula reference)
/// - `<is><t>` (inline string) elements
pub fn extract_cell_value_fast<'a>(xml: &'a [u8], shared_strings: &'a [&'a str]) -> (u8, &'a [u8]) {
    // Check for formula element (<f> or <f ...>)
    // First try simple <f>content</f>
    if let Some(f_start) = find_sequence(xml, b"<f>", 0) {
        let content_start = f_start + 3;
        if let Some(f_end) = find_sequence(xml, b"</f>", content_start) {
            return (VALUE_TYPE_FORMULA, &xml[content_start..f_end]);
        }
    }

    // Check for formula with attributes (<f t="shared" ...> or <f ref="..." ...>)
    if let Some(f_start) = find_sequence(xml, b"<f ", 0) {
        // Check if it's self-closing (<f ... />)
        let f_region_end = find_sequence(xml, b"</f>", f_start)
            .or_else(|| find_sequence(xml, b"/>", f_start).map(|p| p + 2))
            .unwrap_or(xml.len());
        let f_region = &xml[f_start..f_region_end];

        // Find the > that closes the opening tag
        if let Some(gt_offset) = find_byte(f_region, b'>', 0) {
            // Check if it's self-closing (ends with />)
            if gt_offset > 0 && f_region[gt_offset - 1] == b'/' {
                // Self-closing formula tag like <f t="shared" si="4"/>
                // This is a reference to a shared formula - the formula text is not
                // present in this cell. We extract the cached <v> value and mark
                // it as VALUE_TYPE_CACHED_FORMULA so the full parse path can detect
                // that this cell is a formula cell while still preserving the cached value.
                // The binary path treats this identically to VALUE_TYPE_INLINE since
                // it doesn't check value_type.
                // Find <v> content, handling both <v>text</v> and <v xml:space="preserve">text</v>
                let v_content_start = if let Some(v_start) = find_sequence(xml, b"<v>", 0) {
                    Some(v_start + 3)
                } else if let Some(v_start) = find_sequence(xml, b"<v ", 0) {
                    find_byte(xml, b'>', v_start).map(|gt| gt + 1)
                } else {
                    None
                };
                if let Some(content_start) = v_content_start {
                    if let Some(v_end) = find_sequence(xml, b"</v>", content_start) {
                        let value_bytes = &xml[content_start..v_end];

                        // Check if this is a shared string reference
                        let cell_type = parse_cell_type(xml);
                        if cell_type == CELL_TYPE_STRING {
                            if let Some(idx) = parse_u32(value_bytes) {
                                if let Some(shared_str) = shared_strings.get(idx as usize) {
                                    return (VALUE_TYPE_CACHED_FORMULA, shared_str.as_bytes());
                                }
                            }
                        }

                        return (VALUE_TYPE_CACHED_FORMULA, value_bytes);
                    }
                }
                // Self-closing formula with no <v> - return formula with empty value
                return (VALUE_TYPE_CACHED_FORMULA, b"" as &[u8]);
            } else {
                // Regular formula with attributes: <f t="shared" ...>formula</f>
                let content_start = f_start + gt_offset + 1;
                if let Some(f_end) = find_sequence(xml, b"</f>", content_start) {
                    return (VALUE_TYPE_FORMULA, &xml[content_start..f_end]);
                }
            }
        }
    }

    // Check for value (<v>) — handles both <v>text</v> and <v xml:space="preserve">text</v>
    let v_content_start = if let Some(v_start) = find_sequence(xml, b"<v>", 0) {
        Some(v_start + 3)
    } else if let Some(v_start) = find_sequence(xml, b"<v ", 0) {
        find_byte(xml, b'>', v_start).map(|gt| gt + 1)
    } else {
        None
    };
    if let Some(content_start) = v_content_start {
        if let Some(v_end) = find_sequence(xml, b"</v>", content_start) {
            let value_bytes = &xml[content_start..v_end];

            // Check if this is a shared string reference
            let cell_type = parse_cell_type(xml);
            if cell_type == CELL_TYPE_STRING {
                // Parse the shared string index
                if let Some(idx) = parse_u32(value_bytes) {
                    if let Some(shared_str) = shared_strings.get(idx as usize) {
                        // Return the actual string from shared strings
                        return (VALUE_TYPE_SHARED_STRING, shared_str.as_bytes());
                    }
                }
            }

            return (VALUE_TYPE_INLINE, value_bytes);
        }
    }

    // Check for inline string (<is><t>)
    if let Some(is_start) = find_sequence(xml, b"<is>", 0) {
        if let Some(t_start) = find_sequence(xml, b"<t>", is_start) {
            let content_start = t_start + 3;
            if let Some(t_end) = find_sequence(xml, b"</t>", content_start) {
                return (VALUE_TYPE_INLINE, &xml[content_start..t_end]);
            }
        }
        // Handle <t xml:space="preserve"> variant
        if let Some(t_start) = find_sequence(xml, b"<t ", is_start) {
            if let Some(gt) = find_byte(xml, b'>', t_start) {
                let content_start = gt + 1;
                if let Some(t_end) = find_sequence(xml, b"</t>", content_start) {
                    return (VALUE_TYPE_INLINE, &xml[content_start..t_end]);
                }
            }
        }
    }

    // Self-closing value element <v/>
    if find_sequence(xml, b"<v/>", 0).is_some() {
        return (VALUE_TYPE_INLINE, b"");
    }

    (VALUE_TYPE_NONE, b"")
}

/// Parse a u32 from ASCII digits without allocation
#[inline]
pub(crate) fn parse_u32(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() {
        return None;
    }

    let mut result: u32 = 0;
    for &b in bytes {
        if b.is_ascii_digit() {
            result = result.saturating_mul(10).saturating_add((b - b'0') as u32);
        } else {
            break;
        }
    }
    Some(result)
}

/// Find the start of <sheetData> section
pub(crate) fn find_sheet_data(xml: &[u8], start: usize) -> Option<usize> {
    find_sequence(xml, b"<sheetData", start).map(|p| {
        // Skip past the opening tag
        find_byte(xml, b'>', p).map_or(p, |gt| gt + 1)
    })
}

/// Parse row number from <row> element attributes
pub(crate) fn parse_row_number(xml: &[u8], start: usize) -> Option<u32> {
    // Find r=" attribute
    let mut pos = start;
    while pos + 3 < xml.len() {
        if let Some(r_pos) = find_sequence(xml, b"r=\"", pos) {
            // Check we're still in the tag (before >)
            if let Some(gt) = find_byte(xml, b'>', start) {
                if r_pos > gt {
                    return None;
                }
            }

            pos = r_pos + 3;
            let mut row: u32 = 0;
            while pos < xml.len() && xml[pos].is_ascii_digit() {
                row = row
                    .saturating_mul(10)
                    .saturating_add((xml[pos] - b'0') as u32);
                pos += 1;
            }
            if row > 0 {
                return Some(row);
            }
        } else {
            break;
        }
    }
    None
}

/// Find the end of a cell element (either /> or </c>)
/// Result of finding a cell element's end position.
/// `end` is the byte offset past the closing `>` or `/>`.
/// `is_self_closing` is true when the element is `<c ... />` (no children).
pub(crate) struct CellEnd {
    pub end: usize,
    pub is_self_closing: bool,
}

pub(crate) fn find_cell_end(xml: &[u8], start: usize) -> Option<CellEnd> {
    let mut pos = start;
    let mut depth = 1;
    let mut in_opening_tag = true; // We start inside the <c opening tag

    while pos < xml.len() && depth > 0 {
        // First, if we're in an opening tag, find its end (> or />)
        if in_opening_tag {
            while pos < xml.len() {
                match xml[pos] {
                    b'>' => {
                        // End of opening tag
                        in_opening_tag = false;
                        pos += 1;
                        break;
                    }
                    b'/' if pos + 1 < xml.len() && xml[pos + 1] == b'>' => {
                        // Self-closing tag
                        depth -= 1;
                        if depth == 0 {
                            return Some(CellEnd {
                                end: pos + 2,
                                is_self_closing: true,
                            });
                        }
                        in_opening_tag = false;
                        pos += 2;
                        break;
                    }
                    _ => pos += 1,
                }
            }
            continue;
        }

        // Find next < tag
        match find_byte(xml, b'<', pos) {
            Some(lt) => {
                pos = lt;
                if pos + 1 >= xml.len() {
                    break;
                }

                if xml[pos + 1] == b'/' {
                    // Closing tag </...>
                    depth -= 1;
                    if depth == 0 {
                        // Find the > of </c>
                        if let Some(gt) = find_byte(xml, b'>', pos) {
                            return Some(CellEnd {
                                end: gt + 1,
                                is_self_closing: false,
                            });
                        }
                    }
                    // Skip past the closing tag
                    if let Some(gt) = find_byte(xml, b'>', pos) {
                        pos = gt + 1;
                    } else {
                        break;
                    }
                } else {
                    // Opening tag <...>
                    depth += 1;
                    in_opening_tag = true;
                    pos += 1; // Move past the <
                }
            }
            None => break,
        }
    }
    None
}

/// Extract formula value, scanning forward from the `<f` position.
///
/// Handles `<f>formula</f>`, `<f ...>formula</f>`, and `<f .../>` (self-closing
/// shared formula reference with cached `<v>` value).
#[inline]
fn extract_formula_forward<'a>(
    xml: &'a [u8],
    f_lt: usize,
    cell_type: u8,
    shared_strings: &'a [&'a str],
) -> (u8, &'a [u8]) {
    let after_f = f_lt + 2; // past "<f"
    if after_f >= xml.len() {
        return (VALUE_TYPE_NONE, b"");
    }

    if xml[after_f] == b'>' {
        // Simple <f>content</f>
        let content_start = after_f + 1;
        if let Some(f_end) = find_sequence(xml, b"</f>", content_start) {
            return (VALUE_TYPE_FORMULA, &xml[content_start..f_end]);
        }
        return (VALUE_TYPE_NONE, b"");
    }

    // <f ...> or <f .../>
    let gt = match find_byte(xml, b'>', after_f) {
        Some(p) => p,
        None => return (VALUE_TYPE_NONE, b""),
    };

    if gt > 0 && xml[gt - 1] == b'/' {
        // Self-closing <f .../> — shared formula reference
        // Extract the cached <v> value that follows
        let after_f_tag = gt + 1;
        match find_byte(xml, b'<', after_f_tag) {
            Some(v_lt) if v_lt + 1 < xml.len() && xml[v_lt + 1] == b'v' => extract_v_forward(
                xml,
                v_lt,
                cell_type,
                shared_strings,
                VALUE_TYPE_CACHED_FORMULA,
            ),
            _ => (VALUE_TYPE_CACHED_FORMULA, b""),
        }
    } else {
        // <f ...>content</f>
        let content_start = gt + 1;
        if let Some(f_end) = find_sequence(xml, b"</f>", content_start) {
            return (VALUE_TYPE_FORMULA, &xml[content_start..f_end]);
        }
        (VALUE_TYPE_NONE, b"")
    }
}

/// Extract value from a `<v>` element at the given position.
///
/// `success_type` controls the returned value_type: `VALUE_TYPE_INLINE` for plain
/// value cells, `VALUE_TYPE_CACHED_FORMULA` for cached values after self-closing formulas.
/// Shared string resolution returns `VALUE_TYPE_SHARED_STRING` for plain values or
/// preserves `VALUE_TYPE_CACHED_FORMULA` for formula cells.
#[inline]
fn extract_v_forward<'a>(
    xml: &'a [u8],
    v_lt: usize,
    cell_type: u8,
    shared_strings: &'a [&'a str],
    success_type: u8,
) -> (u8, &'a [u8]) {
    let after_v = v_lt + 2; // past "<v"
    if after_v >= xml.len() {
        return (VALUE_TYPE_NONE, b"");
    }

    let content_start = match xml[after_v] {
        b'>' => after_v + 1, // <v>
        b'/' if after_v + 1 < xml.len() && xml[after_v + 1] == b'>' => {
            return (success_type, b""); // <v/>
        }
        _ => {
            // <v ...> (attributes like xml:space="preserve")
            match find_byte(xml, b'>', after_v) {
                Some(gt) => gt + 1,
                None => return (VALUE_TYPE_NONE, b""),
            }
        }
    };

    if let Some(v_end) = find_sequence(xml, b"</v>", content_start) {
        let value_bytes = &xml[content_start..v_end];

        // Resolve shared string reference
        if cell_type == CELL_TYPE_STRING {
            if let Some(idx) = parse_u32(value_bytes) {
                if let Some(shared_str) = shared_strings.get(idx as usize) {
                    // Plain values → SHARED_STRING; cached formulas keep CACHED_FORMULA
                    let vt = if success_type == VALUE_TYPE_CACHED_FORMULA {
                        VALUE_TYPE_CACHED_FORMULA
                    } else {
                        VALUE_TYPE_SHARED_STRING
                    };
                    return (vt, shared_str.as_bytes());
                }
            }
        }

        return (success_type, value_bytes);
    }

    (VALUE_TYPE_NONE, b"")
}

/// Extract inline string from `<is><t>content</t></is>`.
#[inline]
fn extract_inline_string_forward(xml: &[u8], is_lt: usize) -> (u8, &[u8]) {
    // Find end of <is...> tag
    let is_tag_end = match find_byte(xml, b'>', is_lt) {
        Some(p) => p,
        None => return (VALUE_TYPE_NONE, b""),
    };

    // Find <t> or <t ...> inside <is>
    let t_lt = match find_byte(xml, b'<', is_tag_end + 1) {
        Some(p) if p + 1 < xml.len() && xml[p + 1] == b't' => p,
        _ => return (VALUE_TYPE_NONE, b""),
    };

    let after_t = t_lt + 2;
    let content_start = if after_t < xml.len() && xml[after_t] == b'>' {
        after_t + 1 // <t>
    } else {
        // <t ...> (e.g. xml:space="preserve")
        match find_byte(xml, b'>', after_t) {
            Some(gt) => gt + 1,
            None => return (VALUE_TYPE_NONE, b""),
        }
    };

    if let Some(t_end) = find_sequence(xml, b"</t>", content_start) {
        return (VALUE_TYPE_INLINE, &xml[content_start..t_end]);
    }

    (VALUE_TYPE_NONE, b"")
}

/// Extract an attribute value from an XML element
pub(crate) fn extract_attribute<'a>(xml: &'a [u8], attr_name: &[u8]) -> Option<&'a [u8]> {
    // Build the pattern: attr_name="
    let mut pattern = Vec::with_capacity(attr_name.len() + 2);
    pattern.extend_from_slice(attr_name);
    pattern.extend_from_slice(b"=\"");

    if let Some(start) = find_sequence(xml, &pattern, 0) {
        let value_start = start + pattern.len();
        if let Some(end) = find_byte(xml, b'"', value_start) {
            return Some(&xml[value_start..end]);
        }
    }
    None
}

/// Shared formula metadata returned from `extract_shared_formula_info`.
///
/// This is returned when a cell's `<f>` element has `t="shared"` attribute.
#[derive(Debug)]
pub struct SharedFormulaExtract<'a> {
    /// The `si` attribute value
    pub si: u32,
    /// True if this is the master cell (has `ref=` attribute and formula text)
    pub is_master: bool,
    /// The formula text, if this is a master cell. None for reference cells.
    pub formula_text: Option<&'a [u8]>,
    /// The `ref="..."` attribute value for master cells, None for reference cells.
    pub ref_range: Option<&'a [u8]>,
}

/// Extract shared formula metadata from a cell element's XML.
///
/// Looks for `<f t="shared" ...>` patterns and returns:
/// - `None` if the cell doesn't have a shared formula
/// - `Some(SharedFormulaExtract)` with `si`, `is_master`, and optionally formula text
///
/// This function is designed to be called on the same XML slice that was passed
/// to `parse_cell_element`, so it only needs to scan the `<f ...>` portion.
pub fn extract_shared_formula_info(xml: &[u8]) -> Option<SharedFormulaExtract<'_>> {
    // Look for <f with attributes (shared formulas always have attributes)
    let f_start = find_sequence(xml, b"<f ", 0)?;

    // Extract the <f ...> tag region (up to the closing > or />)
    let f_region_end = find_sequence(xml, b"</f>", f_start)
        .or_else(|| find_sequence(xml, b"/>", f_start).map(|p| p + 2))
        .unwrap_or(xml.len());
    let f_tag = &xml[f_start..f_region_end];

    // Check for t="shared" attribute within the <f> tag
    find_sequence(f_tag, b"t=\"shared\"", 0)?;

    // Extract si attribute value
    let si_val = {
        let si_pattern = b"si=\"";
        let si_start = find_sequence(f_tag, si_pattern, 0)?;
        let val_start = si_start + si_pattern.len();
        let val_end = find_byte(f_tag, b'"', val_start)?;
        parse_u32(&f_tag[val_start..val_end])?
    };

    // Check if this is a master cell: has a `ref=` attribute (defines the range)
    // and has formula text (not self-closing)
    let gt_offset = find_byte(f_tag, b'>', 0)?;
    let is_self_closing = gt_offset > 0 && f_tag[gt_offset - 1] == b'/';

    if is_self_closing {
        // This is a reference cell (self-closing <f t="shared" si="N"/>)
        Some(SharedFormulaExtract {
            si: si_val,
            is_master: false,
            formula_text: None,
            ref_range: None,
        })
    } else {
        // This has formula text: <f t="shared" si="N" ref="...">formula_text</f>
        // Check for ref= attribute to confirm it's a master
        let ref_range = find_sequence(f_tag, b"ref=\"", 0).and_then(|ref_start| {
            let val_start = ref_start + b"ref=\"".len();
            let val_end = find_byte(f_tag, b'"', val_start)?;
            Some(&f_tag[val_start..val_end])
        });
        let has_ref = ref_range.is_some();
        if has_ref {
            // Extract formula text between > and </f>
            let content_start = f_start + gt_offset + 1;
            let content_end = find_sequence(xml, b"</f>", content_start)?;
            Some(SharedFormulaExtract {
                si: si_val,
                is_master: true,
                formula_text: Some(&xml[content_start..content_end]),
                ref_range,
            })
        } else {
            // Has t="shared" and si but no ref= - this is still a reference cell
            // that happens to repeat the formula text (rare but valid)
            None
        }
    }
}

/// Result of the fused single-pass formula extras extraction.
///
/// Replaces 7-9 sequential `find_sequence()` calls with a single forward scan
/// over the cell XML, extracting all formula-related extras at once.
#[derive(Debug, Default)]
pub struct FormulaExtras<'a> {
    // ── <f> element attributes ──
    /// `t="shared"` with associated shared-formula data
    pub shared: Option<SharedFormulaExtract<'a>>,
    /// `t="array"` detected
    pub is_array: bool,
    /// `t="dataTable"` detected
    pub is_data_table: bool,
    /// `ca="1"` on the <f> element
    pub ca: bool,
    /// `aca="1"` on the <f> element
    pub aca: bool,
    /// `bx="1"` on the <f> element
    pub bx: bool,
    /// `xml:space="preserve"` on the <f> element
    pub f_xml_space: bool,
    /// `ref="..."` attribute value from <f> (for array / dataTable)
    pub f_ref: Option<&'a [u8]>,
    /// `r1="..."` attribute value (data tables)
    pub r1: Option<&'a [u8]>,
    /// `r2="..."` attribute value (data tables)
    pub r2: Option<&'a [u8]>,
    /// `dt2D="1"` (data tables)
    pub dt2d: bool,
    /// `dtr="1"` (data tables)
    pub dtr: bool,
    /// `del1="1"` (data tables)
    pub del1: bool,
    /// `del2="1"` (data tables)
    pub del2: bool,
    /// Formula text between `<f ...>` and `</f>`, if present
    pub formula_text: Option<&'a [u8]>,

    // ── <v> element ──
    /// `<v/>` self-closing empty cached value
    pub v_self_closing: bool,
    /// Content between `<v...>` and `</v>`, if present
    pub v_content: Option<&'a [u8]>,
    /// `xml:space="preserve"` on the <v> element
    pub v_xml_space: bool,
}

/// Single-pass extraction of all formula extras from a cell XML fragment.
///
/// Scans the cell XML once, locating `<f` and `<v` elements and extracting
/// all attributes and content from each. This replaces the previous approach
/// of 7-9 separate `find_sequence()` calls.
pub fn extract_formula_extras_fused(xml: &[u8]) -> FormulaExtras<'_> {
    let mut result = FormulaExtras::default();
    let len = xml.len();
    let mut pos = 0;

    // ── Scan for <f element ──
    while pos < len {
        if xml[pos] == b'<' && pos + 1 < len && xml[pos + 1] == b'f' {
            // Check it's actually `<f ` or `<f>` or `<f/` (not `<fo...` etc.)
            if pos + 2 >= len
                || xml[pos + 2] == b' '
                || xml[pos + 2] == b'>'
                || xml[pos + 2] == b'/'
            {
                // Found <f element — extract everything from the tag
                let f_start = pos;

                // Find the end of the opening tag
                let mut tag_end = pos + 2;
                let mut is_self_closing_f = false;
                while tag_end < len {
                    if xml[tag_end] == b'>' {
                        is_self_closing_f = tag_end > 0 && xml[tag_end - 1] == b'/';
                        break;
                    }
                    tag_end += 1;
                }
                if tag_end >= len {
                    break;
                }

                let f_tag = &xml[f_start..=tag_end];

                // Parse attributes from the <f> tag in a single scan
                parse_f_tag_attrs(f_tag, &mut result);

                // Extract formula text if not self-closing
                if !is_self_closing_f {
                    let content_start = tag_end + 1;
                    if let Some(f_close) = find_sequence(xml, b"</f>", content_start) {
                        let text = &xml[content_start..f_close];
                        if !text.is_empty() {
                            result.formula_text = Some(text);
                        }
                        pos = f_close + 4;
                    } else {
                        pos = tag_end + 1;
                    }
                } else {
                    pos = tag_end + 1;
                }

                // Build SharedFormulaExtract if t="shared"
                if result.shared.is_some() {
                    // Already partially filled by parse_f_tag_attrs; finish it
                    // The formula_text and ref_range are set there.
                }

                // Now scan for <v element after the <f> element
                break;
            }
        }
        pos += 1;
    }

    // ── Scan for <v element ──
    while pos < len {
        if xml[pos] == b'<' && pos + 1 < len && xml[pos + 1] == b'v' {
            // Check it's actually `<v ` or `<v>` or `<v/` (not `<va...` etc.)
            if pos + 2 >= len
                || xml[pos + 2] == b' '
                || xml[pos + 2] == b'>'
                || xml[pos + 2] == b'/'
            {
                let v_start = pos;

                // Check for self-closing <v/>
                if pos + 3 < len
                    && xml[pos + 1] == b'v'
                    && xml[pos + 2] == b'/'
                    && xml[pos + 3] == b'>'
                {
                    result.v_self_closing = true;
                    break;
                }

                // Find end of opening tag
                let mut tag_end = pos + 2;
                while tag_end < len {
                    if xml[tag_end] == b'>' {
                        break;
                    }
                    tag_end += 1;
                }
                if tag_end >= len {
                    break;
                }

                // Check for xml:space in the <v> tag
                let v_tag = &xml[v_start..=tag_end];
                if v_tag.windows(9).any(|w| w == b"xml:space") {
                    result.v_xml_space = true;
                }

                // Extract content between <v...> and </v>
                let content_start = tag_end + 1;
                if let Some(v_close) = find_sequence(xml, b"</v>", content_start) {
                    result.v_content = Some(&xml[content_start..v_close]);
                }

                break;
            }
        }
        pos += 1;
    }

    result
}

/// Parse all attributes from the `<f ...>` tag bytes in a single scan.
fn parse_f_tag_attrs<'a>(f_tag: &'a [u8], result: &mut FormulaExtras<'a>) {
    let len = f_tag.len();
    let mut i = 0;

    // Track attribute positions for shared formula si/ref extraction
    let mut si_val: Option<u32> = None;
    let mut ref_val: Option<&'a [u8]> = None;
    let mut is_shared = false;
    let is_self_closing = len >= 2 && f_tag[len - 2] == b'/' && f_tag[len - 1] == b'>';

    while i < len {
        let b = f_tag[i];

        // Quick skip: most bytes are not attribute starts
        if b == b't' && i + 2 < len && f_tag[i + 1] == b'=' && f_tag[i + 2] == b'"' {
            // t="..." attribute
            let val_start = i + 3;
            if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                let val = &f_tag[val_start..val_end];
                if val == b"shared" {
                    is_shared = true;
                } else if val == b"array" {
                    result.is_array = true;
                } else if val == b"dataTable" {
                    result.is_data_table = true;
                }
                i = val_end + 1;
                continue;
            }
        } else if b == b'c'
            && i + 3 < len
            && f_tag[i + 1] == b'a'
            && f_tag[i + 2] == b'='
            && f_tag[i + 3] == b'"'
        {
            // ca="..." attribute
            if i + 5 < len && f_tag[i + 4] == b'1' && f_tag[i + 5] == b'"' {
                result.ca = true;
            }
            i += 4;
            // Skip past the closing quote
            while i < len && f_tag[i] != b'"' {
                i += 1;
            }
            i += 1;
            continue;
        } else if b == b'a'
            && i + 4 < len
            && f_tag[i + 1] == b'c'
            && f_tag[i + 2] == b'a'
            && f_tag[i + 3] == b'='
            && f_tag[i + 4] == b'"'
        {
            // aca="..." attribute
            if i + 6 < len && f_tag[i + 5] == b'1' && f_tag[i + 6] == b'"' {
                result.aca = true;
            }
            i += 5;
            while i < len && f_tag[i] != b'"' {
                i += 1;
            }
            i += 1;
            continue;
        } else if b == b'b'
            && i + 3 < len
            && f_tag[i + 1] == b'x'
            && f_tag[i + 2] == b'='
            && f_tag[i + 3] == b'"'
        {
            // bx="..." attribute
            if i + 5 < len && f_tag[i + 4] == b'1' && f_tag[i + 5] == b'"' {
                result.bx = true;
            }
            i += 4;
            while i < len && f_tag[i] != b'"' {
                i += 1;
            }
            i += 1;
            continue;
        } else if b == b's'
            && i + 3 < len
            && f_tag[i + 1] == b'i'
            && f_tag[i + 2] == b'='
            && f_tag[i + 3] == b'"'
        {
            // si="..." attribute
            let val_start = i + 4;
            if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                si_val = parse_u32(&f_tag[val_start..val_end]);
                i = val_end + 1;
                continue;
            }
        } else if b == b'r' && i + 1 < len {
            if f_tag[i + 1] == b'e'
                && i + 4 < len
                && f_tag[i + 2] == b'f'
                && f_tag[i + 3] == b'='
                && f_tag[i + 4] == b'"'
            {
                // ref="..." attribute
                let val_start = i + 5;
                if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                    ref_val = Some(&f_tag[val_start..val_end]);
                    result.f_ref = ref_val;
                    i = val_end + 1;
                    continue;
                }
            } else if f_tag[i + 1] == b'1'
                && i + 3 < len
                && f_tag[i + 2] == b'='
                && f_tag[i + 3] == b'"'
            {
                // r1="..."
                let val_start = i + 4;
                if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                    result.r1 = Some(&f_tag[val_start..val_end]);
                    i = val_end + 1;
                    continue;
                }
            } else if f_tag[i + 1] == b'2'
                && i + 3 < len
                && f_tag[i + 2] == b'='
                && f_tag[i + 3] == b'"'
            {
                // r2="..."
                let val_start = i + 4;
                if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                    result.r2 = Some(&f_tag[val_start..val_end]);
                    i = val_end + 1;
                    continue;
                }
            }
        } else if b == b'd' && i + 4 < len {
            if f_tag[i + 1] == b't'
                && f_tag[i + 2] == b'2'
                && f_tag[i + 3] == b'D'
                && f_tag[i + 4] == b'='
            {
                // dt2D="1"
                if i + 7 < len
                    && f_tag[i + 5] == b'"'
                    && f_tag[i + 6] == b'1'
                    && f_tag[i + 7] == b'"'
                {
                    result.dt2d = true;
                }
                i += 5;
            } else if f_tag[i + 1] == b't'
                && f_tag[i + 2] == b'r'
                && f_tag[i + 3] == b'='
                && f_tag[i + 4] == b'"'
            {
                // dtr="1"
                if i + 6 < len && f_tag[i + 5] == b'1' && f_tag[i + 6] == b'"' {
                    result.dtr = true;
                }
                i += 5;
            } else if f_tag[i + 1] == b'e' && f_tag[i + 2] == b'l' {
                if f_tag[i + 3] == b'1' && f_tag[i + 4] == b'=' {
                    // del1="1"
                    if i + 7 < len
                        && f_tag[i + 5] == b'"'
                        && f_tag[i + 6] == b'1'
                        && f_tag[i + 7] == b'"'
                    {
                        result.del1 = true;
                    }
                    i += 5;
                } else if f_tag[i + 3] == b'2' && f_tag[i + 4] == b'=' {
                    // del2="1"
                    if i + 7 < len
                        && f_tag[i + 5] == b'"'
                        && f_tag[i + 6] == b'1'
                        && f_tag[i + 7] == b'"'
                    {
                        result.del2 = true;
                    }
                    i += 5;
                }
            }
        } else if b == b'x' && i + 9 < len && &f_tag[i..i + 9] == b"xml:space" {
            // xml:space="preserve" on the <f> element
            result.f_xml_space = true;
            i += 9;
            continue;
        }

        i += 1;
    }

    // Build SharedFormulaExtract if t="shared"
    if is_shared {
        if let Some(si) = si_val {
            let has_ref = ref_val.is_some();
            if is_self_closing {
                // Reference cell: <f t="shared" si="N"/>
                result.shared = Some(SharedFormulaExtract {
                    si,
                    is_master: false,
                    formula_text: None,
                    ref_range: None,
                });
            } else if has_ref {
                // Master cell: formula_text will be filled by the caller
                // (the text between <f> and </f>)
                result.shared = Some(SharedFormulaExtract {
                    si,
                    is_master: true,
                    formula_text: None, // Caller sets this from result.formula_text
                    ref_range: ref_val,
                });
            }
            // else: has t="shared" and si but no ref= and not self-closing
            // — treat as non-shared (same as original extract_shared_formula_info)
        }
    }
}

/// Find a byte in a slice starting from `start` (simple linear scan, used
/// within small tag-sized slices where SIMD overhead isn't worthwhile).
#[inline]
fn find_byte_in(slice: &[u8], byte: u8, start: usize) -> Option<usize> {
    (start..slice.len()).find(|&i| slice[i] == byte)
}

/// Adjust A1 cell references in a formula string by row and column offsets.
///
/// This function scans a formula for A1-style cell references (e.g., `A1`, `$B$2`,
/// `AA100`) and adjusts them by the given row and column offsets, respecting
/// absolute reference markers (`$`).
///
/// # Rules
/// - `$` before column letters: column is absolute (not adjusted)
/// - `$` before row digits: row is absolute (not adjusted)
/// - References inside string literals (double-quoted) are not adjusted
/// - Sheet-qualified references like `Sheet1!A1` are handled (the A1 part is adjusted)
///
/// # Arguments
/// * `formula` - The formula text as a byte slice
/// * `row_offset` - Number of rows to shift (positive = down, negative = up)
/// * `col_offset` - Number of columns to shift (positive = right, negative = left)
///
/// # Returns
/// The adjusted formula as a String
pub fn adjust_formula_references(formula: &[u8], row_offset: i32, col_offset: i32) -> String {
    if row_offset == 0 && col_offset == 0 {
        return std::str::from_utf8(formula)
            .expect("worksheet formula XML text was validated as UTF-8 at the archive boundary")
            .to_owned();
    }

    let mut result = Vec::with_capacity(formula.len() + 16);
    let mut pos = 0;

    while pos < formula.len() {
        let b = formula[pos];

        // Skip string literals (double-quoted in formulas)
        if b == b'"' {
            result.push(b);
            pos += 1;
            while pos < formula.len() {
                result.push(formula[pos]);
                if formula[pos] == b'"' {
                    pos += 1;
                    break;
                }
                pos += 1;
            }
            continue;
        }

        // Skip single-quoted sheet names (e.g., 'Sheet 1'!A1)
        if b == b'\'' {
            result.push(b);
            pos += 1;
            while pos < formula.len() {
                result.push(formula[pos]);
                if formula[pos] == b'\'' {
                    pos += 1;
                    break;
                }
                pos += 1;
            }
            continue;
        }

        // Check if we're at the start of a potential cell reference
        // A cell reference is: optional $ + column letters + optional $ + row digits
        // It must NOT be preceded by an alphanumeric character (to avoid matching
        // function names like SUM, IF, etc.)
        let is_ref_start = (b == b'$' || b.is_ascii_uppercase())
            && (pos == 0 || !formula[pos - 1].is_ascii_alphanumeric() && formula[pos - 1] != b'_');

        if is_ref_start {
            if let Some((ref_len, adjusted)) =
                try_adjust_reference(&formula[pos..], row_offset, col_offset)
            {
                result.extend_from_slice(adjusted.as_bytes());
                pos += ref_len;
                continue;
            }
        }

        result.push(b);
        pos += 1;
    }

    std::str::from_utf8(&result)
        .expect("adjusted worksheet formula remains valid UTF-8")
        .to_owned()
}

/// Try to parse and adjust a single A1 reference at the start of `input`.
///
/// Returns `Some((bytes_consumed, adjusted_string))` if a valid reference was found,
/// or `None` if the input doesn't start with a valid A1 reference.
fn try_adjust_reference(input: &[u8], row_offset: i32, col_offset: i32) -> Option<(usize, String)> {
    let mut pos = 0;

    // Check for $ before column
    let col_absolute = if pos < input.len() && input[pos] == b'$' {
        pos += 1;
        true
    } else {
        false
    };

    // Parse column letters (must have at least one)
    let col_start = pos;
    let mut col_val: u32 = 0;
    while pos < input.len() && input[pos].is_ascii_uppercase() {
        col_val = col_val
            .saturating_mul(26)
            .saturating_add((input[pos] - b'A' + 1) as u32);
        pos += 1;
    }

    if pos == col_start || col_val == 0 {
        return None; // No column letters found
    }
    let col_0indexed = col_val - 1; // Convert to 0-indexed

    // Check for $ before row
    let row_absolute = if pos < input.len() && input[pos] == b'$' {
        pos += 1;
        true
    } else {
        false
    };

    // Parse row digits (must have at least one)
    let row_start = pos;
    let mut row_val: u32 = 0;
    while pos < input.len() && input[pos].is_ascii_digit() {
        row_val = row_val
            .saturating_mul(10)
            .saturating_add((input[pos] - b'0') as u32);
        pos += 1;
    }

    if pos == row_start || row_val == 0 {
        return None; // No row digits found
    }
    let row_0indexed = row_val - 1; // Convert to 0-indexed (A1 references are 1-based for rows)

    // Make sure the character after the reference is not alphanumeric
    // (to avoid partial matches like "A1B" being treated as ref "A1" + "B")
    if pos < input.len() && (input[pos].is_ascii_alphanumeric() || input[pos] == b'_') {
        return None;
    }

    // Apply offsets
    let new_col = if col_absolute {
        col_0indexed
    } else {
        let adjusted = col_0indexed as i32 + col_offset;
        if adjusted < 0 || adjusted > 16383 {
            return None; // Out of range, leave reference unchanged
        }
        adjusted as u32
    };

    let new_row = if row_absolute {
        row_0indexed
    } else {
        let adjusted = row_0indexed as i32 + row_offset;
        if adjusted < 0 || adjusted > 1048575 {
            return None; // Out of range, leave reference unchanged
        }
        adjusted as u32
    };

    // Build the adjusted reference string
    let mut adjusted = String::with_capacity(10);

    if col_absolute {
        adjusted.push('$');
    }

    // Convert column back to letters
    let col_letters = col_to_letters(new_col);
    for &letter in &col_letters {
        if letter != 0 {
            adjusted.push(letter as char);
        }
    }

    if row_absolute {
        adjusted.push('$');
    }

    // Row is 1-based in A1 notation
    let row_1based = new_row + 1;
    let mut row_buf = [0u8; 10]; // Max 10 digits for u32
    let row_str = format_u32(row_1based, &mut row_buf);
    adjusted.push_str(row_str);

    Some((pos, adjusted))
}

/// Format a u32 into a byte buffer, returning a &str slice.
/// This avoids allocation compared to format!("{}", n).
fn format_u32(mut n: u32, buf: &mut [u8; 10]) -> &str {
    if n == 0 {
        buf[0] = b'0';
        return core::str::from_utf8(&buf[..1]).expect("format_u32 writes ASCII decimal digits");
    }

    let mut pos = buf.len();
    while n > 0 {
        pos -= 1;
        buf[pos] = b'0' + (n % 10) as u8;
        n /= 10;
    }

    core::str::from_utf8(&buf[pos..]).expect("format_u32 writes ASCII decimal digits")
}

#[cfg(test)]
mod safety_tests {
    use super::format_u32;

    #[test]
    fn format_u32_uses_safe_decimal_utf8_conversion() {
        let cases = [
            (0, "0"),
            (1, "1"),
            (42, "42"),
            (1_048_576, "1048576"),
            (u32::MAX, "4294967295"),
        ];

        for (value, expected) in cases {
            let mut buf = [0u8; 10];
            assert_eq!(format_u32(value, &mut buf), expected);
        }
    }
}
