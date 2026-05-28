use super::super::constants::{
    CENTRAL_FILE_HEADER_SIGNATURE, COMPRESSION_STORE, END_OF_CENTRAL_DIR_SIGNATURE,
    LOCAL_FILE_HEADER_SIGNATURE,
};
use super::*;

// Simple CRC32 implementation for testing
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

// Helper to create a minimal valid ZIP file with a single stored file
fn create_test_zip(filename: &str, content: &[u8]) -> Vec<u8> {
    let mut zip = Vec::new();
    let name_bytes = filename.as_bytes();
    let crc = crc32(content);

    // Local file header
    zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&20u16.to_le_bytes()); // version needed
    zip.extend_from_slice(&0u16.to_le_bytes()); // flags
    zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes()); // compression
    zip.extend_from_slice(&0u16.to_le_bytes()); // mod time
    zip.extend_from_slice(&0u16.to_le_bytes()); // mod date
    zip.extend_from_slice(&crc.to_le_bytes()); // CRC-32
    zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // compressed size
    zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncompressed size
    zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes()); // name length
    zip.extend_from_slice(&0u16.to_le_bytes()); // extra length
    zip.extend_from_slice(name_bytes);
    zip.extend_from_slice(content);

    let local_header_offset = 0usize;
    let cd_offset = zip.len();

    // Central directory file header
    zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&20u16.to_le_bytes()); // version made by
    zip.extend_from_slice(&20u16.to_le_bytes()); // version needed
    zip.extend_from_slice(&0u16.to_le_bytes()); // flags
    zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes()); // compression
    zip.extend_from_slice(&0u16.to_le_bytes()); // mod time
    zip.extend_from_slice(&0u16.to_le_bytes()); // mod date
    zip.extend_from_slice(&crc.to_le_bytes()); // CRC-32
    zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // compressed size
    zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncompressed size
    zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes()); // name length
    zip.extend_from_slice(&0u16.to_le_bytes()); // extra length
    zip.extend_from_slice(&0u16.to_le_bytes()); // comment length
    zip.extend_from_slice(&0u16.to_le_bytes()); // disk number
    zip.extend_from_slice(&0u16.to_le_bytes()); // internal attributes
    zip.extend_from_slice(&0u32.to_le_bytes()); // external attributes
    zip.extend_from_slice(&(local_header_offset as u32).to_le_bytes()); // local header offset
    zip.extend_from_slice(name_bytes);

    let cd_size = zip.len() - cd_offset;

    // End of central directory
    zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes()); // disk number
    zip.extend_from_slice(&0u16.to_le_bytes()); // disk with CD
    zip.extend_from_slice(&1u16.to_le_bytes()); // entries on disk
    zip.extend_from_slice(&1u16.to_le_bytes()); // total entries
    zip.extend_from_slice(&(cd_size as u32).to_le_bytes()); // CD size
    zip.extend_from_slice(&(cd_offset as u32).to_le_bytes()); // CD offset
    zip.extend_from_slice(&0u16.to_le_bytes()); // comment length

    zip
}

// Helper to create ZIP with multiple files
fn create_multi_file_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = Vec::new();
    let mut entries_info: Vec<(usize, &str, &[u8], u32)> = Vec::new();

    // Write all local file headers and data
    for (filename, content) in files {
        let local_offset = zip.len();
        let name_bytes = filename.as_bytes();
        let crc = crc32(content);

        // Local file header
        zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&crc.to_le_bytes());
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(name_bytes);
        zip.extend_from_slice(content);

        entries_info.push((local_offset, filename, content, crc));
    }

    let cd_offset = zip.len();

    // Write central directory entries
    for (local_offset, filename, content, crc) in &entries_info {
        let name_bytes = filename.as_bytes();

        zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&crc.to_le_bytes());
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u32.to_le_bytes());
        zip.extend_from_slice(&(*local_offset as u32).to_le_bytes());
        zip.extend_from_slice(name_bytes);
    }

    let cd_size = zip.len() - cd_offset;

    // End of central directory
    zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&(entries_info.len() as u16).to_le_bytes());
    zip.extend_from_slice(&(entries_info.len() as u16).to_le_bytes());
    zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
    zip.extend_from_slice(&(cd_offset as u32).to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());

    zip
}

#[test]
fn test_create_archive() {
    let content = b"Hello, World!";
    let zip_data = create_test_zip("test.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    assert_eq!(archive.entries().len(), 1);
    assert_eq!(archive.entries()[0].name, "test.txt");
}

#[test]
fn test_read_stored_file() {
    let content = b"Hello, World!";
    let zip_data = create_test_zip("test.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let data = archive.read_file("test.txt").expect("Failed to read file");

    assert_eq!(data, content);
}

#[test]
fn test_read_file_into_buffer() {
    let content = b"Hello, World!";
    let zip_data = create_test_zip("test.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let mut buffer = vec![0u8; 100];
    let bytes_read = archive
        .read_file_into("test.txt", &mut buffer)
        .expect("Failed to read file");

    assert_eq!(bytes_read, content.len());
    assert_eq!(&buffer[..bytes_read], content);
}

#[test]
fn test_file_not_found() {
    let content = b"Hello, World!";
    let zip_data = create_test_zip("test.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let result = archive.read_file("nonexistent.txt");

    assert!(matches!(result, Err(ZipError::FileNotFound(_))));
}

#[test]
fn test_read_file_into_too_small_buffer() {
    let zip_data = create_test_zip("test.txt", b"Hello, World!");
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let mut output = [0u8; 4];

    let result = archive.read_file_into("test.txt", &mut output);

    assert!(matches!(result, Err(ZipError::FileTooLargeDetail { .. })));
}

#[test]
fn test_crc_mismatch_is_data_corruption() {
    let filename = "test.txt";
    let mut zip_data = create_test_zip(filename, b"Hello, World!");
    zip_data[30 + filename.len()] ^= 0xff;
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let result = archive.read_file(filename);

    assert!(matches!(result, Err(ZipError::DataCorruptionDetail(_))));
    assert!(matches!(
        archive.fatal_safety_error(),
        Some(ZipError::DataCorruptionDetail(_))
    ));
}

#[test]
fn test_stored_entry_mismatched_declared_size_rejected() {
    let filename = "test.txt";
    let content = b"Hello, World!";
    let mut zip_data = create_test_zip(filename, content);
    let cd_sig = CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes();
    let cd_offset = zip_data
        .windows(4)
        .position(|window| window == cd_sig)
        .expect("central directory signature");
    let dishonest_uncompressed = (content.len() as u32 + 1).to_le_bytes();
    zip_data[22..26].copy_from_slice(&dishonest_uncompressed);
    zip_data[cd_offset + 24..cd_offset + 28].copy_from_slice(&dishonest_uncompressed);

    let result = XlsxArchive::new(&zip_data);

    assert!(matches!(result, Err(ZipError::DataCorruptionDetail(_))));
}

#[test]
fn test_non_ascii_filename_without_utf8_flag_rejected() {
    let filename = "test.txt";
    let mut zip_data = create_test_zip(filename, b"content");
    let cd_sig = CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes();
    let cd_offset = zip_data
        .windows(4)
        .position(|window| window == cd_sig)
        .expect("central directory signature");
    zip_data[30] = 0xff;
    zip_data[cd_offset + 46] = 0xff;

    let result = XlsxArchive::new(&zip_data);

    assert!(matches!(result, Err(ZipError::InvalidFileName(_))));
}

#[test]
fn test_duplicate_normalized_filename_rejected() {
    let files: &[(&str, &[u8])] = &[("xl\\a.xml", b"one"), ("xl/a.xml", b"two")];
    let zip_data = create_multi_file_zip(files);

    let result = XlsxArchive::new(&zip_data);

    assert!(matches!(result, Err(ZipError::InvalidFileName(_))));
}

#[test]
fn test_unsupported_zip_flags_rejected_before_read() {
    let filename = "test.txt";
    let mut zip_data = create_test_zip(filename, b"content");
    let cd_sig = CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes();
    let cd_offset = zip_data
        .windows(4)
        .position(|window| window == cd_sig)
        .expect("central directory signature");
    zip_data[6..8].copy_from_slice(&1u16.to_le_bytes());
    zip_data[cd_offset + 8..cd_offset + 10].copy_from_slice(&1u16.to_le_bytes());

    let result = XlsxArchive::new(&zip_data);

    assert!(matches!(result, Err(ZipError::UnsupportedFeature(_))));
}

#[test]
fn test_relationship_element_counter_ignores_relationships_root() {
    let xml = br#"<Relationships>
            <Relationship Id="rId1"/>
            <Relationship Id="rId2"></Relationship>
        </Relationships>"#;

    assert_eq!(count_relationship_elements(xml), 2);
}

#[test]
fn test_relationship_records_are_charged_once_per_part() {
    let xml = br#"<Relationships><Relationship Id="rId1"/></Relationships>"#;
    let zip_data = create_test_zip("xl/_rels/workbook.xml.rels", xml);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    assert!(archive.read_file("xl/_rels/workbook.xml.rels").is_ok());
    assert!(archive.read_file("xl/_rels/workbook.xml.rels").is_ok());
    assert_eq!(
        archive
            .relationship_record_counts
            .borrow()
            .get("xl/_rels/workbook.xml.rels"),
        Some(&1)
    );
}

#[test]
fn test_contains() {
    let content = b"Hello, World!";
    let zip_data = create_test_zip("test.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    assert!(archive.contains("test.txt"));
    assert!(!archive.contains("nonexistent.txt"));
}

#[test]
fn test_find_entry() {
    let content = b"Hello, World!";
    let zip_data = create_test_zip("test.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let entry = archive.find_entry("test.txt");
    assert!(entry.is_some());
    assert_eq!(entry.unwrap().name, "test.txt");

    assert!(archive.find_entry("nonexistent.txt").is_none());
}

#[test]
fn test_invalid_archive_too_short() {
    let invalid_data = b"Not a ZIP file";
    let result = XlsxArchive::new(invalid_data);

    // Should return UnexpectedEof since data is shorter than minimum ZIP size (22 bytes)
    assert!(matches!(result, Err(ZipError::UnexpectedEof)));
}

#[test]
fn test_invalid_archive_wrong_signature() {
    // Create data that's long enough but has wrong signature
    let invalid_data = b"Not a ZIP file but long enough to pass size check!";
    let result = XlsxArchive::new(invalid_data);

    // Should return InvalidFormat since it doesn't start with PK signature
    assert!(matches!(result, Err(ZipError::InvalidFormat)));
}

#[test]
fn test_empty_data() {
    let result = XlsxArchive::new(&[]);
    assert!(matches!(result, Err(ZipError::UnexpectedEof)));
}

#[test]
fn test_multi_file_archive() {
    let files: &[(&str, &[u8])] = &[
        ("file1.txt", b"Content 1"),
        ("file2.txt", b"Content 2"),
        ("dir/file3.txt", b"Content 3"),
    ];

    let zip_data = create_multi_file_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    assert_eq!(archive.entries().len(), 3);

    for (name, expected_content) in files {
        let content = archive.read_file(name).expect("Failed to read file");
        assert_eq!(content, *expected_content);
    }
}

#[test]
fn test_xlsx_like_structure() {
    let files: &[(&str, &[u8])] = &[
        ("[Content_Types].xml", b"<Types/>"),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/sharedStrings.xml", b"<sst/>"),
        ("xl/styles.xml", b"<styleSheet/>"),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        ("xl/worksheets/sheet2.xml", b"<worksheet/>"),
        ("xl/_rels/workbook.xml.rels", b"<Relationships/>"),
    ];

    let zip_data = create_multi_file_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    // Test convenience methods
    assert!(archive.get_workbook().is_ok());
    assert!(archive.get_shared_strings().is_ok());
    assert!(archive.get_styles().is_ok());
    assert!(archive.get_worksheet(1).is_ok());
    assert!(archive.get_worksheet(2).is_ok());
    assert!(archive.get_workbook_rels().is_ok());
    assert!(archive.get_content_types().is_ok());

    // Test worksheet count
    assert_eq!(archive.worksheet_count(), 2);
}

#[test]
fn test_worksheet_names() {
    let files: &[(&str, &[u8])] = &[
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        ("xl/worksheets/sheet2.xml", b"<worksheet/>"),
        ("xl/worksheets/sheet10.xml", b"<worksheet/>"),
    ];

    let zip_data = create_multi_file_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let names = archive.worksheet_names();
    assert_eq!(names.len(), 3);
    assert!(names.contains(&"sheet1.xml"));
    assert!(names.contains(&"sheet2.xml"));
    assert!(names.contains(&"sheet10.xml"));
}

#[test]
fn test_file_paths() {
    assert_eq!(XlsxArchive::shared_strings_path(), "xl/sharedStrings.xml");
    assert_eq!(XlsxArchive::workbook_path(), "xl/workbook.xml");
    assert_eq!(XlsxArchive::worksheet_path(1), "xl/worksheets/sheet1.xml");
    assert_eq!(XlsxArchive::styles_path(), "xl/styles.xml");
}

#[test]
fn test_crc32_implementation() {
    // Test against known CRC32 values
    assert_eq!(crc32(b""), 0x00000000);
    assert_eq!(crc32(b"123456789"), 0xCBF43926);
}

#[test]
fn test_large_file_name() {
    let long_name = "a".repeat(255);
    let content = b"test content";
    let zip_data = create_test_zip(&long_name, content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let data = archive.read_file(&long_name).expect("Failed to read file");

    assert_eq!(data, content);
}

#[test]
fn test_binary_content() {
    let content: Vec<u8> = (0..256).map(|i| i as u8).collect();
    let zip_data = create_test_zip("binary.bin", &content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let data = archive
        .read_file("binary.bin")
        .expect("Failed to read file");

    assert_eq!(data, content);
}

#[test]
fn test_empty_file() {
    let content = b"";
    let zip_data = create_test_zip("empty.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let data = archive.read_file("empty.txt").expect("Failed to read file");

    assert_eq!(data, content.as_slice());
}

#[test]
fn test_data_accessor() {
    let content = b"test";
    let zip_data = create_test_zip("test.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    assert_eq!(archive.data().len(), zip_data.len());
}
