#![allow(clippy::string_slice)]

/// Convert column index (0-based) to Excel column letters.
pub(super) fn col_to_letters(col: u32) -> String {
    let mut s = String::new();
    let mut c = col;
    loop {
        s.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    s
}

/// Parse a range reference like "A1:D100" or "$A$1:$D$100" into (start_row, start_col, end_row, end_col).
/// Returns 0-based row/col indices.
pub(super) fn parse_range(range_ref: &str) -> Option<(u32, u32, u32, u32)> {
    let range = range_ref.replace('$', "");
    let parts: Vec<&str> = range.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let (start_col, start_row) = parse_cell_ref(parts[0])?;
    let (end_col, end_row) = parse_cell_ref(parts[1])?;
    Some((start_row, start_col, end_row, end_col))
}

/// Parse a cell reference like "A1" into (col_0based, row_0based).
pub(super) fn parse_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let bytes = cell_ref.as_bytes();
    let mut col: u32 = 0;
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        col = col * 26 + (bytes[i].to_ascii_uppercase() - b'A') as u32 + 1;
        i += 1;
    }
    if col == 0 || i >= bytes.len() {
        return None;
    }
    let row: u32 = cell_ref[i..].parse().ok()?;
    Some((col - 1, row - 1))
}
