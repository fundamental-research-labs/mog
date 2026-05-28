//! Protection Writer for XLSX worksheets and workbooks.
//!
//! This module generates protection-related XML elements for XLSX files
//! according to the ECMA-376 specification (Office Open XML).

mod domain_sheet;
mod password;
mod ranges;
mod sheet;
mod workbook;

pub use domain_sheet::sheet_protection_xml_from_domain;
pub use ooxml_types::protection::{HashAlgorithm, SheetProtection, WorkbookProtection};
pub use password::{generate_salt, hash_password_legacy, hash_password_sha512};
pub use ranges::{ProtectedRange, ProtectedRanges};
pub use sheet::SheetProtectionWrite;
pub use workbook::WorkbookProtectionWrite;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_sheet_protection() {
        let mut protection = SheetProtection::with_password_sha512("secretpass", 100000);
        protection
            .allow_format_cells(true)
            .allow_format_columns(true)
            .allow_select_unlocked(true)
            .allow_sort(true)
            .allow_auto_filter(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("<sheetProtection"));
        assert!(xml.contains("algorithmName=\"SHA-512\""));
        assert!(xml.contains("sheet=\"1\""));
        assert!(xml.contains("formatCells=\"0\""));
        assert!(xml.contains("formatColumns=\"0\""));
        assert!(xml.contains("selectUnlockedCells=\"0\""));
        assert!(xml.contains("sort=\"0\""));
        assert!(xml.contains("autoFilter=\"0\""));
        assert!(xml.contains("/>"));
    }

    #[test]
    fn complete_workbook_protection() {
        let mut protection = WorkbookProtection::with_password("wbpass");
        protection.set_lock_structure(true).set_lock_windows(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("<workbookProtection"));
        assert!(xml.contains("workbookPassword=\""));
        assert!(xml.contains("lockStructure=\"1\""));
        assert!(xml.contains("lockWindows=\"1\""));
        assert!(xml.contains("/>"));
    }

    #[test]
    fn complete_protected_ranges() {
        let mut ranges = ProtectedRanges::new();

        ranges.add_unprotected("PublicArea", "A1:D10");
        ranges.add_with_password("PrivateArea", "E1:H10", "secret");
        ranges.add(ProtectedRange::with_password_sha512(
            "SecureArea",
            "I1:L10",
            "verysecret",
            100000,
        ));

        let xml = String::from_utf8(ranges.to_xml()).unwrap();

        assert!(xml.contains("<protectedRanges>"));
        assert_eq!(xml.matches("<protectedRange ").count(), 3);
        assert!(xml.contains("name=\"PublicArea\""));
        assert!(xml.contains("name=\"PrivateArea\""));
        assert!(xml.contains("name=\"SecureArea\""));
        assert!(xml.contains("algorithmName=\"SHA-512\""));
        assert!(xml.contains("</protectedRanges>"));
    }

    #[test]
    fn facade_imports_remain_available() {
        use crate::write::{
            ProtectedRange as WriteProtectedRange, ProtectedRanges as WriteProtectedRanges,
            SheetProtection as WriteSheetProtection,
            SheetProtectionWrite as WriteSheetProtectionWrite,
            WorkbookProtection as WriteWorkbookProtection,
            WorkbookProtectionWrite as WriteWorkbookProtectionWrite,
            generate_salt as write_generate_salt,
            hash_password_legacy as write_hash_password_legacy,
            hash_password_sha512 as write_hash_password_sha512,
        };

        fn accepts_domain_exports(
            _: SheetProtection,
            _: WorkbookProtection,
            _: ProtectedRange,
            _: ProtectedRanges,
        ) {
        }

        accepts_domain_exports(
            SheetProtection::new(),
            WorkbookProtection::new(),
            ProtectedRange::new("EditableArea", "A1:D10"),
            ProtectedRanges::new(),
        );

        let _sheet_trait: fn(&SheetProtection) -> Vec<u8> = SheetProtectionWrite::to_xml;
        let _workbook_trait: fn(&WorkbookProtection) -> Vec<u8> = WorkbookProtectionWrite::to_xml;
        let _legacy: fn(&str) -> String = hash_password_legacy;
        let _modern: fn(&str, &[u8], u32) -> (String, String) = hash_password_sha512;
        let _salt: fn() -> [u8; 16] = generate_salt;
        let _domain: fn(&domain_types::SheetProtection) -> String =
            sheet_protection_xml_from_domain;

        let _write_sheet = WriteSheetProtection::new();
        let _write_workbook = WriteWorkbookProtection::new();
        let _write_range = WriteProtectedRange::new("EditableArea", "A1:D10");
        let _write_ranges = WriteProtectedRanges::new();
        let _write_sheet_trait: fn(&WriteSheetProtection) -> Vec<u8> =
            WriteSheetProtectionWrite::to_xml;
        let _write_workbook_trait: fn(&WriteWorkbookProtection) -> Vec<u8> =
            WriteWorkbookProtectionWrite::to_xml;
        let _write_legacy: fn(&str) -> String = write_hash_password_legacy;
        let _write_modern: fn(&str, &[u8], u32) -> (String, String) = write_hash_password_sha512;
        let _write_salt: fn() -> [u8; 16] = write_generate_salt;
    }
}
