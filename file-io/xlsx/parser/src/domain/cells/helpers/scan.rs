use super::super::adapters::find_byte;
use super::super::types::{
    AuthoredStyleOnlyCell, CELL_TYPE_BOOL, CELL_TYPE_DATE, CELL_TYPE_ERROR,
    CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING, CellData, VALUE_TYPE_INLINE,
    VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};
use super::a1::parse_a1_reference;
use super::bytes::parse_u32;
use super::tags::{closing_tag_at, find_closing_tag_span, start_tag_at};
use super::value::{extract_formula_forward, extract_inline_string_owned_forward};

pub(crate) struct ScanResult {
    /// The parsed cell data, or None if the cell was skipped (redundant style).
    pub cell: Option<CellData>,
    /// Position in the XML after this cell element ends (past `/>` or `</c>`).
    pub end: usize,
    /// True if the element was self-closing (`<c ... />`).
    pub is_self_closing: bool,
    // --- Extras extracted during the scan (avoids re-scanning) ---
    /// Effective `cm="N"` attribute value on `<c>` tag (cell metadata index).
    pub cm_val: Option<u32>,
    /// `vm="N"` attribute value on `<c>` tag (value metadata index).
    pub vm_val: Option<u32>,
    /// `ph="1"` phonetic display flag on `<c>` tag.
    pub has_ph: bool,
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
    let cell_tag = start_tag_at(xml, cell_start, b"c")?;
    let mut pos = cell_tag.name_end; // Skip past the qualified cell tag name.

    // --- Step 1: scan opening tag for r/s/t attributes + extras (cm, vm, s) ---
    let mut row = fallback_row;
    let mut col = 0u32;
    let mut style_idx: u16 = 0;
    let mut cell_type: u8 = CELL_TYPE_NUMBER;
    let mut cm_val: Option<u32> = None;
    let mut vm_val: Option<u32> = None;
    let mut has_ph = false;
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

            if has_explicit_s && cm_val.is_none() && vm_val.is_none() && !has_ph && !has_explicit_t
            {
                return Some(ScanResult {
                    cell: None,
                    end,
                    is_self_closing: true,
                    cm_val,
                    vm_val,
                    has_ph,
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
                cm_val,
                vm_val,
                has_ph,
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
                            b'd' => CELL_TYPE_DATE,
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
                            cm_val = parse_u32(&xml[val_start..val_end]);
                        } else if a == b'v' && b2 == b'm' {
                            vm_val = parse_u32(&xml[val_start..val_end]);
                        } else if a == b'p' && b2 == b'h' {
                            has_ph = matches!(&xml[val_start..val_end], b"1" | b"true");
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
    let mut owned_value: Option<Vec<u8>> = None;
    let (value_type, value_bytes): (u8, &[u8]) = if let Some(first_lt) = first_lt_opt {
        let next = first_lt + 1;
        if next < len {
            if start_tag_at(xml, first_lt, b"f").is_some() {
                extract_formula_forward(xml, first_lt, cell_type, shared_strings)
            } else if let Some(v_tag) = start_tag_at(xml, first_lt, b"v") {
                // Inline <v> extraction to also capture xml_space and sst_raw_idx
                let tag_bytes = &xml[first_lt..=v_tag.tag_end];
                if tag_bytes.windows(9).any(|w| w == b"xml:space") {
                    has_xml_space_v = true;
                }
                if v_tag.is_self_closing {
                    scan_end = v_tag.content_start;
                    (VALUE_TYPE_INLINE, b"" as &[u8])
                } else if let Some(v_close) = find_closing_tag_span(xml, b"v", v_tag.content_start)
                {
                    scan_end = v_close.end;
                    let value_bytes = &xml[v_tag.content_start..v_close.lt];
                    if cell_type == CELL_TYPE_STRING {
                        let raw_idx = parse_u32(value_bytes);
                        sst_raw_idx = raw_idx;
                        if let Some(idx) = raw_idx {
                            if let Some(shared_str) = shared_strings.get(idx as usize) {
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
            } else if start_tag_at(xml, first_lt, b"is").is_some() {
                match extract_inline_string_owned_forward(xml, first_lt) {
                    Some(value) => {
                        let value_bytes = owned_value.insert(value).as_slice();
                        (VALUE_TYPE_INLINE, value_bytes)
                    }
                    None => (VALUE_TYPE_NONE, b""),
                }
            } else {
                (VALUE_TYPE_NONE, b"" as &[u8])
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
            if let Some(close) = closing_tag_at(xml, p, b"c") {
                break 'find_end close.end;
            }
        }
        // Fallback: SIMD search for unusual cell structures or formula cells
        match find_closing_tag_span(xml, b"c", body_start) {
            Some(close) => close.end,
            None => return None,
        }
    };

    let make_result = |cell| ScanResult {
        cell,
        end: cell_end,
        is_self_closing: false,
        cm_val,
        vm_val,
        has_ph,
        has_explicit_s,
        has_xml_space_v,
        sst_raw_idx,
        authored_style_only: None,
    };

    if value_type == VALUE_TYPE_NONE
        && has_explicit_s
        && cm_val.is_none()
        && vm_val.is_none()
        && !has_ph
        && !has_explicit_t
    {
        return Some(ScanResult {
            cell: None,
            end: cell_end,
            is_self_closing: false,
            cm_val,
            vm_val,
            has_ph,
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
