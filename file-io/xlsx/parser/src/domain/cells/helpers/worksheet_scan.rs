use super::super::adapters::{find_byte, find_sequence};

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
