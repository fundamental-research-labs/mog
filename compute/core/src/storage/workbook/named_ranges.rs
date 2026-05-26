//! Named Ranges Storage Module (spreadsheet-model elimination)
//!
//! Provides CRUD operations for Excel-style named ranges (defined names) stored
//! in the Yrs CRDT document. Named ranges are workbook-scoped and stored in the
//! `namedRanges` Y.Map at the workbook level.
//!
//! This is the Rust equivalent of `spreadsheet-model/src/named-ranges.ts`, porting
//! all named range storage management from TypeScript to Rust.
//!
//! # Storage Layout
//!
//! ```text
//! workbook: Y.Map
//!   +-- namedRanges: Y.Map
//!       +-- "REVENUE" -> JSON string of DefinedName (workbook scope)
//!       +-- "SALES:sheetId123" -> JSON string of DefinedName (sheet scope)
//! ```
//!
//! # Key Format
//!
//! - Workbook scope: uppercase name (e.g., "REVENUE")
//! - Sheet scope: "NAME:sheetId" (e.g., "SALES:abc123")
//!
//! # Note on IdentityFormula
//!
//! The `refers_to` field stores a plain string. IdentityFormula conversion
//! (toA1Display / toIdentityFormula) is deferred to the integration layer
//! because it requires the formula parser, which is a separate crate.

use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::yrs_schema;
use value_types::ComputeError;

use compute_document::schema::KEY_NAMED_RANGES;

pub use domain_types::domain::named_range::*;

// =============================================================================
// Constants
// =============================================================================

/// Maximum name length (Excel limit).
const MAX_NAME_LENGTH: usize = 255;

/// Reserved names that cannot be used as defined names.
const RESERVED_WORDS: &[&str] = &["TRUE", "FALSE", "NULL"];

// =============================================================================
// Key Generation
// =============================================================================

/// Generate the map key for a defined name.
///
/// Workbook scope: uppercase name (e.g., "REVENUE")
/// Sheet scope: "NAME:sheetId" (e.g., "SALES:abc123")
fn get_defined_name_key(name: &str, scope: Option<&str>) -> String {
    match scope {
        Some(sheet_id) => format!("{}:{}", name.to_uppercase(), sheet_id),
        None => name.to_uppercase(),
    }
}

// =============================================================================
// Internal Helpers
// =============================================================================

/// Get the named ranges MapRef from the workbook map.
fn get_named_ranges_map<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Option<MapRef> {
    match workbook.get(txn, KEY_NAMED_RANGES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Lazy-create the named-ranges sub-map. Provider Protocol lifecycle replacement for
/// the prior eager bootstrap in `YrsStorage::new` (see that function's
/// doc-comment for the architectural reasoning).
fn ensure_named_ranges_map(workbook: &MapRef, txn: &mut yrs::TransactionMut<'_>) -> MapRef {
    crate::storage::ensure_workbook_child_map(workbook, txn, KEY_NAMED_RANGES)
}

/// Read a `DefinedName` from a Yrs `Out` value using dual-read:
/// structured Y.Map first, JSON string fallback.
fn read_defined_name_from_out<T: yrs::ReadTxn>(out: Out, txn: &T) -> Option<DefinedName> {
    match out {
        Out::YMap(inner) => yrs_schema::named_range::from_yrs_map(&inner, txn),
        Out::Any(Any::String(s)) => serde_json::from_str::<DefinedName>(&s).ok(),
        _ => None,
    }
}

/// Write a `DefinedName` as a structured Y.Map entry.
///
/// When `order` is `Some`, it overrides the DefinedName's own order field.
/// When `None`, the DefinedName's existing order is preserved (important for
/// upsert paths like formula normalization that shouldn't discard XLSX ordering).
fn write_named_range_structured(
    nr_map: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    dn: &DefinedName,
    order: Option<u32>,
) {
    use yrs::MapPrelim;
    let mut dn_with_order = dn.clone();
    if order.is_some() {
        dn_with_order.order = order;
    }
    let entries = yrs_schema::named_range::to_yrs_prelim(&dn_with_order);
    let prelim: MapPrelim = entries.into_iter().collect();
    nr_map.insert(txn, key, prelim);
}

/// Check if a string looks like a cell reference (A1 through XFD1048576).
fn looks_like_cell_reference(name: &str) -> bool {
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
fn looks_like_r1c1_reference(name: &str) -> bool {
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
fn is_single_letter(name: &str) -> bool {
    if name.len() != 1 {
        return false;
    }
    let c = name.as_bytes()[0];
    c.is_ascii_alphabetic()
}

/// Check if a character is a valid first character for a defined name.
fn is_valid_first_char(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '\\'
}

/// Check if a character is a valid continuation character for a defined name.
fn is_valid_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '.'
}

// =============================================================================
// Validation
// =============================================================================

// =============================================================================
// Validation
// =============================================================================

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

// =========================================================================
// Read Operations
// =========================================================================

/// Get all defined names.
///
/// Uses dual-read: structured Y.Map entries first, JSON string fallback
/// for backward compatibility with legacy data.
pub fn get_all_named_ranges(doc: &Doc, workbook: &MapRef) -> Vec<DefinedName> {
    let txn = doc.transact();
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return Vec::new(),
    };

    // Collect (order, DefinedName) pairs so we can restore original XLSX ordering.
    let mut result: Vec<(Option<u32>, DefinedName)> = Vec::new();
    for (_key, value) in nr_map.iter(&txn) {
        // Read order from the structured Y.Map entry if available.
        let order = match &value {
            Out::YMap(inner) => {
                use yrs::Map;
                match inner.get(&txn, yrs_schema::named_range::KEY_ORDER) {
                    Some(Out::Any(Any::BigInt(n))) => Some(n as u32),
                    Some(Out::Any(Any::Number(n))) => Some(n as u32),
                    _ => None,
                }
            }
            _ => None,
        };
        if let Some(dn) = read_defined_name_from_out(value, &txn) {
            result.push((order, dn));
        }
    }
    // Sort by order (entries with order come first, then by name for stability).
    result.sort_by(|a, b| match (a.0, b.0) {
        (Some(oa), Some(ob)) => oa.cmp(&ob),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.1.name.cmp(&b.1.name),
    });
    result.into_iter().map(|(_, dn)| dn).collect()
}

/// Get a defined name by its name and scope.
///
/// Uses dual-read: structured Y.Map first, JSON string fallback.
pub fn get_named_range_by_name(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
    scope: Option<&str>,
) -> Option<DefinedName> {
    let key = get_defined_name_key(name, scope);
    let txn = doc.transact();
    let nr_map = get_named_ranges_map(workbook, &txn)?;
    let out = nr_map.get(&txn, &key)?;
    read_defined_name_from_out(out, &txn)
}

/// Get a defined name by its unique ID.
pub fn get_named_range_by_id(doc: &Doc, workbook: &MapRef, id: &str) -> Option<DefinedName> {
    let all = get_all_named_ranges(doc, workbook);
    all.into_iter().find(|dn| dn.id == id)
}

/// Resolve a name reference, respecting scope precedence.
///
/// Sheet-scoped names have higher precedence than workbook-scoped names.
pub fn resolve_named_range(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
    current_sheet: Option<&str>,
) -> Option<DefinedName> {
    // First try sheet-scoped name (higher precedence)
    if let Some(sheet_id) = current_sheet
        && let Some(dn) = get_named_range_by_name(doc, workbook, name, Some(sheet_id))
    {
        return Some(dn);
    }

    // Fall back to workbook-scoped
    get_named_range_by_name(doc, workbook, name, None)
}

/// Get all defined names in a specific scope.
///
/// `scope` = None filters for workbook-scoped names only.
/// `scope` = Some(sheet_id) filters for names scoped to that sheet.
pub fn get_named_ranges_by_scope(
    doc: &Doc,
    workbook: &MapRef,
    scope: Option<&str>,
) -> Vec<DefinedName> {
    let all = get_all_named_ranges(doc, workbook);
    all.into_iter()
        .filter(|dn| dn.scope.as_deref() == scope)
        .collect()
}

/// Get all visible defined names (for Name Manager).
pub fn get_visible_named_ranges(doc: &Doc, workbook: &MapRef) -> Vec<DefinedName> {
    let all = get_all_named_ranges(doc, workbook);
    all.into_iter().filter(|dn| dn.visible).collect()
}

/// Check if a name exists in the given scope.
pub fn named_range_exists(doc: &Doc, workbook: &MapRef, name: &str, scope: Option<&str>) -> bool {
    get_named_range_by_name(doc, workbook, name, scope).is_some()
}

/// Get the total number of defined names.
pub fn named_range_count(doc: &Doc, workbook: &MapRef) -> usize {
    let txn = doc.transact();
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return 0,
    };
    nr_map.len(&txn) as usize
}

// =========================================================================
// Write Operations
// =========================================================================

/// Upsert a named range into Yrs storage (insert or overwrite).
///
/// Unlike `create_named_range`, this skips validation — the caller is
/// responsible for ensuring the name is valid. This is used by the bridge
/// `set_named_range` path where validation already happened at the API layer.
pub fn upsert_named_range(doc: &Doc, workbook: &MapRef, dn: &DefinedName) {
    let key = get_defined_name_key(&dn.name, dn.scope.as_deref());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    // Provider Protocol lifecycle: lazy-create the namedRanges sub-map if missing.
    let nr_map = ensure_named_ranges_map(workbook, &mut txn);
    write_named_range_structured(&nr_map, &mut txn, &key, dn, None);
}

/// Remove a named range from Yrs storage by name and scope.
pub fn remove_named_range_by_name(doc: &Doc, workbook: &MapRef, name: &str, scope: Option<&str>) {
    let key = get_defined_name_key(name, scope);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return,
    };
    nr_map.remove(&mut txn, &key);
}

/// Create a new defined name.
///
/// Validates the name and returns an error if invalid or duplicate.
pub fn create_named_range(
    doc: &Doc,
    workbook: &MapRef,
    input: DefinedNameInput,
    id_alloc: &cell_types::IdAllocator,
) -> Result<DefinedName, ComputeError> {
    // Validate
    let validation = validate_name(doc, workbook, &input.name, input.scope.as_deref(), None);
    if !validation.valid {
        return Err(ComputeError::Eval {
            message: validation
                .message
                .unwrap_or_else(|| format!("Invalid name: {:?}", validation.error)),
        });
    }

    // Generate ID
    let id = {
        let n = id_alloc.next_u128();
        format!("{:032x}", n)
    };

    let defined_name = DefinedName {
        id,
        name: input.name.clone(),
        refers_to: input.refers_to,
        raw_refers_to: None,
        scope: input.scope.clone(),
        comment: input.comment,
        custom_menu: None,
        description: None,
        help: None,
        status_bar: None,
        visible: true,
        xlm: false,
        function: false,
        vb_procedure: false,
        publish_to_server: false,
        workbook_parameter: false,
        xml_space_preserve: false,
        order: None,
        linked_range_id: None,
    };

    // Store in Yrs
    let key = get_defined_name_key(&input.name, input.scope.as_deref());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = ensure_named_ranges_map(workbook, &mut txn);
    write_named_range_structured(&nr_map, &mut txn, &key, &defined_name, None);

    Ok(defined_name)
}

/// Update an existing defined name.
///
/// Returns the updated name, or an error if not found or the update is invalid.
pub fn update_named_range(
    doc: &Doc,
    workbook: &MapRef,
    id: &str,
    updates: NamedRangeUpdate,
) -> Result<DefinedName, ComputeError> {
    // Find existing
    let existing = get_named_range_by_id(doc, workbook, id).ok_or_else(|| ComputeError::Eval {
        message: format!("Defined name with ID {} not found", id),
    })?;

    // If renaming, validate new name
    if let Some(ref new_name) = updates.name
        && new_name != &existing.name
    {
        let validation =
            validate_name(doc, workbook, new_name, existing.scope.as_deref(), Some(id));
        if !validation.valid {
            return Err(ComputeError::Eval {
                message: validation
                    .message
                    .unwrap_or_else(|| format!("Invalid name: {:?}", validation.error)),
            });
        }
    }

    // Build updated name
    let updated = DefinedName {
        id: existing.id.clone(),
        name: updates.name.unwrap_or_else(|| existing.name.clone()),
        refers_to: updates
            .refers_to
            .unwrap_or_else(|| existing.refers_to.clone()),
        raw_refers_to: existing.raw_refers_to.clone(),
        scope: existing.scope.clone(),
        comment: match updates.comment {
            Some(c) => c,
            None => existing.comment.clone(),
        },
        visible: updates.visible.unwrap_or(existing.visible),
        custom_menu: existing.custom_menu.clone(),
        description: existing.description.clone(),
        help: existing.help.clone(),
        status_bar: existing.status_bar.clone(),
        xlm: existing.xlm,
        function: existing.function,
        vb_procedure: existing.vb_procedure,
        publish_to_server: existing.publish_to_server,
        workbook_parameter: existing.workbook_parameter,
        xml_space_preserve: existing.xml_space_preserve,
        order: existing.order,
        linked_range_id: existing.linked_range_id,
    };

    // If name changed, remove old key and add new key
    let old_key = get_defined_name_key(&existing.name, existing.scope.as_deref());
    let new_key = get_defined_name_key(&updated.name, updated.scope.as_deref());

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = ensure_named_ranges_map(workbook, &mut txn);

    if old_key != new_key {
        nr_map.remove(&mut txn, &old_key);
    }
    write_named_range_structured(&nr_map, &mut txn, &new_key, &updated, None);

    Ok(updated)
}

/// Delete a defined name by ID.
pub fn remove_named_range_by_id(
    doc: &Doc,
    workbook: &MapRef,
    id: &str,
) -> Result<(), ComputeError> {
    let existing = get_named_range_by_id(doc, workbook, id).ok_or_else(|| ComputeError::Eval {
        message: format!("Defined name with ID {} not found", id),
    })?;

    let key = get_defined_name_key(&existing.name, existing.scope.as_deref());

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = ensure_named_ranges_map(workbook, &mut txn);
    nr_map.remove(&mut txn, &key);

    Ok(())
}

/// Delete all defined names in a scope.
///
/// Useful when deleting a sheet (removes all sheet-scoped names).
pub fn remove_named_ranges_by_scope(doc: &Doc, workbook: &MapRef, scope: Option<&str>) {
    let names = get_named_ranges_by_scope(doc, workbook, scope);
    if names.is_empty() {
        return;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return,
    };

    for dn in &names {
        let key = get_defined_name_key(&dn.name, dn.scope.as_deref());
        nr_map.remove(&mut txn, &key);
    }
}

/// Import multiple defined names (e.g., from XLSX).
///
/// Duplicates are skipped (not errors). Returns the number of successfully imported names.
pub fn import_named_ranges(doc: &Doc, workbook: &MapRef, names: Vec<DefinedName>) -> usize {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return 0,
    };

    let mut imported = 0;
    for (idx, dn) in names.iter().enumerate() {
        let key = get_defined_name_key(&dn.name, dn.scope.as_deref());

        // Skip if already exists
        if nr_map.get(&txn, &key).is_some() {
            continue;
        }

        write_named_range_structured(&nr_map, &mut txn, &key, dn, Some(idx as u32));
        imported += 1;
    }

    imported
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use value_types::{CellError, FiniteF64};

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_storage() -> YrsStorage {
        YrsStorage::new()
    }

    fn sample_input(name: &str, refers_to: &str) -> DefinedNameInput {
        DefinedNameInput {
            name: name.to_string(),
            refers_to: refers_to.to_string(),
            scope: None,
            comment: None,
        }
    }

    fn scoped_input(name: &str, refers_to: &str, scope: &str) -> DefinedNameInput {
        DefinedNameInput {
            name: name.to_string(),
            refers_to: refers_to.to_string(),
            scope: Some(scope.to_string()),
            comment: None,
        }
    }

    // ===================================================================
    // Validation Tests
    // ===================================================================

    // -------------------------------------------------------------------
    // Test 1: Validate empty name -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_empty_name() {
        let storage = make_storage();
        let result = validate_name(storage.doc(), storage.workbook_map(), "", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::Empty));
    }

    // -------------------------------------------------------------------
    // Test 2: Validate whitespace-only name -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_whitespace_name() {
        let storage = make_storage();
        let result = validate_name(storage.doc(), storage.workbook_map(), "   ", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::Empty));
    }

    // -------------------------------------------------------------------
    // Test 3: Validate too long name -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_too_long_name() {
        let storage = make_storage();
        let long_name = "A".repeat(256);
        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            &long_name,
            None,
            None,
        );
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::TooLong));
    }

    // -------------------------------------------------------------------
    // Test 4: Validate starts with digit -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_starts_with_digit() {
        let storage = make_storage();
        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "1Revenue",
            None,
            None,
        );
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::InvalidFirstChar));
    }

    // -------------------------------------------------------------------
    // Test 5: Validate cell reference (A1) -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_cell_reference() {
        let storage = make_storage();

        let result = validate_name(storage.doc(), storage.workbook_map(), "A1", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::CellReference));

        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "XFD1048576",
            None,
            None,
        );
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::CellReference));

        let result = validate_name(storage.doc(), storage.workbook_map(), "AB123", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::CellReference));
    }

    // -------------------------------------------------------------------
    // Test 6: Validate reserved (TRUE, FALSE, NULL) -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_reserved_names() {
        let storage = make_storage();

        for reserved in &["TRUE", "FALSE", "NULL", "true", "false", "null"] {
            let result = validate_name(storage.doc(), storage.workbook_map(), reserved, None, None);
            assert!(!result.valid, "Expected '{}' to be invalid", reserved);
            assert_eq!(result.error, Some(NameValidationError::Reserved));
        }
    }

    // -------------------------------------------------------------------
    // Test 7: Validate single letter A-Z -> reserved
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_single_letter_reserved() {
        let storage = make_storage();

        let result = validate_name(storage.doc(), storage.workbook_map(), "A", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::Reserved));

        let result = validate_name(storage.doc(), storage.workbook_map(), "Z", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::Reserved));
    }

    // -------------------------------------------------------------------
    // Test 8: Validate R1C1 reference -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_r1c1_reference() {
        let storage = make_storage();

        let result = validate_name(storage.doc(), storage.workbook_map(), "R1C1", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::R1C1Reference));

        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "R100C200",
            None,
            None,
        );
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::R1C1Reference));
    }

    // -------------------------------------------------------------------
    // Test 9: Validate valid name -> success
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_valid_name() {
        let storage = make_storage();

        let result = validate_name(storage.doc(), storage.workbook_map(), "Revenue", None, None);
        assert!(result.valid);
        assert!(result.error.is_none());

        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "_private",
            None,
            None,
        );
        assert!(result.valid);

        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "\\backslash",
            None,
            None,
        );
        assert!(result.valid);

        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "Sales2024",
            None,
            None,
        );
        assert!(result.valid);

        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "tax.rate",
            None,
            None,
        );
        assert!(result.valid);
    }

    // -------------------------------------------------------------------
    // Test 10: Validate invalid characters -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_invalid_chars() {
        let storage = make_storage();

        let result = validate_name(storage.doc(), storage.workbook_map(), "my name", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::InvalidChars));

        let result = validate_name(storage.doc(), storage.workbook_map(), "name!", None, None);
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::InvalidChars));
    }

    // ===================================================================
    // CRUD Tests
    // ===================================================================

    // -------------------------------------------------------------------
    // Test 11: Create named range + retrieve
    // -------------------------------------------------------------------

    #[test]
    fn test_create_and_get_named_range() {
        let storage = make_storage();
        let input = sample_input("Revenue", "=Sheet1!$A$1:$A$10");

        let created = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            input,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(created.name, "Revenue");
        assert_eq!(created.refers_to, "=Sheet1!$A$1:$A$10");
        assert!(created.scope.is_none());
        assert!(created.visible);
        assert!(!created.id.is_empty());

        // Retrieve by name
        let found = get_named_range_by_name(storage.doc(), storage.workbook_map(), "Revenue", None)
            .expect("should find by name");
        assert_eq!(found.id, created.id);

        // Case-insensitive retrieval
        let found = get_named_range_by_name(storage.doc(), storage.workbook_map(), "revenue", None)
            .expect("should find case-insensitive");
        assert_eq!(found.id, created.id);
    }

    // -------------------------------------------------------------------
    // Test 12: Create scoped named range
    // -------------------------------------------------------------------

    #[test]
    fn test_create_scoped_named_range() {
        let storage = make_storage();
        let input = scoped_input("LocalName", "=Sheet1!$B$1:$B$5", "sheet123");

        let created = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            input,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(created.scope, Some("sheet123".to_string()));

        // Find with correct scope
        let found = get_named_range_by_name(
            storage.doc(),
            storage.workbook_map(),
            "LocalName",
            Some("sheet123"),
        )
        .expect("should find scoped name");
        assert_eq!(found.id, created.id);

        // Should NOT find without scope
        assert!(
            get_named_range_by_name(storage.doc(), storage.workbook_map(), "LocalName", None)
                .is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 13: Duplicate name -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_create_duplicate_name_error() {
        let storage = make_storage();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=Sheet1!$A$1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let result = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=Sheet1!$B$1"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.is_err());
    }

    // -------------------------------------------------------------------
    // Test 14: Same name different scopes -> allowed
    // -------------------------------------------------------------------

    #[test]
    fn test_same_name_different_scopes() {
        let storage = make_storage();

        // Workbook-scoped
        let wb = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Sales", "=Sheet1!$A$1:$A$10"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Sheet-scoped with same name
        let sheet = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            scoped_input("Sales", "=Sheet1!$B$1:$B$10", "sheet1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert_ne!(wb.id, sheet.id);
        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 2);
    }

    // -------------------------------------------------------------------
    // Test 15: Resolve with scope precedence (sheet > workbook)
    // -------------------------------------------------------------------

    #[test]
    fn test_resolve_scope_precedence() {
        let storage = make_storage();

        // Create workbook-scoped
        let wb = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Sales", "=Sheet1!$A$1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Create sheet-scoped with same name
        let sheet = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            scoped_input("Sales", "=Sheet1!$B$1", "sheet1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Resolve with sheet context -> should get sheet-scoped
        let resolved = resolve_named_range(
            storage.doc(),
            storage.workbook_map(),
            "Sales",
            Some("sheet1"),
        )
        .expect("should resolve");
        assert_eq!(resolved.id, sheet.id);

        // Resolve without sheet context -> should get workbook-scoped
        let resolved = resolve_named_range(storage.doc(), storage.workbook_map(), "Sales", None)
            .expect("should resolve");
        assert_eq!(resolved.id, wb.id);

        // Resolve with different sheet -> should fall back to workbook
        let resolved = resolve_named_range(
            storage.doc(),
            storage.workbook_map(),
            "Sales",
            Some("other_sheet"),
        )
        .expect("should resolve");
        assert_eq!(resolved.id, wb.id);
    }

    // -------------------------------------------------------------------
    // Test 16: Get by ID
    // -------------------------------------------------------------------

    #[test]
    fn test_get_by_id() {
        let storage = make_storage();
        let created = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=Sheet1!$A$1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let found = get_named_range_by_id(storage.doc(), storage.workbook_map(), &created.id)
            .expect("should find by ID");
        assert_eq!(found.name, "Revenue");

        // Non-existent ID
        assert!(
            get_named_range_by_id(storage.doc(), storage.workbook_map(), "nonexistent").is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 17: Get all
    // -------------------------------------------------------------------

    #[test]
    fn test_get_all() {
        let storage = make_storage();
        assert!(get_all_named_ranges(storage.doc(), storage.workbook_map()).is_empty());

        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Costs", "=B1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Profit", "=C1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let all = get_all_named_ranges(storage.doc(), storage.workbook_map());
        assert_eq!(all.len(), 3);
    }

    // -------------------------------------------------------------------
    // Test 18: Get by scope
    // -------------------------------------------------------------------

    #[test]
    fn test_get_by_scope() {
        let storage = make_storage();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("WbName", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            scoped_input("SheetName1", "=B1", "sheet1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            scoped_input("SheetName2", "=C1", "sheet1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            scoped_input("OtherSheet", "=D1", "sheet2"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Workbook scope
        let wb = get_named_ranges_by_scope(storage.doc(), storage.workbook_map(), None);
        assert_eq!(wb.len(), 1);
        assert_eq!(wb[0].name, "WbName");

        // Sheet1 scope
        let s1 = get_named_ranges_by_scope(storage.doc(), storage.workbook_map(), Some("sheet1"));
        assert_eq!(s1.len(), 2);

        // Sheet2 scope
        let s2 = get_named_ranges_by_scope(storage.doc(), storage.workbook_map(), Some("sheet2"));
        assert_eq!(s2.len(), 1);
    }

    // -------------------------------------------------------------------
    // Test 19: Get visible only
    // -------------------------------------------------------------------

    #[test]
    fn test_get_visible() {
        let storage = make_storage();

        // Create visible name
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Visible", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Create then hide a name
        let hidden = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Hidden", "=B1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        update_named_range(
            storage.doc(),
            storage.workbook_map(),
            &hidden.id,
            NamedRangeUpdate {
                visible: Some(false),
                ..Default::default()
            },
        )
        .unwrap();

        let visible = get_visible_named_ranges(storage.doc(), storage.workbook_map());
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].name, "Visible");
    }

    // -------------------------------------------------------------------
    // Test 20: Update name
    // -------------------------------------------------------------------

    #[test]
    fn test_update_name() {
        let storage = make_storage();
        let created = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("OldName", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let updated = update_named_range(
            storage.doc(),
            storage.workbook_map(),
            &created.id,
            NamedRangeUpdate {
                name: Some("NewName".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.name, "NewName");
        assert_eq!(updated.id, created.id);

        // Old name should not be found
        assert!(
            get_named_range_by_name(storage.doc(), storage.workbook_map(), "OldName", None)
                .is_none()
        );

        // New name should be found
        assert!(
            get_named_range_by_name(storage.doc(), storage.workbook_map(), "NewName", None)
                .is_some()
        );
    }

    // -------------------------------------------------------------------
    // Test 21: Update refers_to
    // -------------------------------------------------------------------

    #[test]
    fn test_update_refers_to() {
        let storage = make_storage();
        let created = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=Sheet1!$A$1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let updated = update_named_range(
            storage.doc(),
            storage.workbook_map(),
            &created.id,
            NamedRangeUpdate {
                refers_to: Some("=Sheet1!$A$1:$A$100".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.refers_to, "=Sheet1!$A$1:$A$100");
    }

    // -------------------------------------------------------------------
    // Test 22: Delete by ID
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_by_id() {
        let storage = make_storage();
        let created = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 1);

        remove_named_range_by_id(storage.doc(), storage.workbook_map(), &created.id).unwrap();
        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 0);
        assert!(
            get_named_range_by_name(storage.doc(), storage.workbook_map(), "Revenue", None)
                .is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 23: Delete by ID not found -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_by_id_not_found() {
        let storage = make_storage();
        let result = remove_named_range_by_id(storage.doc(), storage.workbook_map(), "nonexistent");
        assert!(result.is_err());
    }

    // -------------------------------------------------------------------
    // Test 24: Delete by scope
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_by_scope() {
        let storage = make_storage();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("WbName", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            scoped_input("Sheet1Name1", "=B1", "sheet1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            scoped_input("Sheet1Name2", "=C1", "sheet1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            scoped_input("Sheet2Name", "=D1", "sheet2"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 4);

        // Remove all sheet1-scoped names
        remove_named_ranges_by_scope(storage.doc(), storage.workbook_map(), Some("sheet1"));

        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 2);
        assert!(
            get_named_range_by_name(storage.doc(), storage.workbook_map(), "WbName", None)
                .is_some()
        );
        assert!(
            get_named_range_by_name(
                storage.doc(),
                storage.workbook_map(),
                "Sheet2Name",
                Some("sheet2")
            )
            .is_some()
        );
        assert!(
            get_named_range_by_name(
                storage.doc(),
                storage.workbook_map(),
                "Sheet1Name1",
                Some("sheet1")
            )
            .is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 25: Import (skips duplicates)
    // -------------------------------------------------------------------

    #[test]
    fn test_import_skips_duplicates() {
        let storage = make_storage();

        // Create one existing
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Existing", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let names = vec![
            DefinedName {
                id: "id1".to_string(),
                name: "Existing".to_string(), // duplicate
                refers_to: "=B1".to_string(),
                raw_refers_to: None,
                scope: None,
                comment: None,
                custom_menu: None,
                description: None,
                help: None,
                status_bar: None,
                visible: true,
                xlm: false,
                function: false,
                vb_procedure: false,
                publish_to_server: false,
                workbook_parameter: false,
                xml_space_preserve: false,
                order: None,
                linked_range_id: None,
            },
            DefinedName {
                id: "id2".to_string(),
                name: "NewName".to_string(),
                refers_to: "=C1".to_string(),
                raw_refers_to: None,
                scope: None,
                comment: None,
                custom_menu: None,
                description: None,
                help: None,
                status_bar: None,
                visible: true,
                xlm: false,
                function: false,
                vb_procedure: false,
                publish_to_server: false,
                workbook_parameter: false,
                xml_space_preserve: false,
                order: None,
                linked_range_id: None,
            },
            DefinedName {
                id: "id3".to_string(),
                name: "AnotherNew".to_string(),
                refers_to: "=D1".to_string(),
                raw_refers_to: None,
                scope: None,
                comment: None,
                custom_menu: None,
                description: None,
                help: None,
                status_bar: None,
                visible: true,
                xlm: false,
                function: false,
                vb_procedure: false,
                publish_to_server: false,
                workbook_parameter: false,
                xml_space_preserve: false,
                order: None,
                linked_range_id: None,
            },
        ];

        let imported = import_named_ranges(storage.doc(), storage.workbook_map(), names);
        assert_eq!(imported, 2); // "Existing" was skipped
        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 3);
    }

    // -------------------------------------------------------------------
    // Test 26: Count
    // -------------------------------------------------------------------

    #[test]
    fn test_count() {
        let storage = make_storage();
        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 0);

        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("A1Name", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 1);

        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("B1Name", "=B1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 2);
    }

    // -------------------------------------------------------------------
    // Test 27: Exists check
    // -------------------------------------------------------------------

    #[test]
    fn test_exists() {
        let storage = make_storage();

        assert!(!named_range_exists(
            storage.doc(),
            storage.workbook_map(),
            "Revenue",
            None
        ));

        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert!(named_range_exists(
            storage.doc(),
            storage.workbook_map(),
            "Revenue",
            None
        ));
        // Case-insensitive
        assert!(named_range_exists(
            storage.doc(),
            storage.workbook_map(),
            "revenue",
            None
        ));
        assert!(named_range_exists(
            storage.doc(),
            storage.workbook_map(),
            "REVENUE",
            None
        ));
        // Different scope
        assert!(!named_range_exists(
            storage.doc(),
            storage.workbook_map(),
            "Revenue",
            Some("sheet1")
        ));
    }

    // ===================================================================
    // Edge Case Tests
    // ===================================================================

    // -------------------------------------------------------------------
    // Test 35: Validate duplicate with exclude_id (update case)
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_duplicate_with_exclude_id() {
        let storage = make_storage();
        let created = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Validating the same name for the same ID should succeed
        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "Revenue",
            None,
            Some(&created.id),
        );
        assert!(result.valid);

        // Validating the same name for a different ID should fail
        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "Revenue",
            None,
            Some("other-id"),
        );
        assert!(!result.valid);
        assert_eq!(result.error, Some(NameValidationError::Duplicate));
    }

    // -------------------------------------------------------------------
    // Test 36: Update comment
    // -------------------------------------------------------------------

    #[test]
    fn test_update_comment() {
        let storage = make_storage();
        let created = create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert!(created.comment.is_none());

        let updated = update_named_range(
            storage.doc(),
            storage.workbook_map(),
            &created.id,
            NamedRangeUpdate {
                comment: Some(Some("Annual revenue".to_string())),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.comment, Some("Annual revenue".to_string()));

        // Clear comment
        let updated = update_named_range(
            storage.doc(),
            storage.workbook_map(),
            &created.id,
            NamedRangeUpdate {
                comment: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(updated.comment.is_none());
    }

    // -------------------------------------------------------------------
    // Test 37: Update not found -> error
    // -------------------------------------------------------------------

    #[test]
    fn test_update_not_found() {
        let storage = make_storage();
        let result = update_named_range(
            storage.doc(),
            storage.workbook_map(),
            "nonexistent",
            NamedRangeUpdate {
                name: Some("NewName".to_string()),
                ..Default::default()
            },
        );
        assert!(result.is_err());
    }

    // -------------------------------------------------------------------
    // Test 38: Delete by scope with no matches (no-op)
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_by_scope_no_matches() {
        let storage = make_storage();
        create_named_range(
            storage.doc(),
            storage.workbook_map(),
            sample_input("Revenue", "=A1"),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Delete by scope that has no names — should not panic or affect anything
        remove_named_ranges_by_scope(
            storage.doc(),
            storage.workbook_map(),
            Some("nonexistent_sheet"),
        );
        assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 1);
    }

    // -------------------------------------------------------------------
    // Test 39: Import empty list
    // -------------------------------------------------------------------

    #[test]
    fn test_import_empty_list() {
        let storage = make_storage();
        let imported = import_named_ranges(storage.doc(), storage.workbook_map(), vec![]);
        assert_eq!(imported, 0);
    }

    // -------------------------------------------------------------------
    // Test 40: Validate name at exactly 255 chars -> valid
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_max_length_name() {
        let storage = make_storage();
        let name = format!("A{}", "x".repeat(254));
        assert_eq!(name.len(), 255);
        let result = validate_name(storage.doc(), storage.workbook_map(), &name, None, None);
        assert!(result.valid);
    }

    // -------------------------------------------------------------------
    // Test 41: DefinedName serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_defined_name_serde_roundtrip() {
        let dn = DefinedName {
            id: "abc123".to_string(),
            name: "Revenue".to_string(),
            refers_to: "=Sheet1!$A$1:$A$10".to_string(),
            raw_refers_to: None,
            scope: Some("sheet1".to_string()),
            comment: Some("Annual revenue".to_string()),
            custom_menu: Some("Revenue menu".to_string()),
            description: Some("Revenue description".to_string()),
            help: Some("Revenue help".to_string()),
            status_bar: Some("Revenue status".to_string()),
            visible: true,
            xlm: false,
            function: false,
            vb_procedure: true,
            publish_to_server: true,
            workbook_parameter: true,
            xml_space_preserve: false,
            order: None,
            linked_range_id: None,
        };

        let json = serde_json::to_string(&dn).unwrap();
        let deserialized: DefinedName = serde_json::from_str(&json).unwrap();
        assert_eq!(dn, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 42: DefinedName serde with defaults (visible defaults to true)
    // -------------------------------------------------------------------

    #[test]
    fn test_defined_name_serde_defaults() {
        let json = r#"{"id":"1","name":"Test","refersTo":"=A1"}"#;
        let dn: DefinedName = serde_json::from_str(json).unwrap();
        assert!(dn.visible);
        assert!(dn.scope.is_none());
        assert!(dn.comment.is_none());
    }

    // -------------------------------------------------------------------
    // Test 43: Key generation
    // -------------------------------------------------------------------

    #[test]
    fn test_key_generation() {
        assert_eq!(get_defined_name_key("Revenue", None), "REVENUE");
        assert_eq!(
            get_defined_name_key("Sales", Some("sheet1")),
            "SALES:sheet1"
        );
        assert_eq!(get_defined_name_key("lower", None), "LOWER");
    }

    // -------------------------------------------------------------------
    // Test 44: Validate underscore-prefixed name -> valid
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_underscore_prefix() {
        let storage = make_storage();
        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "_internal",
            None,
            None,
        );
        assert!(result.valid);
    }

    // -------------------------------------------------------------------
    // Test 45: Validate backslash-prefixed name -> valid
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_backslash_prefix() {
        let storage = make_storage();
        let result = validate_name(
            storage.doc(),
            storage.workbook_map(),
            "\\special",
            None,
            None,
        );
        assert!(result.valid);
    }

    // -------------------------------------------------------------------
    // Test 46: Looks like cell reference helper
    // -------------------------------------------------------------------

    #[test]
    fn test_looks_like_cell_reference() {
        assert!(looks_like_cell_reference("A1"));
        assert!(looks_like_cell_reference("XFD1048576"));
        assert!(looks_like_cell_reference("AB123"));
        assert!(looks_like_cell_reference("Z99"));

        assert!(!looks_like_cell_reference(""));
        assert!(!looks_like_cell_reference("ABCD1")); // 4 letters
        assert!(!looks_like_cell_reference("A")); // no digit
        assert!(!looks_like_cell_reference("123")); // no letter
        assert!(!looks_like_cell_reference("Revenue")); // no digit at end
        assert!(!looks_like_cell_reference("A1B")); // letter after digit
    }

    // -------------------------------------------------------------------
    // Test 48: Looks like R1C1 reference helper
    // -------------------------------------------------------------------

    #[test]
    fn test_looks_like_r1c1_reference() {
        assert!(looks_like_r1c1_reference("R1C1"));
        assert!(looks_like_r1c1_reference("R100C200"));
        assert!(looks_like_r1c1_reference("r1c1")); // case insensitive

        assert!(!looks_like_r1c1_reference("RC"));
        assert!(!looks_like_r1c1_reference("R1C"));
        assert!(!looks_like_r1c1_reference("RC1"));
        assert!(!looks_like_r1c1_reference("Revenue"));
    }
}
