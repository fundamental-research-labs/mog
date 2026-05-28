//! VBA Project detection and metadata extraction for XLSM files.
//!
//! This facade preserves the existing `domain::vba::read::*` API while the
//! parser implementation is split into focused modules.
//!
//! # Security Note
//!
//! This module does not execute VBA macros, validate signatures
//! cryptographically, or emit macro payloads. VBA content is treated as opaque
//! binary data for detection and metadata reporting.

mod archive;
mod modules;
mod ole;
mod signature;
mod workbook_xml;

pub use super::constants::{
    VBA_RELATIONSHIP_TYPE, XLSM_CONTENT_TYPE, is_macro_extension, vba_project_path,
    workbook_rels_path,
};
pub use super::types::{
    SheetCodeName, SignatureStatus, VbaModule, VbaModuleType, VbaProject, VbaReference,
    VbaReferenceType, VbaRelationship,
};
pub use archive::{detect_vba, has_vba, is_macro_enabled_workbook};
pub use workbook_xml::{detect_vba_relationship, extract_sheet_code_names};

#[cfg(test)]
mod tests {
    #[test]
    fn facade_exports_public_items() {
        use super::*;

        let _project = VbaProject::default();
        let _module = VbaModule::default();
        let _reference = VbaReference::default();
        let _relationship = VbaRelationship::default();
        let _sheet_code_name = SheetCodeName::default();
        let _module_type = VbaModuleType::default();
        let _reference_type = VbaReferenceType::default();
        let _signature_status = SignatureStatus::default();

        assert_eq!(vba_project_path(), "xl/vbaProject.bin");
        assert_eq!(workbook_rels_path(), "xl/_rels/workbook.xml.rels");
        assert!(is_macro_extension("xlsm"));
        assert_eq!(
            VBA_RELATIONSHIP_TYPE,
            "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
        );
        assert_eq!(
            XLSM_CONTENT_TYPE,
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
        );
    }

    #[test]
    fn domain_vba_exports_public_items() {
        use crate::domain::vba::*;

        let _project = VbaProject::default();
        let _module = VbaModule::default();
        let _reference = VbaReference::default();
        let _relationship = VbaRelationship::default();
        let _sheet_code_name = SheetCodeName::default();
        let _module_type = VbaModuleType::default();
        let _reference_type = VbaReferenceType::default();
        let _signature_status = SignatureStatus::default();

        assert_eq!(vba_project_path(), "xl/vbaProject.bin");
        assert_eq!(workbook_rels_path(), "xl/_rels/workbook.xml.rels");
        assert!(is_macro_extension("xlsm"));
    }
}
