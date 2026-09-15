use super::super::adapters::{find_byte, find_sequence};

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
