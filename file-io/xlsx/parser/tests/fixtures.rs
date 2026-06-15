//! Test fixture generation for XLSX files
//!
//! This module provides utilities for creating valid XLSX files in memory
//! for testing purposes. XLSX files are ZIP archives containing XML files
//! with a specific structure.

use miniz_oxide::deflate::compress_to_vec;

// ZIP file format constants
const LOCAL_FILE_HEADER_SIGNATURE: u32 = 0x04034b50;
const CENTRAL_FILE_HEADER_SIGNATURE: u32 = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE: u32 = 0x06054b50;
const COMPRESSION_STORE: u16 = 0;
const COMPRESSION_DEFLATE: u16 = 8;

/// Simple CRC32 implementation for ZIP file creation
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFFFFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

/// Entry to add to the ZIP archive
struct ZipFileEntry {
    name: String,
    content: Vec<u8>,
    compressed: Vec<u8>,
    compression_method: u16,
    crc: u32,
}

/// Builder for creating ZIP/XLSX files in memory
pub struct ZipBuilder {
    entries: Vec<ZipFileEntry>,
}

impl ZipBuilder {
    /// Create a new empty ZIP builder
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Add a file with STORE compression (no compression)
    pub fn add_stored(&mut self, name: &str, content: &[u8]) -> &mut Self {
        let crc = crc32(content);
        self.entries.push(ZipFileEntry {
            name: name.to_string(),
            content: content.to_vec(),
            compressed: content.to_vec(),
            compression_method: COMPRESSION_STORE,
            crc,
        });
        self
    }

    /// Add a file with DEFLATE compression
    pub fn add_deflate(&mut self, name: &str, content: &[u8]) -> &mut Self {
        let crc = crc32(content);
        let compressed = compress_to_vec(content, 6);
        self.entries.push(ZipFileEntry {
            name: name.to_string(),
            content: content.to_vec(),
            compressed,
            compression_method: COMPRESSION_DEFLATE,
            crc,
        });
        self
    }

    /// Build the final ZIP file as bytes
    pub fn build(&self) -> Vec<u8> {
        let mut zip = Vec::new();
        let mut entry_metadata: Vec<(usize, &ZipFileEntry)> = Vec::new();

        // Write all local file headers and data
        for entry in &self.entries {
            let local_offset = zip.len();
            let name_bytes = entry.name.as_bytes();

            // Local file header
            zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
            zip.extend_from_slice(&20u16.to_le_bytes()); // version needed
            zip.extend_from_slice(&0u16.to_le_bytes()); // flags
            zip.extend_from_slice(&entry.compression_method.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes()); // mod time
            zip.extend_from_slice(&0u16.to_le_bytes()); // mod date
            zip.extend_from_slice(&entry.crc.to_le_bytes());
            zip.extend_from_slice(&(entry.compressed.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(entry.content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes()); // extra length
            zip.extend_from_slice(name_bytes);
            zip.extend_from_slice(&entry.compressed);

            entry_metadata.push((local_offset, entry));
        }

        let cd_offset = zip.len();

        // Write central directory entries
        for (local_offset, entry) in &entry_metadata {
            let name_bytes = entry.name.as_bytes();

            zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
            zip.extend_from_slice(&20u16.to_le_bytes()); // version made by
            zip.extend_from_slice(&20u16.to_le_bytes()); // version needed
            zip.extend_from_slice(&0u16.to_le_bytes()); // flags
            zip.extend_from_slice(&entry.compression_method.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes()); // mod time
            zip.extend_from_slice(&0u16.to_le_bytes()); // mod date
            zip.extend_from_slice(&entry.crc.to_le_bytes());
            zip.extend_from_slice(&(entry.compressed.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(entry.content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes()); // extra length
            zip.extend_from_slice(&0u16.to_le_bytes()); // comment length
            zip.extend_from_slice(&0u16.to_le_bytes()); // disk number
            zip.extend_from_slice(&0u16.to_le_bytes()); // internal attributes
            zip.extend_from_slice(&0u32.to_le_bytes()); // external attributes
            zip.extend_from_slice(&(*local_offset as u32).to_le_bytes());
            zip.extend_from_slice(name_bytes);
        }

        let cd_size = zip.len() - cd_offset;

        // End of central directory
        zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes()); // disk number
        zip.extend_from_slice(&0u16.to_le_bytes()); // disk with CD
        zip.extend_from_slice(&(self.entries.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(self.entries.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
        zip.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes()); // comment length

        zip
    }
}

impl Default for ZipBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate the [Content_Types].xml file for XLSX
fn content_types_xml() -> Vec<u8> {
    br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>"#.to_vec()
}

/// Generate the _rels/.rels file for XLSX
fn root_rels_xml() -> Vec<u8> {
    br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#.to_vec()
}

/// Generate the xl/_rels/workbook.xml.rels file for XLSX
fn workbook_rels_xml(sheet_count: usize, has_shared_strings: bool) -> Vec<u8> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );

    for i in 1..=sheet_count {
        xml.push_str(&format!(
            r#"
  <Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{}.xml"/>"#,
            i, i
        ));
    }

    if has_shared_strings {
        xml.push_str(&format!(
            r#"
  <Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>"#,
            sheet_count + 1
        ));
    }

    xml.push_str("\n</Relationships>");
    xml.into_bytes()
}

/// Generate the xl/workbook.xml file for XLSX
fn workbook_xml(sheet_names: &[&str]) -> Vec<u8> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>"#,
    );

    for (i, name) in sheet_names.iter().enumerate() {
        xml.push_str(&format!(
            r#"
    <sheet name="{}" sheetId="{}" r:id="rId{}"/>"#,
            name,
            i + 1,
            i + 1
        ));
    }

    xml.push_str(
        r#"
  </sheets>
</workbook>"#,
    );
    xml.into_bytes()
}

/// Generate a shared strings XML file
pub fn shared_strings_xml(strings: &[&str]) -> Vec<u8> {
    let mut xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{}" uniqueCount="{}">"#,
        strings.len(),
        strings.len()
    );

    for s in strings {
        // Escape XML entities
        let escaped = s
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;");
        xml.push_str(&format!("\n  <si><t>{}</t></si>", escaped));
    }

    xml.push_str("\n</sst>");
    xml.into_bytes()
}

/// Cell value types for worksheet generation
#[derive(Debug, Clone)]
pub enum CellValue {
    /// Numeric value
    Number(f64),
    /// String value (will be stored in shared strings)
    String(String),
    /// Boolean value
    Boolean(bool),
    /// Error value
    Error(String),
    /// Formula with cached value
    Formula { formula: String, cached_value: f64 },
    /// Empty cell (no value)
    Empty,
}

/// Convert column index to Excel column letters (0 -> A, 25 -> Z, 26 -> AA, etc.)
pub fn col_to_letters(col: usize) -> String {
    let mut result = String::new();
    let mut c = col + 1;
    while c > 0 {
        c -= 1;
        result.insert(0, (b'A' + (c % 26) as u8) as char);
        c /= 26;
    }
    result
}

/// Generate a worksheet XML file
pub fn worksheet_xml(
    cells: &[((usize, usize), CellValue)],
    shared_string_map: &std::collections::HashMap<String, usize>,
) -> Vec<u8> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>"#,
    );

    // Group cells by row
    let mut rows: std::collections::BTreeMap<usize, Vec<(usize, &CellValue)>> =
        std::collections::BTreeMap::new();
    for ((row, col), value) in cells {
        rows.entry(*row).or_default().push((*col, value));
    }

    for (row, mut cells_in_row) in rows {
        cells_in_row.sort_by_key(|(col, _)| *col);
        xml.push_str(&format!("\n    <row r=\"{}\">", row + 1));

        for (col, value) in cells_in_row {
            let cell_ref = format!("{}{}", col_to_letters(col), row + 1);

            match value {
                CellValue::Number(n) => {
                    xml.push_str(&format!("\n      <c r=\"{}\"><v>{}</v></c>", cell_ref, n));
                }
                CellValue::String(s) => {
                    if let Some(&idx) = shared_string_map.get(s) {
                        xml.push_str(&format!(
                            "\n      <c r=\"{}\" t=\"s\"><v>{}</v></c>",
                            cell_ref, idx
                        ));
                    }
                }
                CellValue::Boolean(b) => {
                    xml.push_str(&format!(
                        "\n      <c r=\"{}\" t=\"b\"><v>{}</v></c>",
                        cell_ref,
                        if *b { 1 } else { 0 }
                    ));
                }
                CellValue::Error(e) => {
                    xml.push_str(&format!(
                        "\n      <c r=\"{}\" t=\"e\"><v>{}</v></c>",
                        cell_ref, e
                    ));
                }
                CellValue::Formula {
                    formula,
                    cached_value,
                } => {
                    xml.push_str(&format!(
                        "\n      <c r=\"{}\"><f>{}</f><v>{}</v></c>",
                        cell_ref, formula, cached_value
                    ));
                }
                CellValue::Empty => {
                    xml.push_str(&format!("\n      <c r=\"{}\"/>", cell_ref));
                }
            }
        }

        xml.push_str("\n    </row>");
    }

    xml.push_str(
        r#"
  </sheetData>
</worksheet>"#,
    );
    xml.into_bytes()
}

/// Create a minimal valid XLSX file in memory with a single empty sheet
pub fn create_minimal_xlsx() -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    let worksheet = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
  </sheetData>
</worksheet>"#;

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml())
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, false))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", worksheet);

    builder.build()
}

/// Create an XLSX file with caller-provided raw worksheet XML.
pub fn create_xlsx_with_raw_worksheet_xml(worksheet: &[u8], shared_strings: &[&str]) -> Vec<u8> {
    let mut builder = ZipBuilder::new();
    let has_shared_strings = !shared_strings.is_empty();

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml())
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate(
            "xl/_rels/workbook.xml.rels",
            &workbook_rels_xml(1, has_shared_strings),
        )
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", worksheet);

    if has_shared_strings {
        builder.add_deflate("xl/sharedStrings.xml", &shared_strings_xml(shared_strings));
    }

    builder.build()
}

/// Create an XLSX file with shared strings
pub fn create_xlsx_with_shared_strings(
    strings: &[&str],
    cells: &[((usize, usize), usize)],
) -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    // Build shared string map
    let shared_string_map: std::collections::HashMap<String, usize> = strings
        .iter()
        .enumerate()
        .map(|(i, s)| (s.to_string(), i))
        .collect();

    // Convert cell references to CellValue
    let cell_values: Vec<((usize, usize), CellValue)> = cells
        .iter()
        .map(|((row, col), idx)| ((*row, *col), CellValue::String(strings[*idx].to_string())))
        .collect();

    let worksheet = worksheet_xml(&cell_values, &shared_string_map);
    let shared_strings = shared_strings_xml(strings);

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml())
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, true))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", &worksheet)
        .add_deflate("xl/sharedStrings.xml", &shared_strings);

    builder.build()
}

/// Create an XLSX file with multiple sheets
pub fn create_xlsx_with_multiple_sheets(
    sheet_data: &[(&str, Vec<((usize, usize), CellValue)>)],
) -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    // Collect all strings across all sheets for shared strings
    let mut all_strings: Vec<String> = Vec::new();
    for (_, cells) in sheet_data {
        for ((_, _), value) in cells {
            if let CellValue::String(s) = value {
                if !all_strings.contains(s) {
                    all_strings.push(s.clone());
                }
            }
        }
    }

    let shared_string_map: std::collections::HashMap<String, usize> = all_strings
        .iter()
        .enumerate()
        .map(|(i, s)| (s.clone(), i))
        .collect();

    let sheet_names: Vec<&str> = sheet_data.iter().map(|(name, _)| *name).collect();
    let has_shared_strings = !all_strings.is_empty();

    // Add content types with multiple sheets
    let mut content_types = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>"#,
    );

    for i in 1..=sheet_data.len() {
        content_types.push_str(&format!(
            r#"
  <Override PartName="/xl/worksheets/sheet{}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#,
            i
        ));
    }

    if has_shared_strings {
        content_types.push_str(r#"
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>"#);
    }

    content_types.push_str("\n</Types>");

    builder
        .add_deflate("[Content_Types].xml", content_types.as_bytes())
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate(
            "xl/_rels/workbook.xml.rels",
            &workbook_rels_xml(sheet_data.len(), has_shared_strings),
        )
        .add_deflate("xl/workbook.xml", &workbook_xml(&sheet_names));

    // Add each worksheet
    for (i, (_, cells)) in sheet_data.iter().enumerate() {
        let worksheet = worksheet_xml(cells, &shared_string_map);
        builder.add_deflate(&format!("xl/worksheets/sheet{}.xml", i + 1), &worksheet);
    }

    // Add shared strings if any
    if has_shared_strings {
        let string_refs: Vec<&str> = all_strings.iter().map(|s| s.as_str()).collect();
        builder.add_deflate("xl/sharedStrings.xml", &shared_strings_xml(&string_refs));
    }

    builder.build()
}

/// Create an XLSX file with specified number of cells for benchmarking
pub fn create_xlsx_with_cells(rows: usize, cols: usize) -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    // Generate cell data with a mix of numbers and strings
    let mut cells: Vec<((usize, usize), CellValue)> = Vec::with_capacity(rows * cols);
    let mut strings: Vec<String> = Vec::new();
    let mut shared_string_map: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();

    for row in 0..rows {
        for col in 0..cols {
            // Alternate between numbers and strings
            if (row + col) % 3 == 0 {
                // String value
                let s = format!("Cell_R{}C{}", row + 1, col + 1);
                if !shared_string_map.contains_key(&s) {
                    shared_string_map.insert(s.clone(), strings.len());
                    strings.push(s.clone());
                }
                cells.push(((row, col), CellValue::String(s)));
            } else if (row + col) % 3 == 1 {
                // Number value
                cells.push(((row, col), CellValue::Number((row * cols + col) as f64)));
            } else {
                // Boolean value (less common)
                cells.push(((row, col), CellValue::Boolean((row + col) % 2 == 0)));
            }
        }
    }

    let worksheet = worksheet_xml(&cells, &shared_string_map);
    let string_refs: Vec<&str> = strings.iter().map(|s| s.as_str()).collect();
    let shared_strings = shared_strings_xml(&string_refs);

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml())
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, true))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", &worksheet)
        .add_deflate("xl/sharedStrings.xml", &shared_strings);

    builder.build()
}

/// Create an XLSX file with various cell types for testing
pub fn create_xlsx_with_various_types() -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    let cells: Vec<((usize, usize), CellValue)> = vec![
        // Numbers
        ((0, 0), CellValue::Number(42.0)),
        ((0, 1), CellValue::Number(3.14159)),
        ((0, 2), CellValue::Number(-100.5)),
        ((0, 3), CellValue::Number(0.0)),
        // Strings
        ((1, 0), CellValue::String("Hello".to_string())),
        ((1, 1), CellValue::String("World".to_string())),
        (
            (1, 2),
            CellValue::String("Special chars: <>&\"'".to_string()),
        ),
        ((1, 3), CellValue::String("Unicode: ".to_string())),
        // Booleans
        ((2, 0), CellValue::Boolean(true)),
        ((2, 1), CellValue::Boolean(false)),
        // Errors
        ((3, 0), CellValue::Error("#DIV/0!".to_string())),
        ((3, 1), CellValue::Error("#VALUE!".to_string())),
        ((3, 2), CellValue::Error("#REF!".to_string())),
        // Formulas
        (
            (4, 0),
            CellValue::Formula {
                formula: "SUM(A1:D1)".to_string(),
                cached_value: 45.14159,
            },
        ),
        (
            (4, 1),
            CellValue::Formula {
                formula: "A1*2".to_string(),
                cached_value: 84.0,
            },
        ),
        // Empty
        ((5, 0), CellValue::Empty),
    ];

    // Collect strings
    let strings: Vec<String> = cells
        .iter()
        .filter_map(|(_, v)| {
            if let CellValue::String(s) = v {
                Some(s.clone())
            } else {
                None
            }
        })
        .collect();

    let shared_string_map: std::collections::HashMap<String, usize> = strings
        .iter()
        .enumerate()
        .map(|(i, s)| (s.clone(), i))
        .collect();

    let worksheet = worksheet_xml(&cells, &shared_string_map);
    let string_refs: Vec<&str> = strings.iter().map(|s| s.as_str()).collect();
    let shared_strings = shared_strings_xml(&string_refs);

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml())
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, true))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", &worksheet)
        .add_deflate("xl/sharedStrings.xml", &shared_strings);

    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crc32() {
        assert_eq!(crc32(b""), 0x00000000);
        assert_eq!(crc32(b"123456789"), 0xCBF43926);
    }

    #[test]
    fn test_col_to_letters() {
        assert_eq!(col_to_letters(0), "A");
        assert_eq!(col_to_letters(25), "Z");
        assert_eq!(col_to_letters(26), "AA");
        assert_eq!(col_to_letters(27), "AB");
        assert_eq!(col_to_letters(701), "ZZ");
        assert_eq!(col_to_letters(702), "AAA");
    }

    #[test]
    fn test_zip_builder() {
        let mut builder = ZipBuilder::new();
        builder
            .add_stored("test.txt", b"Hello, World!")
            .add_deflate("compressed.txt", b"This should be compressed!");

        let zip = builder.build();

        // Verify ZIP starts with PK signature
        assert_eq!(&zip[0..4], b"PK\x03\x04");
    }

    #[test]
    fn test_create_minimal_xlsx() {
        let xlsx = create_minimal_xlsx();

        // Verify ZIP signature
        assert_eq!(&xlsx[0..4], b"PK\x03\x04");
    }

    #[test]
    fn test_shared_strings_xml_generation() {
        let strings = &["Hello", "World", "Test & <Value>"];
        let xml = shared_strings_xml(strings);
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.contains("uniqueCount=\"3\""));
        assert!(xml_str.contains("<si><t>Hello</t></si>"));
        assert!(xml_str.contains("<si><t>World</t></si>"));
        // Check XML escaping
        assert!(xml_str.contains("Test &amp; &lt;Value&gt;"));
    }

    #[test]
    fn test_create_xlsx_with_cells() {
        let xlsx = create_xlsx_with_cells(10, 5);

        // Verify ZIP signature
        assert_eq!(&xlsx[0..4], b"PK\x03\x04");

        // File should be non-trivial size for 50 cells
        assert!(xlsx.len() > 1000);
    }
}
