use super::super::adapters::{find_byte, find_sequence};
use super::super::types::{
    CELL_TYPE_BOOL, CELL_TYPE_DATE, CELL_TYPE_ERROR, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER,
    CELL_TYPE_STRING,
};
use super::a1::parse_a1_reference;

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
                b'd' => CELL_TYPE_DATE,
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
