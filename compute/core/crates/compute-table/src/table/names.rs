use super::super::error::TableError;

/// Validate a proposed table name.
///
/// Rules:
/// - Non-empty
/// - Starts with letter or underscore
/// - Only letters, digits, underscores (no spaces)
/// - Not a cell reference (A1 through XFD1048576)
///
/// Returns `Ok(())` if valid, `Err(description)` if invalid.
pub fn validate_table_name(name: &str) -> Result<(), TableError> {
    if name.is_empty() || name.trim().is_empty() {
        return Err(TableError::InvalidTableName(
            "Table name cannot be empty".to_string(),
        ));
    }

    // Must start with letter or underscore
    let first = name.chars().next().unwrap();
    if !first.is_ascii_alphabetic() && first != '_' {
        return Err(TableError::InvalidTableName(
            "Table name must start with a letter or underscore".to_string(),
        ));
    }

    // Only letters, digits, underscores (no spaces)
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(TableError::InvalidTableName(
            "Table name can only contain letters, digits, and underscores".to_string(),
        ));
    }

    // Reject cell references like A1, BB99, XFD1
    if looks_like_cell_reference(name) {
        return Err(TableError::InvalidTableName(
            "Table name cannot be a cell reference".to_string(),
        ));
    }

    Ok(())
}

/// Check if a name looks like a cell reference (A1 through XFD1048576).
fn looks_like_cell_reference(name: &str) -> bool {
    let bytes = name.as_bytes();

    // Find where the letter part ends and the digit part begins
    let mut letter_end = 0;
    for &b in bytes {
        if b.is_ascii_alphabetic() {
            letter_end += 1;
        } else {
            break;
        }
    }

    // Must have 1-3 letters followed by at least 1 digit
    if letter_end == 0 || letter_end > 3 || letter_end >= bytes.len() {
        return false;
    }

    // Rest must be all digits
    let digit_part = &name[letter_end..];
    if !digit_part.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }

    // Parse the row number
    let row_num: u32 = match digit_part.parse() {
        Ok(n) => n,
        Err(_) => return false,
    };

    // Convert letter part to column number: A=1, B=2, ..., Z=26, AA=27, ..., XFD=16384
    let letters = &name[..letter_end].to_uppercase();
    let mut col_num: u32 = 0;
    for b in letters.bytes() {
        col_num = col_num * 26 + (b - b'A' + 1) as u32;
    }

    // Only reject if both column (1-16384) and row (1-1048576) are valid Excel references
    (1..=16384).contains(&col_num) && (1..=1_048_576).contains(&row_num)
}

/// Generate a unique table name: "Table1", "Table2", etc.
///
/// Picks the first `"TableN"` (N starting at 1) that does not conflict
/// with any existing name (case-insensitive comparison).
pub fn generate_table_name(existing_names: &[&str]) -> String {
    let lower_set: Vec<String> = existing_names.iter().map(|n| n.to_lowercase()).collect();
    let mut i = 1u32;
    loop {
        let candidate = format!("Table{}", i);
        if !lower_set.contains(&candidate.to_lowercase()) {
            return candidate;
        }
        i += 1;
    }
}
