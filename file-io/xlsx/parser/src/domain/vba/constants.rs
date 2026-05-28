//! VBA constants and archive path helpers.

/// OLE compound document magic number (first 8 bytes).
pub(super) const OLE_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// Standard sector size (512 bytes).
pub(super) const SECTOR_SIZE_512: usize = 512;

/// Mini sector size (64 bytes).
#[cfg(test)]
const MINI_SECTOR_SIZE: usize = 64;

/// Directory entry size (128 bytes).
pub(super) const DIRECTORY_ENTRY_SIZE: usize = 128;

/// End of chain marker in FAT.
pub(super) const END_OF_CHAIN: u32 = 0xFFFFFFFE;

/// Free sector marker in FAT.
#[allow(dead_code)]
pub(super) const FREE_SECTOR: u32 = 0xFFFFFFFF;

/// VBA dir stream record types.
#[cfg(test)]
mod dir_record {
    pub const PROJECT_NAME: u16 = 0x0004;
    pub const MODULE_NAME: u16 = 0x0019;
    pub const TERMINATOR: u16 = 0x0010;
    pub const CODE_PAGE: u16 = 0x0003;
}

/// Relationship type for VBA projects.
pub use crate::infra::opc::REL_VBA_PROJECT as VBA_RELATIONSHIP_TYPE;

/// Content type for macro-enabled workbooks.
pub const XLSM_CONTENT_TYPE: &str = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";

/// Get the standard VBA project path in XLSX archives.
#[inline]
pub fn vba_project_path() -> &'static str {
    "xl/vbaProject.bin"
}

/// Get the workbook relationships path.
#[inline]
pub fn workbook_rels_path() -> &'static str {
    "xl/_rels/workbook.xml.rels"
}

/// Check if a file extension indicates a macro-enabled format.
pub fn is_macro_extension(extension: &str) -> bool {
    let lower = extension.to_lowercase();
    matches!(lower.as_str(), "xlsm" | "xltm" | "xlam" | "xlsb")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ole_magic() {
        assert_eq!(OLE_MAGIC.len(), 8);
        assert_eq!(OLE_MAGIC[0], 0xD0);
        assert_eq!(OLE_MAGIC[7], 0xE1);
    }

    #[test]
    fn test_sector_constants() {
        assert_eq!(SECTOR_SIZE_512, 512);
        assert_eq!(MINI_SECTOR_SIZE, 64);
        assert_eq!(DIRECTORY_ENTRY_SIZE, 128);
        assert_eq!(END_OF_CHAIN, 0xFFFFFFFE);
        assert_eq!(FREE_SECTOR, 0xFFFFFFFF);
    }

    #[test]
    fn test_vba_relationship_type_constant() {
        assert_eq!(
            VBA_RELATIONSHIP_TYPE,
            "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
        );
    }

    #[test]
    fn test_xlsm_content_type_constant() {
        assert_eq!(
            XLSM_CONTENT_TYPE,
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
        );
    }

    #[test]
    fn test_vba_project_path() {
        assert_eq!(vba_project_path(), "xl/vbaProject.bin");
    }

    #[test]
    fn test_workbook_rels_path() {
        assert_eq!(workbook_rels_path(), "xl/_rels/workbook.xml.rels");
    }

    #[test]
    fn test_is_macro_extension() {
        assert!(is_macro_extension("xlsm"));
        assert!(is_macro_extension("XLSM"));
        assert!(is_macro_extension("xltm"));
        assert!(is_macro_extension("xlam"));
        assert!(is_macro_extension("xlsb"));
        assert!(!is_macro_extension("xlsx"));
        assert!(!is_macro_extension("xls"));
        assert!(!is_macro_extension("csv"));
        assert!(!is_macro_extension(""));
    }

    #[test]
    fn test_dir_record_constants() {
        assert_eq!(dir_record::PROJECT_NAME, 0x0004);
        assert_eq!(dir_record::MODULE_NAME, 0x0019);
        assert_eq!(dir_record::TERMINATOR, 0x0010);
        assert_eq!(dir_record::CODE_PAGE, 0x0003);
    }
}
