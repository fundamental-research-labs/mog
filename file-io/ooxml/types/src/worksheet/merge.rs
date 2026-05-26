//! MergeRange and A1-notation helpers.

// ---------------------------------------------------------------------------
// A1 notation helpers (private)
// ---------------------------------------------------------------------------

/// Convert a 0-indexed column number to A1-style column letters.
/// 0 -> "A", 1 -> "B", 25 -> "Z", 26 -> "AA", etc.
pub(super) fn col_to_letters(col: u32) -> String {
    let mut result = String::new();
    let mut c = col;
    loop {
        result.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    result
}

/// Convert 0-indexed (row, col) to A1 notation. (0,0) -> "A1", (0,1) -> "B1"
pub(super) fn to_a1(row: u32, col: u32) -> String {
    format!("{}{}", col_to_letters(col), row + 1)
}

pub(super) fn parse_a1_cell(cell_ref: &str) -> Option<(u32, u32)> {
    let bytes = cell_ref.as_bytes();
    if bytes.is_empty() {
        return None;
    }

    let mut pos = 0;

    if pos < bytes.len() && bytes[pos] == b'$' {
        pos += 1;
    }

    let mut col: u32 = 0;
    while pos < bytes.len() && bytes[pos].is_ascii_uppercase() {
        col = col
            .saturating_mul(26)
            .saturating_add((bytes[pos] - b'A' + 1) as u32);
        pos += 1;
    }

    if col == 0 {
        return None;
    }
    let col = col - 1;

    if pos < bytes.len() && bytes[pos] == b'$' {
        pos += 1;
    }

    let mut row: u32 = 0;
    let mut has_digits = false;
    while pos < bytes.len() && bytes[pos].is_ascii_digit() {
        row = row
            .saturating_mul(10)
            .saturating_add((bytes[pos] - b'0') as u32);
        has_digits = true;
        pos += 1;
    }

    if !has_digits || row == 0 || pos != bytes.len() {
        return None;
    }

    Some((row - 1, col))
}

fn parse_a1_range(ref_range: &str) -> Option<(u32, u32, u32, u32)> {
    let (start, end) = ref_range.split_once(':')?;
    let (sr, sc) = parse_a1_cell(start)?;
    let (er, ec) = parse_a1_cell(end)?;
    Some((sr, sc, er, ec))
}

// ---------------------------------------------------------------------------
// MergeRange
// ---------------------------------------------------------------------------

/// A merged-cell range in a worksheet.
///
/// The `ref_range` string (e.g. `"A1:B3"`) is always present alongside the
/// parsed 0-indexed coordinates. Both representations are kept in sync by
/// the constructors.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MergeRange {
    /// Cell reference string (e.g., "A1:B3").
    pub ref_range: String,
    /// Start row (0-indexed).
    pub start_row: u32,
    /// Start column (0-indexed).
    pub start_col: u32,
    /// End row (0-indexed).
    pub end_row: u32,
    /// End column (0-indexed).
    pub end_col: u32,
}

impl MergeRange {
    /// Create from a reference string (e.g. `"A1:B3"`), parsing coordinates.
    ///
    /// # Panics
    /// Panics if `ref_range` is not a valid A1 range (e.g. `"A1:B3"`).
    pub fn from_ref(ref_range: &str) -> Self {
        let (sr, sc, er, ec) = parse_a1_range(ref_range).expect("malformed merge ref");
        Self {
            ref_range: ref_range.to_string(),
            start_row: sr,
            start_col: sc,
            end_row: er,
            end_col: ec,
        }
    }

    /// Create from 0-indexed coordinates; the reference string is computed.
    pub fn from_coords(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> Self {
        let ref_range = format!(
            "{}:{}",
            to_a1(start_row, start_col),
            to_a1(end_row, end_col)
        );
        Self {
            ref_range,
            start_row,
            start_col,
            end_row,
            end_col,
        }
    }

    /// Return the cell-reference string (e.g. `"A1:B3"`).
    pub fn to_ref(&self) -> &str {
        &self.ref_range
    }
}
