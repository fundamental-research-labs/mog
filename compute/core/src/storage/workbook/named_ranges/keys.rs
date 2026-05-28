/// Maximum name length (Excel limit).
pub(super) const MAX_NAME_LENGTH: usize = 255;

/// Reserved names that cannot be used as defined names.
pub(super) const RESERVED_WORDS: &[&str] = &["TRUE", "FALSE", "NULL"];

// =============================================================================
// Key Generation
// =============================================================================

/// Generate the map key for a defined name.
///
/// Workbook scope: uppercase name (e.g., "REVENUE")
/// Sheet scope: "NAME:sheetId" (e.g., "SALES:abc123")
pub(super) fn get_defined_name_key(name: &str, scope: Option<&str>) -> String {
    match scope {
        Some(sheet_id) => format!("{}:{}", name.to_uppercase(), sheet_id),
        None => name.to_uppercase(),
    }
}

/// Check if a string looks like a cell reference (A1 through XFD1048576).
pub(super) fn looks_like_cell_reference(name: &str) -> bool {
    // Pattern: 1-3 letters followed by 1+ digits
    let bytes = name.as_bytes();
    if bytes.is_empty() {
        return false;
    }

    let mut i = 0;
    // Count leading letters
    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        i += 1;
    }
    let letter_count = i;

    // Must have 1-3 letters
    if !(1..=3).contains(&letter_count) {
        return false;
    }

    // Must have at least 1 digit after letters
    if i >= bytes.len() {
        return false;
    }

    // Rest must be all digits
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            return false;
        }
        i += 1;
    }

    true
}

/// Check if a string looks like an R1C1 reference (e.g., R1C1, R100C200).
pub(super) fn looks_like_r1c1_reference(name: &str) -> bool {
    let upper = name.to_uppercase();
    let bytes = upper.as_bytes();

    if bytes.is_empty() || bytes[0] != b'R' {
        return false;
    }

    let mut i = 1;
    // Skip digits after R
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }

    // Must have at least one digit after R
    if i <= 1 {
        return false;
    }

    // Must have C next
    if i >= bytes.len() || bytes[i] != b'C' {
        return false;
    }
    i += 1;

    // Must have at least one digit after C
    if i >= bytes.len() || !bytes[i].is_ascii_digit() {
        return false;
    }

    // Rest must be all digits
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            return false;
        }
        i += 1;
    }

    true
}

/// Check if a name is a single letter A-Z (reserved as column references).
pub(super) fn is_single_letter(name: &str) -> bool {
    if name.len() != 1 {
        return false;
    }
    let c = name.as_bytes()[0];
    c.is_ascii_alphabetic()
}

/// Check if a character is a valid first character for a defined name.
pub(super) fn is_valid_first_char(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '\\'
}

/// Check if a character is a valid continuation character for a defined name.
pub(super) fn is_valid_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '.'
}
