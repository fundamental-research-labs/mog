/// Parse an A1-style range reference like "A1:D20" into (start_row, start_col, end_row, end_col).
/// Returns 0-based indices.
pub(super) fn parse_range_ref(range_ref: &str) -> Option<(u32, u32, u32, u32)> {
    let parts: Vec<&str> = range_ref.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let (r1, c1) = parse_cell_ref(parts[0])?;
    let (r2, c2) = parse_cell_ref(parts[1])?;
    Some((r1, c1, r2, c2))
}

/// Parse a cell reference like "A1" or "D20" into (row, col) 0-based.
pub(super) fn parse_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let cell_ref = cell_ref.replace('$', ""); // strip absolute markers
    let mut col_str = String::new();
    let mut row_str = String::new();
    for ch in cell_ref.chars() {
        if ch.is_ascii_alphabetic() {
            col_str.push(ch);
        } else if ch.is_ascii_digit() {
            row_str.push(ch);
        }
    }
    if col_str.is_empty() || row_str.is_empty() {
        return None;
    }
    let col = col_letters_to_index(&col_str)?;
    let row = row_str.parse::<u32>().ok()?.checked_sub(1)?; // 1-based to 0-based
    Some((row, col))
}

/// Convert column letters (A, B, ..., Z, AA, AB, ...) to 0-based index.
pub(super) fn col_letters_to_index(letters: &str) -> Option<u32> {
    let mut result: u32 = 0;
    for ch in letters.to_uppercase().chars() {
        let digit = (ch as u32).checked_sub('A' as u32)? + 1;
        result = result.checked_mul(26)?.checked_add(digit)?;
    }
    result.checked_sub(1)
}

/// Convert a 0-based column index to column letters (0 -> "A", 25 -> "Z", 26 -> "AA").
pub(super) fn col_index_to_letters(mut col: u32) -> String {
    let mut result = String::new();
    loop {
        result.insert(0, (b'A' + (col % 26) as u8) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    result
}

/// Build an A1-style range ref from (start_row, start_col, end_row, end_col) 0-based.
pub(super) fn build_range_ref(
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> String {
    format!(
        "{}{}:{}{}",
        col_index_to_letters(start_col),
        start_row + 1,
        col_index_to_letters(end_col),
        end_row + 1,
    )
}
