//! Generates malformed XLSX files for testing error recovery
//!
//! This binary creates a variety of malformed XLSX files to test the parser's
//! error handling and recovery capabilities.
//!
//! Usage: cargo run --bin generate_test_corpus --features corpus-gen
//!
//! The generated files are placed in the test-corpus/ directory.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;

use miniz_oxide::deflate::compress_to_vec;

// =============================================================================
// ZIP File Format Constants
// =============================================================================

const LOCAL_FILE_HEADER_SIGNATURE: u32 = 0x04034b50;
const CENTRAL_FILE_HEADER_SIGNATURE: u32 = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE: u32 = 0x06054b50;
const COMPRESSION_STORE: u16 = 0;
const COMPRESSION_DEFLATE: u16 = 8;

// =============================================================================
// ZIP Builder
// =============================================================================

/// Simple CRC32 implementation for ZIP file creation
fn crc32(data: &[u8]) -> u32 {
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
struct ZipBuilder {
    entries: Vec<ZipFileEntry>,
}

impl ZipBuilder {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    fn add_stored(&mut self, name: &str, content: &[u8]) -> &mut Self {
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

    fn add_deflate(&mut self, name: &str, content: &[u8]) -> &mut Self {
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

    fn build(&self) -> Vec<u8> {
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

// =============================================================================
// XML Templates
// =============================================================================

fn content_types_xml(sheets: usize, has_shared_strings: bool) -> Vec<u8> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>"#,
    );

    for i in 1..=sheets {
        xml.push_str(&format!(
            r#"
  <Override PartName="/xl/worksheets/sheet{}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#,
            i
        ));
    }

    if has_shared_strings {
        xml.push_str(r#"
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>"#);
    }

    xml.push_str("\n</Types>");
    xml.into_bytes()
}

fn root_rels_xml() -> Vec<u8> {
    br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#.to_vec()
}

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

fn worksheet_xml_with_cells(cells: &[(String, &str)]) -> Vec<u8> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>"#,
    );

    // Group by row
    let mut rows: HashMap<u32, Vec<(String, &str)>> = HashMap::new();
    for (ref_, value) in cells {
        let row = parse_row_from_ref(ref_);
        rows.entry(row).or_default().push((ref_.clone(), *value));
    }

    let mut sorted_rows: Vec<_> = rows.into_iter().collect();
    sorted_rows.sort_by_key(|(r, _)| *r);

    for (row, row_cells) in sorted_rows {
        xml.push_str(&format!("\n    <row r=\"{}\">", row));
        for (ref_, value) in row_cells {
            xml.push_str(&format!("\n      <c r=\"{}\"><v>{}</v></c>", ref_, value));
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

fn shared_strings_xml(strings: &[&str]) -> Vec<u8> {
    let mut xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{}" uniqueCount="{}">"#,
        strings.len(),
        strings.len()
    );

    for s in strings {
        let escaped = s
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        xml.push_str(&format!("\n  <si><t>{}</t></si>", escaped));
    }

    xml.push_str("\n</sst>");
    xml.into_bytes()
}

fn parse_row_from_ref(ref_: &str) -> u32 {
    ref_.chars()
        .skip_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .parse()
        .unwrap_or(1)
}

// =============================================================================
// Test File Generators
// =============================================================================

fn generate_minimal_valid_xlsx() -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    let worksheet = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>42</v></c>
      <c r="B1"><v>3.14</v></c>
    </row>
  </sheetData>
</worksheet>"#;

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml(1, false))
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, false))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", worksheet);

    builder.build()
}

fn generate_xlsx_with_shared_strings() -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    let worksheet = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>"#;

    let shared_strings = shared_strings_xml(&["Hello", "World", "Test"]);

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml(1, true))
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, true))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", worksheet)
        .add_deflate("xl/sharedStrings.xml", &shared_strings);

    builder.build()
}

fn generate_truncated_files(base_xlsx: &[u8]) -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();

    // Truncate at various points
    let truncate_points = [
        (10, "truncated_early.xlsx"),
        (base_xlsx.len() / 4, "truncated_quarter.xlsx"),
        (base_xlsx.len() / 2, "truncated_half.xlsx"),
        (base_xlsx.len() * 3 / 4, "truncated_three_quarter.xlsx"),
        (base_xlsx.len() - 10, "truncated_near_end.xlsx"),
    ];

    for (point, name) in truncate_points {
        if point < base_xlsx.len() {
            files.push((name.to_string(), base_xlsx[..point].to_vec()));
        }
    }

    // Truncate in the middle of a row element
    let mut mid_row = base_xlsx.to_vec();
    if let Some(pos) = find_pattern(&mid_row, b"<row") {
        let truncate_at = pos + 10; // Mid-way through <row ...>
        if truncate_at < mid_row.len() {
            mid_row.truncate(truncate_at);
            files.push(("truncated_mid_row.xlsx".to_string(), mid_row));
        }
    }

    files
}

fn generate_invalid_xml_files() -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();

    // Unclosed cell tag
    let unclosed_cell = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>42</v></c>
      <c r="B1"><v>100</v>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("unclosed_cell_tag.xlsx".to_string(), unclosed_cell));

    // Invalid XML entity
    let invalid_entity = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>&invalid;</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("invalid_xml_entity.xlsx".to_string(), invalid_entity));

    // Missing XML declaration
    let no_declaration = create_xlsx_with_custom_worksheet(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("missing_xml_declaration.xlsx".to_string(), no_declaration));

    // Malformed attribute
    let bad_attribute = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t=s><v>0</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("malformed_attribute.xlsx".to_string(), bad_attribute));

    files
}

fn generate_invalid_cell_files() -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();

    // Invalid cell reference - too many letters
    let invalid_ref = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>1</v></c>
      <c r="ZZZZZ99999999"><v>2</v></c>
      <c r="C1"><v>3</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("invalid_cell_ref_zzz.xlsx".to_string(), invalid_ref));

    // Cell with no reference attribute
    let no_ref = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>1</v></c>
      <c><v>2</v></c>
      <c r="C1"><v>3</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("cell_no_reference.xlsx".to_string(), no_ref));

    // Invalid shared string index
    let bad_ss_index = create_xlsx_with_custom_worksheet_and_strings(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>99999</v></c>
      <c r="C1" t="s"><v>1</v></c>
    </row>
  </sheetData>
</worksheet>"#,
        &["Hello", "World"],
    );
    files.push(("invalid_shared_string_index.xlsx".to_string(), bad_ss_index));

    // Negative row number
    let negative_row = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="-1">
      <c r="A-1"><v>1</v></c>
    </row>
    <row r="1">
      <c r="A1"><v>2</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("negative_row.xlsx".to_string(), negative_row));

    files
}

fn generate_corrupted_zip_files() -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();

    // Bad ZIP signature
    let mut bad_sig = generate_minimal_valid_xlsx();
    if bad_sig.len() >= 4 {
        bad_sig[0] = 0x00;
        bad_sig[1] = 0x00;
    }
    files.push(("bad_zip_signature.xlsx".to_string(), bad_sig));

    // Corrupted central directory
    let mut bad_cd = generate_minimal_valid_xlsx();
    if bad_cd.len() > 100 {
        // Find and corrupt the central directory signature
        if let Some(pos) = find_pattern(&bad_cd, &CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes()) {
            bad_cd[pos] = 0xFF;
            bad_cd[pos + 1] = 0xFF;
        }
    }
    files.push(("corrupted_central_directory.xlsx".to_string(), bad_cd));

    // Invalid compression method
    let mut bad_compression = generate_minimal_valid_xlsx();
    // Find local file header and change compression method
    if let Some(pos) = find_pattern(&bad_compression, &LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes()) {
        if pos + 10 < bad_compression.len() {
            bad_compression[pos + 8] = 99; // Invalid compression method
        }
    }
    files.push((
        "invalid_compression_method.xlsx".to_string(),
        bad_compression,
    ));

    // Mismatched CRC
    let mut bad_crc = generate_minimal_valid_xlsx();
    if let Some(pos) = find_pattern(&bad_crc, &LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes()) {
        if pos + 18 < bad_crc.len() {
            // CRC is at offset 14 from local header start
            bad_crc[pos + 14] = 0xFF;
            bad_crc[pos + 15] = 0xFF;
            bad_crc[pos + 16] = 0xFF;
            bad_crc[pos + 17] = 0xFF;
        }
    }
    files.push(("mismatched_crc.xlsx".to_string(), bad_crc));

    files
}

fn generate_missing_parts_files() -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();

    // Missing workbook.xml
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", &content_types_xml(1, false))
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, false))
        // No workbook.xml
        .add_deflate(
            "xl/worksheets/sheet1.xml",
            b"<worksheet><sheetData/></worksheet>",
        );
    files.push(("missing_workbook.xlsx".to_string(), builder.build()));

    // Missing worksheet
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", &content_types_xml(1, false))
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, false))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]));
    // No worksheet
    files.push(("missing_worksheet.xlsx".to_string(), builder.build()));

    // Missing _rels/.rels
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", &content_types_xml(1, false))
        // No _rels/.rels
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, false))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate(
            "xl/worksheets/sheet1.xml",
            b"<worksheet><sheetData/></worksheet>",
        );
    files.push(("missing_root_rels.xlsx".to_string(), builder.build()));

    // Missing workbook.xml.rels
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", &content_types_xml(1, false))
        .add_deflate("_rels/.rels", &root_rels_xml())
        // No xl/_rels/workbook.xml.rels
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate(
            "xl/worksheets/sheet1.xml",
            b"<worksheet><sheetData/></worksheet>",
        );
    files.push(("missing_workbook_rels.xlsx".to_string(), builder.build()));

    files
}

fn generate_invalid_style_files() -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();

    // Cell with invalid style index
    let invalid_style = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" s="99999"><v>42</v></c>
      <c r="B1"><v>100</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("invalid_style_index.xlsx".to_string(), invalid_style));

    // Cell with negative style index
    let negative_style = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" s="-1"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("negative_style_index.xlsx".to_string(), negative_style));

    files
}

fn generate_edge_case_files() -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();

    // Empty worksheet
    let empty_sheet = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
  </sheetData>
</worksheet>"#,
    );
    files.push(("empty_worksheet.xlsx".to_string(), empty_sheet));

    // Very large cell reference (max Excel column is XFD = 16383)
    let large_ref = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>1</v></c>
    </row>
    <row r="1048576">
      <c r="XFD1048576"><v>2</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("max_cell_reference.xlsx".to_string(), large_ref));

    // Sparse data
    let sparse = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>1</v></c>
    </row>
    <row r="1000">
      <c r="ZZ1000"><v>2</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    files.push(("sparse_data.xlsx".to_string(), sparse));

    // Many cells in one row
    let mut cells_xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">"#,
    );
    for i in 0..100 {
        let col = col_to_letters(i);
        cells_xml.push_str(&format!("\n      <c r=\"{}1\"><v>{}</v></c>", col, i));
    }
    cells_xml.push_str(
        r#"
    </row>
  </sheetData>
</worksheet>"#,
    );
    let many_cells = create_xlsx_with_custom_worksheet(&cells_xml);
    files.push(("many_cells_one_row.xlsx".to_string(), many_cells));

    files
}

// =============================================================================
// Helper Functions
// =============================================================================

fn create_xlsx_with_custom_worksheet(worksheet_xml: &str) -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml(1, false))
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, false))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", worksheet_xml.as_bytes());

    builder.build()
}

fn create_xlsx_with_custom_worksheet_and_strings(worksheet_xml: &str, strings: &[&str]) -> Vec<u8> {
    let mut builder = ZipBuilder::new();

    builder
        .add_deflate("[Content_Types].xml", &content_types_xml(1, true))
        .add_deflate("_rels/.rels", &root_rels_xml())
        .add_deflate("xl/_rels/workbook.xml.rels", &workbook_rels_xml(1, true))
        .add_deflate("xl/workbook.xml", &workbook_xml(&["Sheet1"]))
        .add_deflate("xl/worksheets/sheet1.xml", worksheet_xml.as_bytes())
        .add_deflate("xl/sharedStrings.xml", &shared_strings_xml(strings));

    builder.build()
}

fn find_pattern(data: &[u8], pattern: &[u8]) -> Option<usize> {
    data.windows(pattern.len())
        .position(|window| window == pattern)
}

fn col_to_letters(col: usize) -> String {
    xlsx_parser::col_to_letter(col as u32)
}

fn write_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(data)?;
    Ok(())
}

// =============================================================================
// Main
// =============================================================================

fn main() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let corpus_dir = Path::new(manifest_dir).join("test-corpus");

    println!("Generating test corpus in {:?}", corpus_dir);

    // Create directories
    let dirs = [
        "basic",
        "malformed/xml",
        "malformed/zip",
        "malformed/cells",
        "malformed/styles",
        "malformed/relationships",
        "malformed/truncated",
        "malformed/mixed",
        "edge-cases",
    ];

    for dir in dirs {
        let path = corpus_dir.join(dir);
        fs::create_dir_all(&path).expect("Failed to create directory");
    }

    // Generate basic valid files
    println!("Generating basic valid files...");
    let basic_dir = corpus_dir.join("basic");
    write_file(
        &basic_dir.join("minimal.xlsx"),
        &generate_minimal_valid_xlsx(),
    )
    .expect("Failed to write minimal.xlsx");
    write_file(
        &basic_dir.join("with_strings.xlsx"),
        &generate_xlsx_with_shared_strings(),
    )
    .expect("Failed to write with_strings.xlsx");

    // Generate truncated files
    println!("Generating truncated files...");
    let truncated_dir = corpus_dir.join("malformed/truncated");
    let base_xlsx = generate_xlsx_with_shared_strings();
    for (name, data) in generate_truncated_files(&base_xlsx) {
        write_file(&truncated_dir.join(&name), &data).expect(&format!("Failed to write {}", name));
    }

    // Generate invalid XML files
    println!("Generating invalid XML files...");
    let xml_dir = corpus_dir.join("malformed/xml");
    for (name, data) in generate_invalid_xml_files() {
        write_file(&xml_dir.join(&name), &data).expect(&format!("Failed to write {}", name));
    }

    // Generate invalid cell files
    println!("Generating invalid cell files...");
    let cells_dir = corpus_dir.join("malformed/cells");
    for (name, data) in generate_invalid_cell_files() {
        write_file(&cells_dir.join(&name), &data).expect(&format!("Failed to write {}", name));
    }

    // Generate corrupted ZIP files
    println!("Generating corrupted ZIP files...");
    let zip_dir = corpus_dir.join("malformed/zip");
    for (name, data) in generate_corrupted_zip_files() {
        write_file(&zip_dir.join(&name), &data).expect(&format!("Failed to write {}", name));
    }

    // Generate missing parts files
    println!("Generating missing parts files...");
    let rels_dir = corpus_dir.join("malformed/relationships");
    for (name, data) in generate_missing_parts_files() {
        write_file(&rels_dir.join(&name), &data).expect(&format!("Failed to write {}", name));
    }

    // Generate invalid style files
    println!("Generating invalid style files...");
    let styles_dir = corpus_dir.join("malformed/styles");
    for (name, data) in generate_invalid_style_files() {
        write_file(&styles_dir.join(&name), &data).expect(&format!("Failed to write {}", name));
    }

    // Generate edge case files
    println!("Generating edge case files...");
    let edge_dir = corpus_dir.join("edge-cases");
    for (name, data) in generate_edge_case_files() {
        write_file(&edge_dir.join(&name), &data).expect(&format!("Failed to write {}", name));
    }

    // Generate mixed error files
    println!("Generating mixed error files...");
    let mixed_dir = corpus_dir.join("malformed/mixed");

    // Truncated + invalid XML
    let mut truncated_invalid = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>42</v></c>
      <c r="B1"><v>&invalid;</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    truncated_invalid.truncate(truncated_invalid.len() / 2);
    write_file(
        &mixed_dir.join("truncated_with_invalid_xml.xlsx"),
        &truncated_invalid,
    )
    .expect("Failed to write truncated_with_invalid_xml.xlsx");

    // Bad ZIP + invalid cells
    let mut bad_zip_invalid_cells = create_xlsx_with_custom_worksheet(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="ZZZZZ99999"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>"#,
    );
    if bad_zip_invalid_cells.len() >= 4 {
        bad_zip_invalid_cells[2] = 0xFF; // Partially corrupt signature
    }
    write_file(
        &mixed_dir.join("bad_zip_invalid_cells.xlsx"),
        &bad_zip_invalid_cells,
    )
    .expect("Failed to write bad_zip_invalid_cells.xlsx");

    println!("\nTest corpus generation complete!");
    println!("Run tests with: cargo test --test corpus_tests");
}
