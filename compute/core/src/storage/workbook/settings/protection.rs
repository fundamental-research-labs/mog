use crate::snapshot::{ProtectedWorkbookOperation, WorkbookProtectionOptions};
use crate::storage::workbook::WorkbookMetadata;
use domain_types::domain::workbook::WorkbookProtection;

pub fn is_protected(metadata: &WorkbookMetadata) -> bool {
    metadata.settings.is_workbook_protected
}

pub fn get_protection_options(metadata: &WorkbookMetadata) -> WorkbookProtectionOptions {
    metadata
        .protection
        .as_ref()
        .map(|protection| WorkbookProtectionOptions {
            structure: protection.lock_structure,
        })
        .unwrap_or_default()
}

fn password_hash(metadata: &WorkbookMetadata) -> Option<&str> {
    let protection = metadata.protection.as_ref()?;
    protection
        .workbook_hash_value
        .as_deref()
        .or(protection.workbook_password.as_deref())
        .filter(|hash| !hash.is_empty())
}

pub fn has_protection_password(metadata: &WorkbookMetadata) -> bool {
    password_hash(metadata).is_some()
}

/// The caller supplies the precomputed Excel-compatible protection hash.
pub fn protect_workbook(
    metadata: &mut WorkbookMetadata,
    password_hash: Option<&str>,
    options: Option<&WorkbookProtectionOptions>,
) {
    metadata.settings.is_workbook_protected = true;
    metadata.protection = Some(WorkbookProtection {
        lock_structure: options.cloned().unwrap_or_default().structure,
        workbook_password: password_hash
            .filter(|hash| !hash.is_empty())
            .map(str::to_owned),
        ..Default::default()
    });
}

/// Remove protection only when any stored password hash matches.
pub fn unprotect_workbook(metadata: &mut WorkbookMetadata, provided_hash: Option<&str>) -> bool {
    if !is_protected(metadata) {
        return true;
    }
    if let Some(stored_hash) = password_hash(metadata) {
        if provided_hash != Some(stored_hash) {
            return false;
        }
    }
    metadata.settings.is_workbook_protected = false;
    metadata.protection = None;
    true
}

pub fn is_operation_allowed(
    metadata: &WorkbookMetadata,
    operation: ProtectedWorkbookOperation,
) -> bool {
    !is_protected(metadata)
        || !get_protection_options(metadata).structure
        || !matches!(
            operation,
            ProtectedWorkbookOperation::AddSheet
                | ProtectedWorkbookOperation::DeleteSheet
                | ProtectedWorkbookOperation::RenameSheet
                | ProtectedWorkbookOperation::MoveSheet
                | ProtectedWorkbookOperation::HideSheet
                | ProtectedWorkbookOperation::UnhideSheet
                | ProtectedWorkbookOperation::CopySheet
        )
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::workbook::WorkbookMetadata;

    #[test]
    fn test_protect_workbook() {
        let mut metadata = WorkbookMetadata::default();

        // Initially not protected
        assert!(!is_protected(&metadata));
        assert!(is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::AddSheet
        ));

        // Protect without password
        protect_workbook(&mut metadata, None, None);

        assert!(is_protected(&metadata));
        assert!(!has_protection_password(&metadata));

        // Structure operations should be blocked
        assert!(!is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::AddSheet
        ));
        assert!(!is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::DeleteSheet
        ));
        assert!(!is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::RenameSheet
        ));
        assert!(!is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::MoveSheet
        ));
        assert!(!is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::HideSheet
        ));
        assert!(!is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::UnhideSheet
        ));
        assert!(!is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::CopySheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 7: Protection — protect with password
    // -------------------------------------------------------------------

    #[test]
    fn test_protect_workbook_with_password() {
        let mut metadata = WorkbookMetadata::default();

        // Protect with a password hash
        protect_workbook(&mut metadata, Some("ABCD"), None);

        assert!(is_protected(&metadata));
        assert!(has_protection_password(&metadata));

        // Cannot unprotect with wrong password
        assert!(!unprotect_workbook(&mut metadata, Some("WRONG")));
        assert!(is_protected(&metadata));

        // Cannot unprotect without password
        assert!(!unprotect_workbook(&mut metadata, None));
        assert!(is_protected(&metadata));

        // Can unprotect with correct password
        assert!(unprotect_workbook(&mut metadata, Some("ABCD")));
        assert!(!is_protected(&metadata));
    }

    // -------------------------------------------------------------------
    // Test 8: Protection — unprotect without password
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_workbook_no_password() {
        let mut metadata = WorkbookMetadata::default();

        protect_workbook(&mut metadata, None, None);
        assert!(is_protected(&metadata));

        // Unprotect succeeds without password when no password was set
        assert!(unprotect_workbook(&mut metadata, None));
        assert!(!is_protected(&metadata));
    }

    // -------------------------------------------------------------------
    // Test 9: Protection — unprotect clears all protection state
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_clears_state() {
        let mut metadata = WorkbookMetadata::default();

        protect_workbook(&mut metadata, Some("HASH"), None);
        assert!(is_protected(&metadata));
        assert!(has_protection_password(&metadata));

        // Verify protection options are set
        let options = get_protection_options(&metadata);
        assert!(options.structure);

        // Unprotect
        assert!(unprotect_workbook(&mut metadata, Some("HASH")));

        assert!(!is_protected(&metadata));
        assert!(!has_protection_password(&metadata));

        // Operations should be allowed again
        assert!(is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::AddSheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 10: Protection — custom options
    // -------------------------------------------------------------------

    #[test]
    fn test_protect_with_custom_options() {
        let mut metadata = WorkbookMetadata::default();

        let options = WorkbookProtectionOptions { structure: false };
        protect_workbook(&mut metadata, None, Some(&options));

        assert!(is_protected(&metadata));

        // Structure is not protected, so operations should be allowed
        assert!(is_operation_allowed(
            &metadata,
            ProtectedWorkbookOperation::AddSheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 11: Already unprotected — unprotect returns true
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_already_unprotected() {
        let mut metadata = WorkbookMetadata::default();

        // Not protected at all
        assert!(unprotect_workbook(&mut metadata, None));
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
