use super::super::error::ZipError;
use super::XlsxArchive;

impl<'a> XlsxArchive<'a> {
    /// Get the shared strings XML file (xl/sharedStrings.xml)
    ///
    /// This file contains all unique strings used in the spreadsheet.
    pub fn get_shared_strings(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("xl/sharedStrings.xml")
    }

    /// Get a worksheet by 1-based index (xl/worksheets/sheet{N}.xml)
    ///
    /// # Arguments
    /// * `index` - 1-based worksheet index (sheet1, sheet2, etc.)
    pub fn get_worksheet(&self, index: usize) -> Result<Vec<u8>, ZipError> {
        let name = format!("xl/worksheets/sheet{}.xml", index);
        self.read_file(&name)
    }

    /// Get the styles XML file (xl/styles.xml)
    ///
    /// This file contains cell formatting, number formats, fonts, etc.
    pub fn get_styles(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("xl/styles.xml")
    }

    /// Get the workbook XML file (xl/workbook.xml)
    ///
    /// This file contains sheet names, defined names, and workbook settings.
    pub fn get_workbook(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("xl/workbook.xml")
    }

    /// Count the number of worksheets in the archive
    ///
    /// Counts files matching the pattern xl/worksheets/sheet*.xml
    pub fn worksheet_count(&self) -> usize {
        self.entries
            .iter()
            .filter(|e| e.name.starts_with("xl/worksheets/sheet") && e.name.ends_with(".xml"))
            .count()
    }

    /// List all worksheet names (just the sheet*.xml filenames)
    pub fn worksheet_names(&self) -> Vec<&str> {
        self.entries
            .iter()
            .filter_map(|e| {
                if e.name.starts_with("xl/worksheets/sheet") && e.name.ends_with(".xml") {
                    e.name.strip_prefix("xl/worksheets/")
                } else {
                    None
                }
            })
            .collect()
    }

    /// Get the relationships file for the workbook
    pub fn get_workbook_rels(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("xl/_rels/workbook.xml.rels")
    }

    /// Get the content types file
    pub fn get_content_types(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("[Content_Types].xml")
    }

    /// Get the shared strings file path
    pub fn shared_strings_path() -> &'static str {
        "xl/sharedStrings.xml"
    }

    /// Get the workbook file path
    pub fn workbook_path() -> &'static str {
        "xl/workbook.xml"
    }

    /// Get the worksheet file path for a given sheet number (1-indexed)
    pub fn worksheet_path(sheet_num: u32) -> String {
        format!("xl/worksheets/sheet{}.xml", sheet_num)
    }

    /// Get the styles file path
    pub fn styles_path() -> &'static str {
        "xl/styles.xml"
    }
}
