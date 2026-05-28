use crate::domain::cells::{
    CELL_TYPE_BOOL, CELL_TYPE_ERROR, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING,
};
use crate::domain::cells::{
    CellData, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE, VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};
use crate::infra::scanner::{find_gt_simd, find_lt_simd};

/// Check if the tag at the given position matches the expected tag name.
#[inline]
pub(super) fn matches_tag(data: &[u8], pos: usize, tag: &[u8]) -> bool {
    if pos + tag.len() > data.len() {
        return false;
    }
    let slice = &data[pos..pos + tag.len()];
    if slice != tag {
        return false;
    }
    // Verify tag ends with delimiter
    if pos + tag.len() < data.len() {
        let next = data[pos + tag.len()];
        matches!(next, b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r')
    } else {
        true
    }
}

/// Parse row number from a row element.
pub(super) fn parse_row_number(row_xml: &[u8]) -> Option<u32> {
    // Look for r="N" pattern
    let r_attr = b"r=\"";
    let mut pos = 0;
    while pos + r_attr.len() + 1 < row_xml.len() {
        if &row_xml[pos..pos + r_attr.len()] == r_attr {
            pos += r_attr.len();
            let mut num: u32 = 0;
            while pos < row_xml.len() && row_xml[pos].is_ascii_digit() {
                num = num
                    .saturating_mul(10)
                    .saturating_add((row_xml[pos] - b'0') as u32);
                pos += 1;
            }
            if num > 0 {
                return Some(num);
            }
        }
        pos += 1;
    }
    None
}

/// Find the end of a cell element (handles both self-closing and paired tags).
///
/// For `<c r="A1"/>` returns position after `/>`.
/// For `<c r="A1"><v>42</v></c>` returns position after `</c>`.
pub(super) fn find_cell_end(data: &[u8], start: usize) -> Option<usize> {
    // First, find the end of the opening tag
    let gt_pos = find_gt_simd(data, start)?;

    // Check if it's self-closing
    if gt_pos > 0 && data[gt_pos - 1] == b'/' {
        return Some(gt_pos + 1);
    }

    // Not self-closing - look for </c>
    let mut pos = gt_pos + 1;
    let mut depth = 1; // We're inside the <c> element

    while pos < data.len() {
        if let Some(lt_pos) = find_lt_simd(data, pos) {
            let tag_start = lt_pos + 1;
            if tag_start >= data.len() {
                return None; // Incomplete
            }

            // Find end of this tag
            let inner_gt = find_gt_simd(data, lt_pos)?;

            if data[tag_start] == b'/' {
                // Closing tag
                depth -= 1;
                if depth == 0 {
                    // Check if this is </c>
                    if tag_start + 1 < data.len() && data[tag_start + 1] == b'c' {
                        let after_c = tag_start + 2;
                        if after_c >= data.len() || matches!(data[after_c], b'>' | b' ') {
                            return Some(inner_gt + 1);
                        }
                    }
                    // Even if not </c>, we're done at depth 0
                    return Some(inner_gt + 1);
                }
            } else if data[tag_start] != b'?' && data[tag_start] != b'!' {
                // Opening tag (not processing instruction or comment)
                // Check if it's self-closing
                if inner_gt > 0 && data[inner_gt - 1] == b'/' {
                    // Self-closing, don't increase depth
                } else {
                    depth += 1;
                }
            }

            pos = inner_gt + 1;
        } else {
            return None;
        }
    }

    None
}

/// Parse a single cell element and return CellData.
pub(super) fn parse_cell_element(
    xml: &[u8],
    fallback_row: u32,
    shared_strings: &[&str],
    strings: &mut Vec<u8>,
) -> Option<CellData> {
    // Parse cell reference
    let (row, col) = parse_cell_ref(xml).unwrap_or((fallback_row, 0));

    // Parse cell type
    let cell_type = parse_cell_type(xml);

    // Parse style index
    let style_idx = parse_style_idx(xml);

    // Extract value
    let (value_type, value_bytes) = extract_cell_value(xml, shared_strings);

    // Skip empty cells
    if value_type == VALUE_TYPE_NONE {
        return None;
    }

    let value_offset = strings.len() as u32;
    let value_len = value_bytes.len() as u32;
    strings.extend_from_slice(value_bytes);

    Some(CellData {
        row,
        col,
        cell_type,
        style_idx,
        value_type,
        value_offset,
        value_len,
    })
}

/// Parse cell reference from r attribute.
fn parse_cell_ref(xml: &[u8]) -> Option<(u32, u32)> {
    // Find r="..." attribute
    let r_attr = b"r=\"";
    let mut pos = 0;
    while pos + r_attr.len() < xml.len() {
        if &xml[pos..pos + r_attr.len()] == r_attr {
            let start = pos + r_attr.len();
            let mut end = start;
            while end < xml.len() && xml[end] != b'"' {
                end += 1;
            }
            if end > start {
                return parse_a1_reference(&xml[start..end]);
            }
        }
        pos += 1;
    }
    None
}

/// Parse A1 reference to (row, col) tuple.
fn parse_a1_reference(reference: &[u8]) -> Option<(u32, u32)> {
    if reference.is_empty() {
        return None;
    }

    let mut pos = 0;
    let mut col: u32 = 0;

    // Parse column letters
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

    // Parse row number
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

    // Validate ranges
    if col > 16383 || row > 1048575 {
        return None;
    }

    Some((row, col))
}

/// Parse cell type from t attribute.
fn parse_cell_type(xml: &[u8]) -> u8 {
    let t_attr = b"t=\"";
    let mut pos = 0;
    while pos + t_attr.len() + 1 < xml.len() {
        if &xml[pos..pos + t_attr.len()] == t_attr {
            let type_char = xml[pos + t_attr.len()];
            return match type_char {
                b'n' => CELL_TYPE_NUMBER,
                b's' => {
                    // Distinguish t="s" (shared string) from t="str" (formula string result)
                    if pos + t_attr.len() + 2 < xml.len() && xml[pos + t_attr.len() + 1] == b't' {
                        CELL_TYPE_FORMULA_STRING
                    } else {
                        CELL_TYPE_STRING
                    }
                }
                b'i' => CELL_TYPE_STRING, // inlineStr
                b'b' => CELL_TYPE_BOOL,
                b'e' => CELL_TYPE_ERROR,
                _ => CELL_TYPE_NUMBER,
            };
        }
        pos += 1;
    }
    CELL_TYPE_NUMBER
}

/// Parse style index from s attribute.
fn parse_style_idx(xml: &[u8]) -> u16 {
    // Look for s="N" pattern with space before
    let s_attr = b" s=\"";
    let mut pos = 0;
    while pos + s_attr.len() + 1 < xml.len() {
        if &xml[pos..pos + s_attr.len()] == s_attr {
            pos += s_attr.len();
            let mut idx: u16 = 0;
            while pos < xml.len() && xml[pos].is_ascii_digit() {
                idx = idx
                    .saturating_mul(10)
                    .saturating_add((xml[pos] - b'0') as u16);
                pos += 1;
            }
            return idx;
        }
        pos += 1;
    }
    0
}

/// Extract cell value from XML.
fn extract_cell_value<'a>(xml: &'a [u8], shared_strings: &'a [&'a str]) -> (u8, &'a [u8]) {
    // Check for formula <f>
    if let Some(f_start) = find_sequence(xml, b"<f>") {
        let content_start = f_start + 3;
        if let Some(f_end) = find_sequence(&xml[content_start..], b"</f>") {
            return (
                VALUE_TYPE_FORMULA,
                &xml[content_start..content_start + f_end],
            );
        }
    }

    // Check for value <v>
    if let Some(v_start) = find_sequence(xml, b"<v>") {
        let content_start = v_start + 3;
        if let Some(v_end) = find_sequence(&xml[content_start..], b"</v>") {
            let value_bytes = &xml[content_start..content_start + v_end];

            // Check if this is a shared string reference
            let cell_type = parse_cell_type(xml);
            if cell_type == CELL_TYPE_STRING {
                // Parse the shared string index
                if let Some(idx) = parse_u32(value_bytes) {
                    if let Some(shared_str) = shared_strings.get(idx as usize) {
                        return (VALUE_TYPE_SHARED_STRING, shared_str.as_bytes());
                    }
                }
            }

            return (VALUE_TYPE_INLINE, value_bytes);
        }
    }

    // Check for inline string <is><t>
    if let Some(is_start) = find_sequence(xml, b"<is>") {
        if let Some(t_start) = find_sequence(&xml[is_start..], b"<t>") {
            let content_start = is_start + t_start + 3;
            if let Some(t_end) = find_sequence(&xml[content_start..], b"</t>") {
                return (
                    VALUE_TYPE_INLINE,
                    &xml[content_start..content_start + t_end],
                );
            }
        }
    }

    // Check for self-closing value <v/>
    if find_sequence(xml, b"<v/>").is_some() {
        return (VALUE_TYPE_INLINE, b"");
    }

    (VALUE_TYPE_NONE, b"")
}

/// Find a byte sequence in the slice.
#[inline]
fn find_sequence(data: &[u8], seq: &[u8]) -> Option<usize> {
    if seq.is_empty() || data.len() < seq.len() {
        return None;
    }
    data.windows(seq.len()).position(|w| w == seq)
}

/// Parse a u32 from ASCII digits.
#[inline]
fn parse_u32(bytes: &[u8]) -> Option<u32> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_tag() {
        assert!(matches_tag(b"<row r=\"1\">", 1, b"row"));
        assert!(matches_tag(b"<sheetData>", 1, b"sheetData"));
        assert!(!matches_tag(b"<row>", 1, b"rows"));
        assert!(!matches_tag(b"<row>", 1, b"ro"));
    }

    #[test]
    fn test_parse_row_number() {
        assert_eq!(parse_row_number(b"<row r=\"1\">"), Some(1));
        assert_eq!(parse_row_number(b"<row r=\"100\">"), Some(100));
        assert_eq!(parse_row_number(b"<row>"), None);
        assert_eq!(parse_row_number(b"<row r=\"\">"), None);
    }

    #[test]
    fn test_parse_a1_reference() {
        assert_eq!(parse_a1_reference(b"A1"), Some((0, 0)));
        assert_eq!(parse_a1_reference(b"B2"), Some((1, 1)));
        assert_eq!(parse_a1_reference(b"AA10"), Some((9, 26)));
        assert_eq!(parse_a1_reference(b"XFD1"), Some((0, 16383)));
        assert_eq!(parse_a1_reference(b""), None);
        assert_eq!(parse_a1_reference(b"A0"), None);
    }

    #[test]
    fn test_parse_cell_type() {
        assert_eq!(parse_cell_type(b"<c r=\"A1\">"), CELL_TYPE_NUMBER);
        assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"n\">"), CELL_TYPE_NUMBER);
        assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"s\">"), CELL_TYPE_STRING);
        assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"b\">"), CELL_TYPE_BOOL);
        assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"e\">"), CELL_TYPE_ERROR);
    }

    #[test]
    fn test_parse_style_idx() {
        assert_eq!(parse_style_idx(b"<c r=\"A1\">"), 0);
        assert_eq!(parse_style_idx(b"<c r=\"A1\" s=\"1\">"), 1);
        assert_eq!(parse_style_idx(b"<c r=\"A1\" s=\"42\">"), 42);
    }

    #[test]
    fn test_extract_cell_value_number() {
        let strings: Vec<&str> = vec![];
        let (vtype, value) = extract_cell_value(b"<c r=\"A1\"><v>42.5</v></c>", &strings);
        assert_eq!(vtype, VALUE_TYPE_INLINE);
        assert_eq!(value, b"42.5");
    }

    #[test]
    fn test_extract_cell_value_shared_string() {
        let strings: Vec<&str> = vec!["Hello, World!"];
        let (vtype, value) = extract_cell_value(b"<c r=\"A1\" t=\"s\"><v>0</v></c>", &strings);
        assert_eq!(vtype, VALUE_TYPE_SHARED_STRING);
        assert_eq!(value, b"Hello, World!");
    }

    #[test]
    fn test_extract_cell_value_formula() {
        let strings: Vec<&str> = vec![];
        let (vtype, value) =
            extract_cell_value(b"<c r=\"A1\"><f>A1+B1</f><v>100</v></c>", &strings);
        assert_eq!(vtype, VALUE_TYPE_FORMULA);
        assert_eq!(value, b"A1+B1");
    }

    #[test]
    fn test_extract_cell_value_inline_string() {
        let strings: Vec<&str> = vec![];
        let (vtype, value) = extract_cell_value(
            b"<c r=\"A1\" t=\"inlineStr\"><is><t>Test</t></is></c>",
            &strings,
        );
        assert_eq!(vtype, VALUE_TYPE_INLINE);
        assert_eq!(value, b"Test");
    }

    #[test]
    fn test_extract_cell_value_empty() {
        let strings: Vec<&str> = vec![];
        let (vtype, _) = extract_cell_value(b"<c r=\"A1\"/>", &strings);
        assert_eq!(vtype, VALUE_TYPE_NONE);
    }

    #[test]
    fn test_find_sequence() {
        assert_eq!(find_sequence(b"hello world", b"world"), Some(6));
        assert_eq!(find_sequence(b"hello", b"world"), None);
        assert_eq!(find_sequence(b"hello", b""), None);
        assert_eq!(find_sequence(b"", b"hello"), None);
    }

    #[test]
    fn test_parse_u32() {
        assert_eq!(parse_u32(b"123"), Some(123));
        assert_eq!(parse_u32(b"0"), Some(0));
        assert_eq!(parse_u32(b"42abc"), Some(42));
        assert_eq!(parse_u32(b""), None);
    }

    #[test]
    fn test_find_cell_end_self_closing() {
        let xml = b"<c r=\"A1\"/>";
        let end = find_cell_end(xml, 0);
        assert_eq!(end, Some(11));
    }

    #[test]
    fn test_find_cell_end_with_value() {
        let xml = b"<c r=\"A1\"><v>42</v></c>";
        let end = find_cell_end(xml, 0);
        assert_eq!(end, Some(23));
    }

    #[test]
    fn test_find_cell_end_nested() {
        let xml = b"<c r=\"A1\"><f>SUM(A1:A10)</f><v>100</v></c>";
        let end = find_cell_end(xml, 0);
        assert_eq!(end, Some(42));
    }
}
