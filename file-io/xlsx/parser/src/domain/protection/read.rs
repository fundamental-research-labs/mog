//! Protection parser for XLSX sheet and workbook protection.
//!
//! This module parses protection-related elements from XLSX files according to
//! the ECMA-376 specification (Office Open XML).
//!
//! # Supported Features
//!
//! ## SheetProtection (CT_SheetProtection)
//! Parses protection settings for individual worksheets including:
//! - Password protection (legacy hash, algorithm-based hash with salt and spin count)
//! - Protection flags for various editing operations (formatting, inserting, deleting, etc.)
//! - Selection restrictions for locked/unlocked cells
//!
//! ## WorkbookProtection (CT_WorkbookProtection)
//! Parses workbook-level protection including:
//! - Structure locking (prevents adding/removing/renaming sheets)
//! - Window locking (prevents resizing/moving workbook windows)
//! - Revision locking (prevents change tracking modifications)
//!
//! ## FileSharing (CT_FileSharing)
//! Parses file sharing settings including:
//! - Read-only recommendation
//! - Reservation password for write access
//! - User name of the person who reserved the file
//!
//! # Performance
//! - Uses SIMD-optimized scanning functions from the scanner module
//! - Zero allocations in the hot path where possible
//! - Graceful handling of malformed input
//!
//! # Example
//! ```ignore
//! use xlsx_parser::protection::{SheetProtection, WorkbookProtection, FileSharing};
//!
//! // Parse sheet protection from worksheet XML
//! let worksheet_xml = b"<worksheet><sheetProtection sheet=\"1\" objects=\"1\"/></worksheet>";
//! if let Some(protection) = SheetProtection::parse(worksheet_xml) {
//!     assert!(protection.sheet);
//!     assert!(protection.objects);
//! }
//!
//! // Parse workbook protection from workbook XML
//! let workbook_xml = b"<workbook><workbookProtection lockStructure=\"1\"/></workbook>";
//! if let Some(protection) = WorkbookProtection::parse(workbook_xml) {
//!     assert!(protection.lock_structure);
//! }
//! ```

use crate::infra::scanner::{find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_bytes_attr, parse_string_attr, parse_u32_attr};

// Re-export canonical types from ooxml-types
pub use ooxml_types::protection::{HashAlgorithm, SheetProtection, WorkbookProtection};

/// Extension trait for parsing SheetProtection from XML bytes.
pub trait SheetProtectionParse {
    /// Parse sheet protection from worksheet XML.
    fn parse(xml: &[u8]) -> Option<SheetProtection>;
}

/// Extension trait for parsing WorkbookProtection from XML bytes.
pub trait WorkbookProtectionParse {
    /// Parse workbook protection from workbook.xml.
    fn parse(xml: &[u8]) -> Option<WorkbookProtection>;
}

impl SheetProtectionParse for SheetProtection {
    /// Parse sheet protection from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed SheetProtection struct, or None if no protection element found
    ///
    /// # Example
    /// ```ignore
    /// let xml = b"<worksheet><sheetProtection sheet=\"1\" password=\"CC2A\"/></worksheet>";
    /// let protection = SheetProtection::parse(xml).unwrap();
    /// assert!(protection.sheet);
    /// assert_eq!(protection.password, Some("CC2A".to_string()));
    /// ```
    fn parse(xml: &[u8]) -> Option<SheetProtection> {
        // Find <sheetProtection> element
        let tag_start = find_tag_simd(xml, b"sheetProtection", 0)?;
        let tag_end = find_gt_simd(xml, tag_start)?;

        let element = &xml[tag_start..=tag_end];

        let mut protection = SheetProtection {
            sheet: false,
            objects: false,
            scenarios: false,
            format_cells: false,
            format_columns: false,
            format_rows: false,
            insert_columns: false,
            insert_rows: false,
            insert_hyperlinks: false,
            delete_columns: false,
            delete_rows: false,
            sort: false,
            auto_filter: false,
            pivot_tables: false,
            select_locked_cells: false,
            select_unlocked_cells: false,
            ..SheetProtection::default()
        };

        // Parse password protection attributes
        protection.password = parse_string_attr(element, b"password=\"");
        protection.algorithm_name = parse_bytes_attr(element, b"algorithmName=\"")
            .map(HashAlgorithm::from_bytes)
            .unwrap_or_default();
        protection.hash_value = parse_string_attr(element, b"hashValue=\"");
        protection.salt_value = parse_string_attr(element, b"saltValue=\"");
        protection.spin_count = parse_u32_attr(element, b"spinCount=\"");

        if let Some(value) = parse_bool_attr_opt(element, b"sheet=\"") {
            protection.sheet = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"objects=\"") {
            protection.objects = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"scenarios=\"") {
            protection.scenarios = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"formatCells=\"") {
            protection.format_cells = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"formatColumns=\"") {
            protection.format_columns = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"formatRows=\"") {
            protection.format_rows = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"insertColumns=\"") {
            protection.insert_columns = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"insertRows=\"") {
            protection.insert_rows = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"insertHyperlinks=\"") {
            protection.insert_hyperlinks = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"deleteColumns=\"") {
            protection.delete_columns = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"deleteRows=\"") {
            protection.delete_rows = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"sort=\"") {
            protection.sort = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"autoFilter=\"") {
            protection.auto_filter = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"pivotTables=\"") {
            protection.pivot_tables = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"selectLockedCells=\"") {
            protection.select_locked_cells = value;
        }
        if let Some(value) = parse_bool_attr_opt(element, b"selectUnlockedCells=\"") {
            protection.select_unlocked_cells = value;
        }

        Some(protection)
    }
}

impl WorkbookProtectionParse for WorkbookProtection {
    /// Parse workbook protection from workbook.xml.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the workbook.xml file
    ///
    /// # Returns
    /// Parsed WorkbookProtection struct, or None if no protection element found
    ///
    /// # Example
    /// ```ignore
    /// let xml = b"<workbook><workbookProtection lockStructure=\"1\" lockWindows=\"1\"/></workbook>";
    /// let protection = WorkbookProtection::parse(xml).unwrap();
    /// assert!(protection.lock_structure);
    /// assert!(protection.lock_windows);
    /// ```
    fn parse(xml: &[u8]) -> Option<WorkbookProtection> {
        // Find <workbookProtection> element
        let tag_start = find_tag_simd(xml, b"workbookProtection", 0)?;
        let tag_end = find_gt_simd(xml, tag_start)?;

        let element = &xml[tag_start..=tag_end];

        let mut protection = WorkbookProtection::default();

        // Parse legacy password attributes
        protection.workbook_password = parse_string_attr(element, b"workbookPassword=\"");
        protection.revisions_password = parse_string_attr(element, b"revisionsPassword=\"");
        protection.workbook_password_character_set =
            parse_string_attr(element, b"workbookPasswordCharacterSet=\"");
        protection.revisions_password_character_set =
            parse_string_attr(element, b"revisionsPasswordCharacterSet=\"");

        // Parse modern workbook password attributes
        protection.workbook_algorithm_name = parse_bytes_attr(element, b"workbookAlgorithmName=\"")
            .map(HashAlgorithm::from_bytes)
            .unwrap_or_default();
        protection.workbook_hash_value = parse_string_attr(element, b"workbookHashValue=\"");
        protection.workbook_salt_value = parse_string_attr(element, b"workbookSaltValue=\"");
        protection.workbook_spin_count = parse_u32_attr(element, b"workbookSpinCount=\"");

        // Parse modern revisions password attributes
        protection.revisions_algorithm_name =
            parse_bytes_attr(element, b"revisionsAlgorithmName=\"")
                .map(HashAlgorithm::from_bytes)
                .unwrap_or_default();
        protection.revisions_hash_value = parse_string_attr(element, b"revisionsHashValue=\"");
        protection.revisions_salt_value = parse_string_attr(element, b"revisionsSaltValue=\"");
        protection.revisions_spin_count = parse_u32_attr(element, b"revisionsSpinCount=\"");

        // Parse protection flags
        protection.lock_structure =
            parse_bool_attr_opt(element, b"lockStructure=\"").unwrap_or(false);
        protection.lock_windows = parse_bool_attr_opt(element, b"lockWindows=\"").unwrap_or(false);
        protection.lock_revision =
            parse_bool_attr_opt(element, b"lockRevision=\"").unwrap_or(false);

        Some(protection)
    }
}

// ============================================================================
// FileSharing (CT_FileSharing)
// ============================================================================

/// File sharing settings from `<fileSharing>` element.
///
/// Controls file sharing behavior including read-only recommendations
/// and reservation passwords for write access.
#[derive(Debug, Clone, Default)]
pub struct FileSharing {
    /// User name who has reserved the file for editing
    pub user_name: Option<String>,

    /// Legacy reservation password hash
    pub reservation_password: Option<String>,

    /// Hash algorithm for reservation password
    pub algorithm_name: HashAlgorithm,

    /// Base64-encoded hash value for reservation password
    pub hash_value: Option<String>,

    /// Base64-encoded salt value for reservation password
    pub salt_value: Option<String>,

    /// Spin count for reservation password
    pub spin_count: Option<u32>,

    /// Recommend opening as read-only
    pub read_only_recommended: bool,
}

impl FileSharing {
    /// Parse file sharing settings from workbook.xml.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the workbook.xml file
    ///
    /// # Returns
    /// Parsed FileSharing struct, or None if no fileSharing element found
    ///
    /// # Example
    /// ```ignore
    /// let xml = b"<workbook><fileSharing userName=\"John\" readOnlyRecommended=\"1\"/></workbook>";
    /// let sharing = FileSharing::parse(xml).unwrap();
    /// assert_eq!(sharing.user_name, Some("John".to_string()));
    /// assert!(sharing.read_only_recommended);
    /// ```
    pub fn parse(xml: &[u8]) -> Option<Self> {
        // Find <fileSharing> element
        let tag_start = find_tag_simd(xml, b"fileSharing", 0)?;
        let tag_end = find_gt_simd(xml, tag_start)?;

        let element = &xml[tag_start..=tag_end];

        let mut sharing = FileSharing::default();

        // Parse user name
        sharing.user_name = parse_string_attr(element, b"userName=\"");

        // Parse legacy password
        sharing.reservation_password = parse_string_attr(element, b"reservationPassword=\"");

        // Parse modern password attributes
        sharing.algorithm_name = parse_bytes_attr(element, b"algorithmName=\"")
            .map(HashAlgorithm::from_bytes)
            .unwrap_or_default();
        sharing.hash_value = parse_string_attr(element, b"hashValue=\"");
        sharing.salt_value = parse_string_attr(element, b"saltValue=\"");
        sharing.spin_count = parse_u32_attr(element, b"spinCount=\"");

        // Parse read-only flag
        sharing.read_only_recommended =
            parse_bool_attr_opt(element, b"readOnlyRecommended=\"").unwrap_or(false);

        Some(sharing)
    }

    /// Check if a reservation password is set
    pub fn has_reservation_password(&self) -> bool {
        self.reservation_password.is_some() || self.hash_value.is_some()
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // HashAlgorithm tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_hash_algorithm_from_bytes() {
        assert_eq!(HashAlgorithm::from_bytes(b"MD2"), HashAlgorithm::Md2);
        assert_eq!(HashAlgorithm::from_bytes(b"MD4"), HashAlgorithm::Md4);
        assert_eq!(HashAlgorithm::from_bytes(b"MD5"), HashAlgorithm::Md5);
        assert_eq!(HashAlgorithm::from_bytes(b"SHA-1"), HashAlgorithm::Sha1);
        assert_eq!(HashAlgorithm::from_bytes(b"SHA1"), HashAlgorithm::Sha1);
        assert_eq!(HashAlgorithm::from_bytes(b"SHA-256"), HashAlgorithm::Sha256);
        assert_eq!(HashAlgorithm::from_bytes(b"SHA256"), HashAlgorithm::Sha256);
        assert_eq!(HashAlgorithm::from_bytes(b"SHA-384"), HashAlgorithm::Sha384);
        assert_eq!(HashAlgorithm::from_bytes(b"SHA384"), HashAlgorithm::Sha384);
        assert_eq!(HashAlgorithm::from_bytes(b"SHA-512"), HashAlgorithm::Sha512);
        assert_eq!(HashAlgorithm::from_bytes(b"SHA512"), HashAlgorithm::Sha512);
        assert_eq!(
            HashAlgorithm::from_bytes(b"RIPEMD-128"),
            HashAlgorithm::Ripemd128
        );
        assert_eq!(
            HashAlgorithm::from_bytes(b"RIPEMD128"),
            HashAlgorithm::Ripemd128
        );
        assert_eq!(
            HashAlgorithm::from_bytes(b"RIPEMD-160"),
            HashAlgorithm::Ripemd160
        );
        assert_eq!(
            HashAlgorithm::from_bytes(b"RIPEMD160"),
            HashAlgorithm::Ripemd160
        );
        assert_eq!(
            HashAlgorithm::from_bytes(b"WHIRLPOOL"),
            HashAlgorithm::Whirlpool
        );
        assert_eq!(
            HashAlgorithm::from_bytes(b"Whirlpool"),
            HashAlgorithm::Whirlpool
        );
        assert_eq!(HashAlgorithm::from_bytes(b"unknown"), HashAlgorithm::None);
        assert_eq!(HashAlgorithm::from_bytes(b""), HashAlgorithm::None);
    }

    #[test]
    fn test_hash_algorithm_as_str() {
        assert_eq!(HashAlgorithm::None.as_str(), "");
        assert_eq!(HashAlgorithm::Md2.as_str(), "MD2");
        assert_eq!(HashAlgorithm::Md4.as_str(), "MD4");
        assert_eq!(HashAlgorithm::Md5.as_str(), "MD5");
        assert_eq!(HashAlgorithm::Sha1.as_str(), "SHA-1");
        assert_eq!(HashAlgorithm::Sha256.as_str(), "SHA-256");
        assert_eq!(HashAlgorithm::Sha384.as_str(), "SHA-384");
        assert_eq!(HashAlgorithm::Sha512.as_str(), "SHA-512");
        assert_eq!(HashAlgorithm::Ripemd128.as_str(), "RIPEMD-128");
        assert_eq!(HashAlgorithm::Ripemd160.as_str(), "RIPEMD-160");
        assert_eq!(HashAlgorithm::Whirlpool.as_str(), "WHIRLPOOL");
    }

    // -------------------------------------------------------------------------
    // SheetProtection tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_sheet_protection_basic() {
        let xml = b"<worksheet><sheetProtection sheet=\"1\"/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.sheet);
        assert!(!protection.objects);
        assert!(!protection.scenarios);
    }

    #[test]
    fn test_parse_sheet_protection_legacy_password() {
        let xml = b"<worksheet><sheetProtection sheet=\"1\" password=\"CC2A\"/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.sheet);
        assert_eq!(protection.password, Some("CC2A".to_string()));
        assert!(protection.has_password());
        assert!(!protection.uses_modern_protection());
    }

    #[test]
    fn test_parse_sheet_protection_modern_password() {
        let xml = br#"<worksheet><sheetProtection sheet="1" algorithmName="SHA-512" hashValue="abc123" saltValue="xyz789" spinCount="100000"/></worksheet>"#;
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.sheet);
        assert_eq!(protection.algorithm_name, HashAlgorithm::Sha512);
        assert_eq!(protection.hash_value, Some("abc123".to_string()));
        assert_eq!(protection.salt_value, Some("xyz789".to_string()));
        assert_eq!(protection.spin_count, Some(100000));
        assert!(protection.has_password());
        assert!(protection.uses_modern_protection());
    }

    #[test]
    fn test_parse_sheet_protection_object_flags() {
        let xml =
            b"<worksheet><sheetProtection sheet=\"1\" objects=\"1\" scenarios=\"1\"/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.sheet);
        assert!(protection.objects);
        assert!(protection.scenarios);
    }

    #[test]
    fn test_parse_sheet_protection_format_flags() {
        let xml = b"<worksheet><sheetProtection sheet=\"1\" formatCells=\"1\" formatColumns=\"1\" formatRows=\"1\"/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.format_cells);
        assert!(protection.format_columns);
        assert!(protection.format_rows);
    }

    #[test]
    fn test_parse_sheet_protection_insert_flags() {
        let xml = b"<worksheet><sheetProtection sheet=\"1\" insertColumns=\"1\" insertRows=\"1\" insertHyperlinks=\"1\"/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.insert_columns);
        assert!(protection.insert_rows);
        assert!(protection.insert_hyperlinks);
    }

    #[test]
    fn test_parse_sheet_protection_delete_flags() {
        let xml = b"<worksheet><sheetProtection sheet=\"1\" deleteColumns=\"1\" deleteRows=\"1\"/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.delete_columns);
        assert!(protection.delete_rows);
    }

    #[test]
    fn test_parse_sheet_protection_data_flags() {
        let xml = b"<worksheet><sheetProtection sheet=\"1\" sort=\"1\" autoFilter=\"1\" pivotTables=\"1\"/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.sort);
        assert!(protection.auto_filter);
        assert!(protection.pivot_tables);
    }

    #[test]
    fn test_parse_sheet_protection_selection_flags() {
        let xml = b"<worksheet><sheetProtection sheet=\"1\" selectLockedCells=\"1\" selectUnlockedCells=\"1\"/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.select_locked_cells);
        assert!(protection.select_unlocked_cells);
    }

    #[test]
    fn test_parse_sheet_protection_all_flags() {
        let xml = br#"<worksheet><sheetProtection sheet="1" objects="1" scenarios="1" formatCells="1" formatColumns="1" formatRows="1" insertColumns="1" insertRows="1" insertHyperlinks="1" deleteColumns="1" deleteRows="1" sort="1" autoFilter="1" pivotTables="1" selectLockedCells="1" selectUnlockedCells="1"/></worksheet>"#;
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(protection.sheet);
        assert!(protection.objects);
        assert!(protection.scenarios);
        assert!(protection.format_cells);
        assert!(protection.format_columns);
        assert!(protection.format_rows);
        assert!(protection.insert_columns);
        assert!(protection.insert_rows);
        assert!(protection.insert_hyperlinks);
        assert!(protection.delete_columns);
        assert!(protection.delete_rows);
        assert!(protection.sort);
        assert!(protection.auto_filter);
        assert!(protection.pivot_tables);
        assert!(protection.select_locked_cells);
        assert!(protection.select_unlocked_cells);
    }

    #[test]
    fn test_parse_sheet_protection_not_found() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(SheetProtection::parse(xml).is_none());
    }

    #[test]
    fn test_parse_sheet_protection_defaults() {
        let xml = b"<worksheet><sheetProtection/></worksheet>";
        let protection = SheetProtection::parse(xml).unwrap();
        assert!(!protection.sheet);
        assert!(!protection.objects);
        assert!(!protection.scenarios);
        assert!(!protection.format_cells);
        assert!(!protection.format_columns);
        assert!(!protection.format_rows);
        assert!(!protection.insert_columns);
        assert!(!protection.insert_rows);
        assert!(!protection.insert_hyperlinks);
        assert!(!protection.delete_columns);
        assert!(!protection.delete_rows);
        assert!(!protection.sort);
        assert!(!protection.auto_filter);
        assert!(!protection.pivot_tables);
        assert!(!protection.select_locked_cells);
        assert!(!protection.select_unlocked_cells);
        assert!(protection.password.is_none());
        assert_eq!(protection.algorithm_name, HashAlgorithm::None);
    }

    // -------------------------------------------------------------------------
    // WorkbookProtection tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_workbook_protection_basic() {
        let xml = b"<workbook><workbookProtection lockStructure=\"1\"/></workbook>";
        let protection = WorkbookProtection::parse(xml).unwrap();
        assert!(protection.lock_structure);
        assert!(!protection.lock_windows);
        assert!(!protection.lock_revision);
    }

    #[test]
    fn test_parse_workbook_protection_all_flags() {
        let xml = b"<workbook><workbookProtection lockStructure=\"1\" lockWindows=\"1\" lockRevision=\"1\"/></workbook>";
        let protection = WorkbookProtection::parse(xml).unwrap();
        assert!(protection.lock_structure);
        assert!(protection.lock_windows);
        assert!(protection.lock_revision);
    }

    #[test]
    fn test_parse_workbook_protection_legacy_password() {
        let xml = b"<workbook><workbookProtection lockStructure=\"1\" workbookPassword=\"ABCD\" revisionsPassword=\"EF12\"/></workbook>";
        let protection = WorkbookProtection::parse(xml).unwrap();
        assert_eq!(protection.workbook_password, Some("ABCD".to_string()));
        assert_eq!(protection.revisions_password, Some("EF12".to_string()));
        assert!(protection.has_password());
        assert!(protection.has_revisions_password());
    }

    #[test]
    fn test_parse_workbook_protection_modern_password() {
        let xml = br#"<workbook><workbookProtection lockStructure="1" workbookAlgorithmName="SHA-256" workbookHashValue="hash1" workbookSaltValue="salt1" workbookSpinCount="100000" revisionsAlgorithmName="SHA-512" revisionsHashValue="hash2" revisionsSaltValue="salt2" revisionsSpinCount="200000"/></workbook>"#;
        let protection = WorkbookProtection::parse(xml).unwrap();

        assert_eq!(protection.workbook_algorithm_name, HashAlgorithm::Sha256);
        assert_eq!(protection.workbook_hash_value, Some("hash1".to_string()));
        assert_eq!(protection.workbook_salt_value, Some("salt1".to_string()));
        assert_eq!(protection.workbook_spin_count, Some(100000));

        assert_eq!(protection.revisions_algorithm_name, HashAlgorithm::Sha512);
        assert_eq!(protection.revisions_hash_value, Some("hash2".to_string()));
        assert_eq!(protection.revisions_salt_value, Some("salt2".to_string()));
        assert_eq!(protection.revisions_spin_count, Some(200000));
    }

    #[test]
    fn test_parse_workbook_protection_not_found() {
        let xml = b"<workbook><sheets/></workbook>";
        assert!(WorkbookProtection::parse(xml).is_none());
    }

    #[test]
    fn test_parse_workbook_protection_defaults() {
        let xml = b"<workbook><workbookProtection/></workbook>";
        let protection = WorkbookProtection::parse(xml).unwrap();
        assert!(!protection.lock_structure);
        assert!(!protection.lock_windows);
        assert!(!protection.lock_revision);
        assert!(protection.workbook_password.is_none());
        assert!(protection.revisions_password.is_none());
        assert!(!protection.has_password());
        assert!(!protection.has_revisions_password());
    }

    // -------------------------------------------------------------------------
    // FileSharing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_file_sharing_basic() {
        let xml = b"<workbook><fileSharing readOnlyRecommended=\"1\"/></workbook>";
        let sharing = FileSharing::parse(xml).unwrap();
        assert!(sharing.read_only_recommended);
        assert!(sharing.user_name.is_none());
    }

    #[test]
    fn test_parse_file_sharing_with_user() {
        let xml =
            br#"<workbook><fileSharing userName="John Doe" readOnlyRecommended="1"/></workbook>"#;
        let sharing = FileSharing::parse(xml).unwrap();
        assert_eq!(sharing.user_name, Some("John Doe".to_string()));
        assert!(sharing.read_only_recommended);
    }

    #[test]
    fn test_parse_file_sharing_legacy_password() {
        let xml =
            br#"<workbook><fileSharing userName="Admin" reservationPassword="CAFE"/></workbook>"#;
        let sharing = FileSharing::parse(xml).unwrap();
        assert_eq!(sharing.user_name, Some("Admin".to_string()));
        assert_eq!(sharing.reservation_password, Some("CAFE".to_string()));
        assert!(sharing.has_reservation_password());
    }

    #[test]
    fn test_parse_file_sharing_modern_password() {
        let xml = br#"<workbook><fileSharing userName="Admin" algorithmName="SHA-512" hashValue="hash123" saltValue="salt456" spinCount="100000" readOnlyRecommended="1"/></workbook>"#;
        let sharing = FileSharing::parse(xml).unwrap();
        assert_eq!(sharing.user_name, Some("Admin".to_string()));
        assert_eq!(sharing.algorithm_name, HashAlgorithm::Sha512);
        assert_eq!(sharing.hash_value, Some("hash123".to_string()));
        assert_eq!(sharing.salt_value, Some("salt456".to_string()));
        assert_eq!(sharing.spin_count, Some(100000));
        assert!(sharing.read_only_recommended);
        assert!(sharing.has_reservation_password());
    }

    #[test]
    fn test_parse_file_sharing_not_found() {
        let xml = b"<workbook><sheets/></workbook>";
        assert!(FileSharing::parse(xml).is_none());
    }

    #[test]
    fn test_parse_file_sharing_defaults() {
        let xml = b"<workbook><fileSharing/></workbook>";
        let sharing = FileSharing::parse(xml).unwrap();
        assert!(!sharing.read_only_recommended);
        assert!(sharing.user_name.is_none());
        assert!(sharing.reservation_password.is_none());
        assert!(!sharing.has_reservation_password());
    }

    #[test]
    fn test_parse_file_sharing_xml_entities() {
        let xml = br#"<workbook><fileSharing userName="John &amp; Jane"/></workbook>"#;
        let sharing = FileSharing::parse(xml).unwrap();
        assert_eq!(sharing.user_name, Some("John & Jane".to_string()));
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_bool_attr() {
        use crate::infra::xml::parse_bool_attr_opt;
        let xml =
            b"<element attr1=\"1\" attr2=\"true\" attr3=\"0\" attr4=\"false\" attr5=\"TRUE\">";
        assert_eq!(parse_bool_attr_opt(xml, b"attr1=\""), Some(true));
        assert_eq!(parse_bool_attr_opt(xml, b"attr2=\""), Some(true));
        assert_eq!(parse_bool_attr_opt(xml, b"attr3=\""), Some(false));
        assert_eq!(parse_bool_attr_opt(xml, b"attr4=\""), Some(false));
        assert_eq!(parse_bool_attr_opt(xml, b"attr5=\""), Some(true));
        assert_eq!(parse_bool_attr_opt(xml, b"notfound=\""), None);
    }

    #[test]
    fn test_parse_u32_attr() {
        let xml = b"<element count=\"42\" zero=\"0\" large=\"4294967295\">";
        assert_eq!(parse_u32_attr(xml, b"count=\""), Some(42));
        assert_eq!(parse_u32_attr(xml, b"zero=\""), Some(0));
        assert_eq!(parse_u32_attr(xml, b"large=\""), Some(4294967295));
        assert_eq!(parse_u32_attr(xml, b"notfound=\""), None);
    }

    #[test]
    fn test_parse_string_attr() {
        let xml = br#"<element name="hello" msg="&lt;test&gt;" empty="" special="a &amp; b">"#;
        assert_eq!(
            parse_string_attr(xml, b"name=\""),
            Some("hello".to_string())
        );
        assert_eq!(
            parse_string_attr(xml, b"msg=\""),
            Some("<test>".to_string())
        );
        assert_eq!(parse_string_attr(xml, b"empty=\""), Some("".to_string()));
        assert_eq!(
            parse_string_attr(xml, b"special=\""),
            Some("a & b".to_string())
        );
        assert_eq!(parse_string_attr(xml, b"notfound=\""), None);
    }

    #[test]
    fn test_decode_xml_entities() {
        use crate::infra::xml::decode_xml_entities;
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
        assert_eq!(
            decode_xml_entities(b"a &lt; b &amp;&amp; c &gt; d"),
            "a < b && c > d"
        );
        assert_eq!(decode_xml_entities(b"&unknown;"), "&unknown;");
    }

    // -------------------------------------------------------------------------
    // Integration tests with realistic XML
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_realistic_worksheet_protection() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetViews>
        <sheetView tabSelected="1" workbookViewId="0"/>
    </sheetViews>
    <sheetFormatPr defaultRowHeight="15"/>
    <sheetData>
        <row r="1"><c r="A1"><v>Test</v></c></row>
    </sheetData>
    <sheetProtection sheet="1" objects="1" scenarios="1" formatCells="0" formatColumns="0" formatRows="0" insertColumns="1" insertRows="1" insertHyperlinks="1" deleteColumns="1" deleteRows="1" selectLockedCells="0" sort="1" autoFilter="1" pivotTables="1" selectUnlockedCells="0" algorithmName="SHA-512" hashValue="abc123def456" saltValue="xyz789" spinCount="100000"/>
</worksheet>"#;

        let protection = SheetProtection::parse(xml).unwrap();

        // Verify main flag
        assert!(protection.sheet);

        // Verify object flags
        assert!(protection.objects);
        assert!(protection.scenarios);

        // Verify format flags (false in XML means not prohibited)
        assert!(!protection.format_cells);
        assert!(!protection.format_columns);
        assert!(!protection.format_rows);

        // Verify insert flags
        assert!(protection.insert_columns);
        assert!(protection.insert_rows);
        assert!(protection.insert_hyperlinks);

        // Verify delete flags
        assert!(protection.delete_columns);
        assert!(protection.delete_rows);

        // Verify data flags
        assert!(protection.sort);
        assert!(protection.auto_filter);
        assert!(protection.pivot_tables);

        // Verify selection flags
        assert!(!protection.select_locked_cells);
        assert!(!protection.select_unlocked_cells);

        // Verify password attributes
        assert_eq!(protection.algorithm_name, HashAlgorithm::Sha512);
        assert_eq!(protection.hash_value, Some("abc123def456".to_string()));
        assert_eq!(protection.salt_value, Some("xyz789".to_string()));
        assert_eq!(protection.spin_count, Some(100000));
        assert!(protection.uses_modern_protection());
    }

    #[test]
    fn test_parse_realistic_workbook_protection() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="24729"/>
    <workbookProtection lockStructure="1" lockWindows="0" lockRevision="1" workbookAlgorithmName="SHA-256" workbookHashValue="workbookHash" workbookSaltValue="workbookSalt" workbookSpinCount="100000" revisionsAlgorithmName="SHA-512" revisionsHashValue="revisionsHash" revisionsSaltValue="revisionsSalt" revisionsSpinCount="200000"/>
    <fileSharing userName="John Doe" readOnlyRecommended="1" algorithmName="SHA-1" hashValue="sharingHash" saltValue="sharingSalt" spinCount="50000"/>
    <sheets>
        <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
    </sheets>
</workbook>"#;

        // Parse workbook protection
        let wb_protection = WorkbookProtection::parse(xml).unwrap();
        assert!(wb_protection.lock_structure);
        assert!(!wb_protection.lock_windows);
        assert!(wb_protection.lock_revision);
        assert_eq!(wb_protection.workbook_algorithm_name, HashAlgorithm::Sha256);
        assert_eq!(
            wb_protection.workbook_hash_value,
            Some("workbookHash".to_string())
        );
        assert_eq!(
            wb_protection.workbook_salt_value,
            Some("workbookSalt".to_string())
        );
        assert_eq!(wb_protection.workbook_spin_count, Some(100000));
        assert_eq!(
            wb_protection.revisions_algorithm_name,
            HashAlgorithm::Sha512
        );
        assert_eq!(
            wb_protection.revisions_hash_value,
            Some("revisionsHash".to_string())
        );
        assert_eq!(
            wb_protection.revisions_salt_value,
            Some("revisionsSalt".to_string())
        );
        assert_eq!(wb_protection.revisions_spin_count, Some(200000));

        // Parse file sharing
        let sharing = FileSharing::parse(xml).unwrap();
        assert_eq!(sharing.user_name, Some("John Doe".to_string()));
        assert!(sharing.read_only_recommended);
        assert_eq!(sharing.algorithm_name, HashAlgorithm::Sha1);
        assert_eq!(sharing.hash_value, Some("sharingHash".to_string()));
        assert_eq!(sharing.salt_value, Some("sharingSalt".to_string()));
        assert_eq!(sharing.spin_count, Some(50000));
    }

    #[test]
    fn test_parse_malformed_xml_graceful_handling() {
        // Missing closing quote - should still find some attributes
        let xml = b"<sheetProtection sheet=\"1 objects=\"1\"/>";
        let protection = SheetProtection::parse(xml);
        // Should not panic, may return partial results
        let _ = protection;
    }

    #[test]
    fn test_parse_empty_protection_elements() {
        let ws_xml = b"<worksheet><sheetProtection></sheetProtection></worksheet>";
        let protection = SheetProtection::parse(ws_xml);
        assert!(protection.is_some());

        let wb_xml = b"<workbook><workbookProtection></workbookProtection></workbook>";
        let protection = WorkbookProtection::parse(wb_xml);
        assert!(protection.is_some());

        let fs_xml = b"<workbook><fileSharing></fileSharing></workbook>";
        let sharing = FileSharing::parse(fs_xml);
        assert!(sharing.is_some());
    }

    #[test]
    fn test_sheet_protection_has_password_methods() {
        // No password
        let xml1 = b"<worksheet><sheetProtection sheet=\"1\"/></worksheet>";
        let p1 = SheetProtection::parse(xml1).unwrap();
        assert!(!p1.has_password());
        assert!(!p1.uses_modern_protection());

        // Legacy password only
        let xml2 = b"<worksheet><sheetProtection sheet=\"1\" password=\"CC2A\"/></worksheet>";
        let p2 = SheetProtection::parse(xml2).unwrap();
        assert!(p2.has_password());
        assert!(!p2.uses_modern_protection());

        // Modern password
        let xml3 = br#"<worksheet><sheetProtection sheet="1" algorithmName="SHA-512" hashValue="test"/></worksheet>"#;
        let p3 = SheetProtection::parse(xml3).unwrap();
        assert!(p3.has_password());
        assert!(p3.uses_modern_protection());

        // Algorithm without hash (invalid but handle gracefully)
        let xml4 =
            br#"<worksheet><sheetProtection sheet="1" algorithmName="SHA-512"/></worksheet>"#;
        let p4 = SheetProtection::parse(xml4).unwrap();
        assert!(!p4.has_password());
        assert!(!p4.uses_modern_protection());
    }

    #[test]
    fn test_workbook_protection_has_password_methods() {
        // No password
        let xml1 = b"<workbook><workbookProtection lockStructure=\"1\"/></workbook>";
        let p1 = WorkbookProtection::parse(xml1).unwrap();
        assert!(!p1.has_password());
        assert!(!p1.has_revisions_password());

        // Legacy passwords
        let xml2 = b"<workbook><workbookProtection workbookPassword=\"ABCD\" revisionsPassword=\"EF12\"/></workbook>";
        let p2 = WorkbookProtection::parse(xml2).unwrap();
        assert!(p2.has_password());
        assert!(p2.has_revisions_password());

        // Modern password for workbook only
        let xml3 = br#"<workbook><workbookProtection workbookHashValue="test"/></workbook>"#;
        let p3 = WorkbookProtection::parse(xml3).unwrap();
        assert!(p3.has_password());
        assert!(!p3.has_revisions_password());
    }

    #[test]
    fn test_file_sharing_has_reservation_password() {
        // No password
        let xml1 = b"<workbook><fileSharing readOnlyRecommended=\"1\"/></workbook>";
        let s1 = FileSharing::parse(xml1).unwrap();
        assert!(!s1.has_reservation_password());

        // Legacy password
        let xml2 = b"<workbook><fileSharing reservationPassword=\"CAFE\"/></workbook>";
        let s2 = FileSharing::parse(xml2).unwrap();
        assert!(s2.has_reservation_password());

        // Modern password
        let xml3 = br#"<workbook><fileSharing hashValue="test"/></workbook>"#;
        let s3 = FileSharing::parse(xml3).unwrap();
        assert!(s3.has_reservation_password());
    }
}
