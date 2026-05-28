use super::super::constants::{
    CENTRAL_FILE_HEADER_SIGNATURE, COMPRESSION_STORE, END_OF_CENTRAL_DIR_SIGNATURE,
    LOCAL_FILE_HEADER_SIGNATURE,
};
use super::*;
use crate::infra::error::ParseMode;
use crate::{ErrorCode, ParseContext};

// Helper to create a minimal valid ZIP file with a single stored file
fn create_test_zip(filename: &str, content: &[u8]) -> Vec<u8> {
    let mut zip = Vec::new();
    let name_bytes = filename.as_bytes();

    // Calculate CRC32
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

// Helper to create XLSX-like structure
fn create_xlsx_like_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = Vec::new();
    let mut entries_info: Vec<(usize, &str, &[u8], u32)> = Vec::new();

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

    for (filename, content) in files {
        let local_offset = zip.len();
        let name_bytes = filename.as_bytes();
        let crc = crc32(content);

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
fn test_get_shared_strings_or_empty_missing() {
    let files: &[(&str, &[u8])] = &[
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
    ];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::lenient();
    let data = archive.get_shared_strings_or_empty(&mut ctx);

    assert!(data.is_empty());
    assert!(ctx.warning_count() > 0);

    // Check it logged the right warning
    let has_warning = ctx
        .errors()
        .iter()
        .any(|e| e.code == ErrorCode::MissingPart && e.message.contains("sharedStrings"));
    assert!(has_warning);
}

#[test]
fn test_get_shared_strings_or_empty_present() {
    let files: &[(&str, &[u8])] = &[("xl/sharedStrings.xml", b"<sst/>")];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::lenient();
    let data = archive.get_shared_strings_or_empty(&mut ctx);

    assert_eq!(data, b"<sst/>");
    assert_eq!(ctx.warning_count(), 0);
}

#[test]
fn test_get_worksheet_or_empty_missing() {
    let files: &[(&str, &[u8])] = &[("xl/workbook.xml", b"<workbook/>")];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::lenient();
    let data = archive.get_worksheet_or_empty(1, &mut ctx);

    assert!(data.is_empty());
    assert!(ctx.error_count() > 0);
}

#[test]
fn test_get_worksheet_or_empty_present() {
    let files: &[(&str, &[u8])] = &[("xl/worksheets/sheet1.xml", b"<worksheet/>")];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::lenient();
    let data = archive.get_worksheet_or_empty(1, &mut ctx);

    assert_eq!(data, b"<worksheet/>");
    assert_eq!(ctx.error_count(), 0);
}

#[test]
fn test_read_file_with_recovery_missing_file() {
    let files: &[(&str, &[u8])] = &[("existing.txt", b"content")];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::lenient();
    let data = archive.read_file_with_recovery("nonexistent.txt", &mut ctx);

    assert!(data.is_empty());
    assert!(ctx.error_count() > 0);
}

#[test]
fn test_read_file_with_recovery_valid_file() {
    let content = b"test content";
    let zip_data = create_test_zip("test.txt", content);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::lenient();
    let data = archive.read_file_with_recovery("test.txt", &mut ctx);

    assert_eq!(data, content);
    assert_eq!(ctx.error_count(), 0);
}

#[test]
fn test_get_styles_or_empty_missing() {
    let files: &[(&str, &[u8])] = &[("xl/workbook.xml", b"<workbook/>")];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::lenient();
    let data = archive.get_styles_or_empty(&mut ctx);

    assert!(data.is_empty());
    assert!(ctx.warning_count() > 0);
}

#[test]
fn test_get_workbook_or_empty_missing() {
    let files: &[(&str, &[u8])] = &[("xl/worksheets/sheet1.xml", b"<worksheet/>")];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::lenient();
    let data = archive.get_workbook_or_empty(&mut ctx);

    assert!(data.is_empty());
    assert!(ctx.error_count() > 0);
}

#[test]
fn test_strict_mode_fails_on_missing_file() {
    let files: &[(&str, &[u8])] = &[("existing.txt", b"content")];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::strict();
    let data = archive.read_file_with_recovery("nonexistent.txt", &mut ctx);

    assert!(data.is_empty());
    assert!(ctx.should_stop());
}

#[test]
fn test_permissive_mode_recovers() {
    let files: &[(&str, &[u8])] = &[("existing.txt", b"content")];

    let zip_data = create_xlsx_like_zip(files);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let mut ctx = ParseContext::permissive();
    let data = archive.read_file_with_recovery("nonexistent.txt", &mut ctx);

    assert!(data.is_empty());
    // Permissive mode should still log the error but not stop
    assert!(!ctx.should_stop());
}

#[test]
fn test_crc_safety_failure_is_fatal_in_all_parse_modes() {
    let mut zip_data = create_test_zip("test.txt", b"content");
    let data_offset = 30 + "test.txt".len();
    zip_data[data_offset] ^= 0xff;
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    for mode in [ParseMode::Strict, ParseMode::Lenient, ParseMode::Permissive] {
        let mut ctx = ParseContext::new(mode);
        let data = archive.read_file_with_recovery("test.txt", &mut ctx);
        assert!(data.is_empty());
        assert!(
            ctx.should_stop(),
            "mode {mode:?} must stop on CRC safety failure"
        );
        assert!(
            ctx.errors()
                .iter()
                .any(|e| e.code == ErrorCode::DataCorruption)
        );
    }
}
