use yrs::{Doc, Map, MapRef, Transact};

use domain_types::domain::named_range::{NameValidationError, NameValidationResult};

use super::keys::{
    MAX_NAME_LENGTH, RESERVED_WORDS, get_defined_name_key, is_single_letter, is_valid_first_char,
    is_valid_name_char, looks_like_cell_reference, looks_like_r1c1_reference,
};
use super::yrs_codec::{get_named_ranges_map, read_defined_name_from_out};

/// Validate a potential defined name.
///
/// Implements Excel name validation rules:
/// - Must not be empty
/// - Max 255 characters
/// - Must start with letter, underscore, or backslash
/// - Remaining chars: letters, numbers, periods, underscores
/// - Cannot be a cell reference (A1-XFD1048576)
/// - Cannot be an R1C1 reference
/// - Cannot be reserved (TRUE, FALSE, NULL, single letter A-Z)
/// - Cannot duplicate an existing name in the same scope
pub fn validate_name(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
    scope: Option<&str>,
    exclude_id: Option<&str>,
) -> NameValidationResult {
    // Must not be empty
    if name.is_empty() || name.trim().is_empty() {
        return NameValidationResult {
            valid: false,
            error: Some(NameValidationError::Empty),
            message: Some("Name cannot be empty".to_string()),
        };
    }

    // Length check
    if name.len() > MAX_NAME_LENGTH {
        return NameValidationResult {
            valid: false,
            error: Some(NameValidationError::TooLong),
            message: Some(format!("Name cannot exceed {} characters", MAX_NAME_LENGTH)),
        };
    }

    // First character must be letter, underscore, or backslash
    let first_char = name.chars().next().unwrap();
    if !is_valid_first_char(first_char) {
        return NameValidationResult {
            valid: false,
            error: Some(NameValidationError::InvalidFirstChar),
            message: Some("Name must start with a letter, underscore, or backslash".to_string()),
        };
    }

    // Remaining characters: letters, numbers, periods, underscores
    // (first char already validated, skip it — but backslash is valid only as first char)
    for c in name.chars().skip(1) {
        if !is_valid_name_char(c) {
            return NameValidationResult {
                valid: false,
                error: Some(NameValidationError::InvalidChars),
                message: Some(
                    "Name can only contain letters, numbers, periods, and underscores".to_string(),
                ),
            };
        }
    }

    // Check reserved names (case-insensitive)
    let upper = name.to_uppercase();
    if RESERVED_WORDS.contains(&upper.as_str()) || is_single_letter(name) {
        return NameValidationResult {
            valid: false,
            error: Some(NameValidationError::Reserved),
            message: Some("This name is reserved".to_string()),
        };
    }

    // Check if name looks like a cell reference
    if looks_like_cell_reference(name) {
        return NameValidationResult {
            valid: false,
            error: Some(NameValidationError::CellReference),
            message: Some("Name cannot look like a cell reference".to_string()),
        };
    }

    // Check if name looks like R1C1 reference
    if looks_like_r1c1_reference(name) {
        return NameValidationResult {
            valid: false,
            error: Some(NameValidationError::R1C1Reference),
            message: Some("Name cannot look like an R1C1 reference".to_string()),
        };
    }

    // Check for duplicates
    let key = get_defined_name_key(name, scope);
    let txn = doc.transact();
    if let Some(nr_map) = get_named_ranges_map(workbook, &txn)
        && let Some(existing) = nr_map
            .get(&txn, &key)
            .and_then(|out| read_defined_name_from_out(out, &txn))
    {
        // If exclude_id is provided, skip the check for that ID (update case)
        let is_self = exclude_id.is_some_and(|eid| eid == existing.id);
        if !is_self {
            return NameValidationResult {
                valid: false,
                error: Some(NameValidationError::Duplicate),
                message: Some("A name with this name already exists in this scope".to_string()),
            };
        }
    }

    NameValidationResult {
        valid: true,
        error: None,
        message: None,
    }
}
