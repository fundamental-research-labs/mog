use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::workbook::WorkbookProtection;
use domain_types::yrs_schema::protection as protection_schema;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::snapshot::{ProtectedWorkbookOperation, WorkbookProtectionOptions};
use crate::storage::infra::yrs_helpers::read_bool;

use super::map::{ensure_settings_map, get_settings_map};

pub fn is_protected(doc: &Doc, workbook: &MapRef) -> bool {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return false,
    };
    if let Some(Out::YMap(prot_map)) = settings_map.get(&txn, "protection") {
        return read_bool(&prot_map, &txn, protection_schema::KEY_WB_IS_PROTECTED).unwrap_or(false);
    }
    false
}

/// Get workbook protection options.
pub fn get_protection_options(doc: &Doc, workbook: &MapRef) -> WorkbookProtectionOptions {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return WorkbookProtectionOptions::default(),
    };
    if let Some(Out::YMap(prot_map)) = settings_map.get(&txn, "protection")
        && let Some(prot) = protection_schema::workbook_from_yrs_map(&prot_map, &txn)
    {
        return WorkbookProtectionOptions {
            structure: prot.lock_structure,
        };
    }
    WorkbookProtectionOptions::default()
}

/// Check if the workbook has a protection password set.
pub fn has_protection_password(doc: &Doc, workbook: &MapRef) -> bool {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return false,
    };
    if let Some(Out::YMap(prot_map)) = settings_map.get(&txn, "protection")
        && let Some(prot) = protection_schema::workbook_from_yrs_map(&prot_map, &txn)
    {
        return prot
            .workbook_hash_value
            .as_ref()
            .map(|h| !h.is_empty())
            .unwrap_or(false);
    }
    false
}

/// Protect the workbook with optional password hash and options.
///
/// Prevents sheet structure operations (add, delete, move, rename, hide, unhide).
///
/// Note: Password hashing is done by the caller (TypeScript layer) using
/// Excel-compatible XOR hashing. This function stores the pre-computed hash.
pub fn protect_workbook(
    doc: &Doc,
    workbook: &MapRef,
    password_hash: Option<&str>,
    options: Option<&WorkbookProtectionOptions>,
) {
    let full_options = options.cloned().unwrap_or_default();

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    // Write structured "protection" sub-map
    let mut domain_prot = WorkbookProtection {
        lock_structure: full_options.structure,
        ..Default::default()
    };
    if let Some(hash) = password_hash
        && !hash.is_empty()
    {
        domain_prot.workbook_hash_value = Some(hash.to_string());
    }
    let mut entries = protection_schema::workbook_to_yrs_prelim(&domain_prot);
    entries.push((protection_schema::KEY_WB_IS_PROTECTED, Any::Bool(true)));
    let prot_prelim: MapPrelim = entries.into_iter().collect();
    settings_map.insert(&mut txn, "protection", prot_prelim);
}

/// Unprotect the workbook.
///
/// If the workbook has a password, the caller must verify it before calling
/// this function. This function does NOT verify the password — that responsibility
/// belongs to the TypeScript layer which has the hashing implementation.
///
/// Returns `true` if the workbook was successfully unprotected,
/// `false` if the provided password hash doesn't match the stored one.
pub fn unprotect_workbook(doc: &Doc, workbook: &MapRef, password_hash: Option<&str>) -> bool {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return true, // No settings = not protected
    };

    // Check if workbook is even protected via structured "protection" sub-map
    let (is_protected, stored_hash) =
        if let Some(Out::YMap(prot_map)) = settings_map.get(&txn, "protection") {
            let protected =
                read_bool(&prot_map, &txn, protection_schema::KEY_WB_IS_PROTECTED).unwrap_or(false);
            let hash = protection_schema::workbook_from_yrs_map(&prot_map, &txn)
                .and_then(|prot| prot.workbook_hash_value);
            (protected, hash)
        } else {
            (false, None)
        };

    if !is_protected {
        return true; // Already unprotected
    }

    // Verify password hash if set
    if let Some(ref stored) = stored_hash
        && !stored.is_empty()
    {
        match password_hash {
            Some(provided) => {
                if provided != stored {
                    return false; // Wrong password
                }
            }
            None => return false, // Password required but not provided
        }
    }
    drop(txn);

    // Perform the unprotect
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return true,
    };

    // Write default (unprotected) state to the structured "protection" sub-map
    let domain_prot = WorkbookProtection::default();
    let mut entries = protection_schema::workbook_to_yrs_prelim(&domain_prot);
    entries.push((protection_schema::KEY_WB_IS_PROTECTED, Any::Bool(false)));
    let prot_prelim: MapPrelim = entries.into_iter().collect();
    settings_map.insert(&mut txn, "protection", prot_prelim);

    true
}

/// Check if a workbook-level operation is allowed.
///
/// This checks workbook protection only.
pub fn is_operation_allowed(
    doc: &Doc,
    workbook: &MapRef,
    operation: ProtectedWorkbookOperation,
) -> bool {
    // If workbook is not protected, all operations are allowed
    if !is_protected(doc, workbook) {
        return true;
    }

    let options = get_protection_options(doc, workbook);

    // Structure protection prevents all sheet structure operations
    if options.structure {
        !matches!(
            operation,
            ProtectedWorkbookOperation::AddSheet
                | ProtectedWorkbookOperation::DeleteSheet
                | ProtectedWorkbookOperation::RenameSheet
                | ProtectedWorkbookOperation::MoveSheet
                | ProtectedWorkbookOperation::HideSheet
                | ProtectedWorkbookOperation::UnhideSheet
                | ProtectedWorkbookOperation::CopySheet
        )
    } else {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;

    #[test]
    fn test_protect_workbook() {
        let storage = YrsStorage::new();

        // Initially not protected
        assert!(!is_protected(storage.doc(), storage.workbook_map()));
        assert!(is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::AddSheet
        ));

        // Protect without password
        protect_workbook(storage.doc(), storage.workbook_map(), None, None);

        assert!(is_protected(storage.doc(), storage.workbook_map()));
        assert!(!has_protection_password(
            storage.doc(),
            storage.workbook_map()
        ));

        // Structure operations should be blocked
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::AddSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::DeleteSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::RenameSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::MoveSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::HideSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::UnhideSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::CopySheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 7: Protection — protect with password
    // -------------------------------------------------------------------

    #[test]
    fn test_protect_workbook_with_password() {
        let storage = YrsStorage::new();

        // Protect with a password hash
        protect_workbook(storage.doc(), storage.workbook_map(), Some("ABCD"), None);

        assert!(is_protected(storage.doc(), storage.workbook_map()));
        assert!(has_protection_password(
            storage.doc(),
            storage.workbook_map()
        ));

        // Cannot unprotect with wrong password
        assert!(!unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            Some("WRONG")
        ));
        assert!(is_protected(storage.doc(), storage.workbook_map()));

        // Cannot unprotect without password
        assert!(!unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            None
        ));
        assert!(is_protected(storage.doc(), storage.workbook_map()));

        // Can unprotect with correct password
        assert!(unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            Some("ABCD")
        ));
        assert!(!is_protected(storage.doc(), storage.workbook_map()));
    }

    // -------------------------------------------------------------------
    // Test 8: Protection — unprotect without password
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_workbook_no_password() {
        let storage = YrsStorage::new();

        protect_workbook(storage.doc(), storage.workbook_map(), None, None);
        assert!(is_protected(storage.doc(), storage.workbook_map()));

        // Unprotect succeeds without password when no password was set
        assert!(unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            None
        ));
        assert!(!is_protected(storage.doc(), storage.workbook_map()));
    }

    // -------------------------------------------------------------------
    // Test 9: Protection — unprotect clears all protection state
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_clears_state() {
        let storage = YrsStorage::new();

        protect_workbook(storage.doc(), storage.workbook_map(), Some("HASH"), None);
        assert!(is_protected(storage.doc(), storage.workbook_map()));
        assert!(has_protection_password(
            storage.doc(),
            storage.workbook_map()
        ));

        // Verify protection options are set
        let options = get_protection_options(storage.doc(), storage.workbook_map());
        assert!(options.structure);

        // Unprotect
        assert!(unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            Some("HASH")
        ));

        assert!(!is_protected(storage.doc(), storage.workbook_map()));
        assert!(!has_protection_password(
            storage.doc(),
            storage.workbook_map()
        ));

        // Operations should be allowed again
        assert!(is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::AddSheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 10: Protection — custom options
    // -------------------------------------------------------------------

    #[test]
    fn test_protect_with_custom_options() {
        let storage = YrsStorage::new();

        let options = WorkbookProtectionOptions { structure: false };
        protect_workbook(storage.doc(), storage.workbook_map(), None, Some(&options));

        assert!(is_protected(storage.doc(), storage.workbook_map()));

        // Structure is not protected, so operations should be allowed
        assert!(is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::AddSheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 11: Already unprotected — unprotect returns true
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_already_unprotected() {
        let storage = YrsStorage::new();

        // Not protected at all
        assert!(unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            None
        ));
    }

    // -------------------------------------------------------------------
    // Test 12: Calculation settings
    // -------------------------------------------------------------------
    #[test]
    fn test_protection_options_serde_roundtrip() {
        let options = WorkbookProtectionOptions { structure: false };
        let json = serde_json::to_string(&options).unwrap();
        let deserialized: WorkbookProtectionOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(options, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 23: Multiple set_setting calls accumulate
    // -------------------------------------------------------------------
}
