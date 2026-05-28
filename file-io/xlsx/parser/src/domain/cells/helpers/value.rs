use super::super::adapters::{find_byte, find_sequence};
use super::super::types::{
    CELL_TYPE_STRING, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE,
    VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};
use super::bytes::parse_u32;
use super::cell_attrs::parse_cell_type;
use crate::domain::strings::read::decode_xml_entities_full;

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

/// Extract formula value, scanning forward from the `<f` position.
///
/// Handles `<f>formula</f>`, `<f ...>formula</f>`, and `<f .../>` (self-closing
/// shared formula reference with cached `<v>` value).
#[inline]
pub(super) fn extract_formula_forward<'a>(
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

pub(super) fn extract_inline_string_owned_forward(xml: &[u8], is_lt: usize) -> Option<Vec<u8>> {
    let is_tag_end = find_byte(xml, b'>', is_lt)?;
    let is_end = find_sequence(xml, b"</is>", is_tag_end + 1)?;
    let mut pos = is_tag_end + 1;
    let mut out = Vec::new();

    while let Some(t_lt) = find_sequence(xml, b"<t", pos) {
        if t_lt >= is_end {
            break;
        }
        let after_t = t_lt + 2;
        let content_start = if after_t < xml.len() && xml[after_t] == b'>' {
            after_t + 1
        } else {
            find_byte(xml, b'>', after_t)? + 1
        };
        if content_start > is_end {
            break;
        }
        let t_end = match find_sequence(xml, b"</t>", content_start) {
            Some(end) if end <= is_end => end,
            _ => break,
        };
        decode_xml_entities_full(&xml[content_start..t_end], &mut out);
        pos = t_end + b"</t>".len();
    }

    if out.is_empty() { None } else { Some(out) }
}
