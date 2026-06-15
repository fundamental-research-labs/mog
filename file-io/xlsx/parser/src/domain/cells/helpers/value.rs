use super::super::types::{
    CELL_TYPE_STRING, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE,
    VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};
use super::bytes::parse_u32;
use super::cell_attrs::parse_cell_type;
use super::tags::{find_closing_tag_span, find_start_tag, start_tag_at};
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
    // Check for formula element (<f> or <prefix:f>).
    if let Some(f_tag) = find_start_tag(xml, b"f", 0) {
        return extract_formula_forward(xml, f_tag.lt, parse_cell_type(xml), shared_strings);
    }

    // Check for value (<v>) — handles both <v>text</v> and <v xml:space="preserve">text</v>
    if let Some(v_tag) = find_start_tag(xml, b"v", 0) {
        return extract_v_forward(
            xml,
            v_tag.lt,
            parse_cell_type(xml),
            shared_strings,
            VALUE_TYPE_INLINE,
        );
    }

    // Check for inline string (<is><t>)
    if let Some(value) = extract_inline_string_slice(xml) {
        return (VALUE_TYPE_INLINE, value);
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
    let Some(f_tag) = start_tag_at(xml, f_lt, b"f") else {
        return (VALUE_TYPE_NONE, b"");
    };

    if f_tag.is_self_closing {
        // Self-closing <f .../> — shared formula reference
        // Extract the cached <v> value that follows
        match find_start_tag(xml, b"v", f_tag.content_start) {
            Some(v_tag) => extract_v_forward(
                xml,
                v_tag.lt,
                cell_type,
                shared_strings,
                VALUE_TYPE_CACHED_FORMULA,
            ),
            _ => (VALUE_TYPE_CACHED_FORMULA, b""),
        }
    } else {
        if let Some(f_close) = find_closing_tag_span(xml, b"f", f_tag.content_start) {
            return (VALUE_TYPE_FORMULA, &xml[f_tag.content_start..f_close.lt]);
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
    let Some(v_tag) = start_tag_at(xml, v_lt, b"v") else {
        return (VALUE_TYPE_NONE, b"");
    };
    if v_tag.is_self_closing {
        return (success_type, b"");
    }

    if let Some(v_close) = find_closing_tag_span(xml, b"v", v_tag.content_start) {
        let value_bytes = &xml[v_tag.content_start..v_close.lt];

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
    let is_tag = start_tag_at(xml, is_lt, b"is")?;
    if is_tag.is_self_closing {
        return None;
    }
    let is_close = find_closing_tag_span(xml, b"is", is_tag.content_start)?;
    let is_end = is_close.lt;
    let mut pos = is_tag.content_start;
    let mut out = Vec::new();

    while let Some(t_tag) = find_start_tag(xml, b"t", pos) {
        if t_tag.lt >= is_end {
            break;
        }
        if t_tag.is_self_closing {
            pos = t_tag.content_start;
            continue;
        }
        if t_tag.content_start > is_end {
            break;
        }
        let t_close = match find_closing_tag_span(xml, b"t", t_tag.content_start) {
            Some(close) if close.lt <= is_end => close,
            _ => break,
        };
        decode_xml_entities_full(&xml[t_tag.content_start..t_close.lt], &mut out);
        pos = t_close.end;
    }

    if out.is_empty() { None } else { Some(out) }
}

fn extract_inline_string_slice(xml: &[u8]) -> Option<&[u8]> {
    let is_tag = find_start_tag(xml, b"is", 0)?;
    if is_tag.is_self_closing {
        return None;
    }
    let is_close = find_closing_tag_span(xml, b"is", is_tag.content_start)?;
    let t_tag = find_start_tag(xml, b"t", is_tag.content_start)?;
    if t_tag.lt >= is_close.lt || t_tag.is_self_closing {
        return None;
    }
    let t_close = find_closing_tag_span(xml, b"t", t_tag.content_start)?;
    if t_close.lt > is_close.lt {
        return None;
    }
    Some(&xml[t_tag.content_start..t_close.lt])
}
