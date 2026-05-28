use super::schema_types::IdentityRangeSchemaRef;

pub(super) fn parse_row_col_pos(id: &str) -> Option<(u32, u32)> {
    let (r_str, c_str) = id.split_once(':')?;
    Some((r_str.parse::<u32>().ok()?, c_str.parse::<u32>().ok()?))
}

/// Convert an [`IdentityRangeSchemaRef`] (with `row:col` positional ids) to an
/// A1-style range string (e.g. `"A1:B10"` or `"A1"` for a single cell).
pub(super) fn identity_range_to_a1(rr: &IdentityRangeSchemaRef) -> Option<String> {
    let (sr, sc) = parse_row_col_pos(&rr.start_id)?;
    let (er, ec) = parse_row_col_pos(&rr.end_id)?;
    let start = pos_to_a1(sr, sc);
    let end = pos_to_a1(er, ec);
    if start == end {
        Some(start)
    } else {
        Some(format!("{start}:{end}"))
    }
}

/// Convert 0-based (row, col) to an A1-style cell reference (e.g. `"A1"`).
pub(super) fn pos_to_a1(row: u32, col: u32) -> String {
    let mut c = col + 1;
    let mut letters = Vec::new();
    while c > 0 {
        let rem = ((c - 1) % 26) as u8;
        letters.push((b'A' + rem) as char);
        c = (c - 1) / 26;
    }
    let col_str: String = letters.into_iter().rev().collect();
    format!("{}{}", col_str, row + 1)
}

pub(super) fn parse_a1_cell(s: &str) -> Option<(u32, u32)> {
    let s = s.trim_start_matches('$');
    let mut col: u32 = 0;
    let mut i = 0;
    let bytes = s.as_bytes();

    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        col = col * 26 + (bytes[i].to_ascii_uppercase() - b'A') as u32 + 1;
        i += 1;
    }
    if i == 0 || i == bytes.len() {
        return None;
    }
    col -= 1; // 0-based

    let row_str: String = s[i..].chars().filter(|c| *c != '$').collect();
    let row: u32 = row_str.parse().ok()?;
    if row == 0 {
        return None;
    }
    Some((row - 1, col))
}

/// Parse an A1 range string ("A1" or "A1:B10") into an `IdentityRangeSchemaRef`
/// using "row:col" positional format for start_id/end_id.
pub(super) fn a1_range_to_identity_ref(range: &str) -> Option<IdentityRangeSchemaRef> {
    let parts: Vec<&str> = range.split(':').collect();
    let (sr, sc, er, ec) = if parts.len() == 2 {
        let (sr, sc) = parse_a1_cell(parts[0])?;
        let (er, ec) = parse_a1_cell(parts[1])?;
        (sr, sc, er, ec)
    } else {
        let (r, c) = parse_a1_cell(parts[0])?;
        (r, c, r, c)
    };
    Some(IdentityRangeSchemaRef {
        start_id: format!("{sr}:{sc}"),
        end_id: format!("{er}:{ec}"),
        sheet_id: None,
    })
}
