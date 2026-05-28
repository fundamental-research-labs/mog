use super::super::constants::{
    CENTRAL_FILE_HEADER_SIGNATURE, COMPRESSION_DEFLATE, END_OF_CENTRAL_DIR_SIGNATURE,
    FLAG_DATA_DESCRIPTOR, LOCAL_FILE_HEADER_SIGNATURE,
};
use super::*;

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

// Helper to create a ZIP with DEFLATE compression using miniz_oxide
fn create_deflate_zip(filename: &str, content: &[u8]) -> Vec<u8> {
    use miniz_oxide::deflate::compress_to_vec;

    // Compress the content using raw deflate
    let compressed = compress_to_vec(content, 6);

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
    zip.extend_from_slice(&20u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&COMPRESSION_DEFLATE.to_le_bytes()); // DEFLATE
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&crc.to_le_bytes());
    zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(name_bytes);
    zip.extend_from_slice(&compressed);

    let local_header_offset = 0usize;
    let cd_offset = zip.len();

    // Central directory
    zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&20u16.to_le_bytes());
    zip.extend_from_slice(&20u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&COMPRESSION_DEFLATE.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&crc.to_le_bytes());
    zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u32.to_le_bytes());
    zip.extend_from_slice(&(local_header_offset as u32).to_le_bytes());
    zip.extend_from_slice(name_bytes);

    let cd_size = zip.len() - cd_offset;

    // EOCD
    zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&1u16.to_le_bytes());
    zip.extend_from_slice(&1u16.to_le_bytes());
    zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
    zip.extend_from_slice(&(cd_offset as u32).to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());

    zip
}

fn create_deflate_zip_with_data_descriptor(filename: &str, content: &[u8]) -> Vec<u8> {
    use miniz_oxide::deflate::compress_to_vec;

    let compressed = compress_to_vec(content, 6);
    let mut zip = Vec::new();
    let name_bytes = filename.as_bytes();
    let crc = crc32(content);
    let flags = FLAG_DATA_DESCRIPTOR;

    // Local file header. When bit 3 is set, CRC and sizes are allowed to
    // be zero here; the central directory remains authoritative.
    zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&20u16.to_le_bytes());
    zip.extend_from_slice(&flags.to_le_bytes());
    zip.extend_from_slice(&COMPRESSION_DEFLATE.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u32.to_le_bytes());
    zip.extend_from_slice(&0u32.to_le_bytes());
    zip.extend_from_slice(&0u32.to_le_bytes());
    zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(name_bytes);
    zip.extend_from_slice(&compressed);
    zip.extend_from_slice(&crc.to_le_bytes());
    zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(content.len() as u32).to_le_bytes());

    let local_header_offset = 0usize;
    let cd_offset = zip.len();

    // Central directory carries the trusted metadata.
    zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&20u16.to_le_bytes());
    zip.extend_from_slice(&20u16.to_le_bytes());
    zip.extend_from_slice(&flags.to_le_bytes());
    zip.extend_from_slice(&COMPRESSION_DEFLATE.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&crc.to_le_bytes());
    zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u32.to_le_bytes());
    zip.extend_from_slice(&(local_header_offset as u32).to_le_bytes());
    zip.extend_from_slice(name_bytes);

    let cd_size = zip.len() - cd_offset;

    zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(&1u16.to_le_bytes());
    zip.extend_from_slice(&1u16.to_le_bytes());
    zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
    zip.extend_from_slice(&(cd_offset as u32).to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());

    zip
}

#[test]
fn test_deflate_decompression() {
    let content = b"Hello, this is test content that should compress well! AAAAAAAAAAAAAAAAAAAAAA";
    let zip_data = create_deflate_zip("compressed.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let data = archive
        .read_file("compressed.txt")
        .expect("Failed to read file");

    assert_eq!(data, content);
}

#[test]
fn test_deflate_larger_content() {
    // Create content that compresses well
    let content: Vec<u8> = (0..10000).map(|i| ((i % 26) as u8) + b'a').collect();
    let zip_data = create_deflate_zip("large.txt", &content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let data = archive.read_file("large.txt").expect("Failed to read file");

    assert_eq!(data, content);
}

#[test]
fn test_deflate_data_descriptor_entry() {
    let content = b"deflated content whose local header uses a data descriptor";
    let zip_data = create_deflate_zip_with_data_descriptor("xl/worksheets/sheet1.xml", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let data = archive
        .read_file("xl/worksheets/sheet1.xml")
        .expect("Failed to read descriptor-backed entry");

    assert_eq!(data, content);
}

#[test]
fn test_deflate_read_into_buffer() {
    let content = b"Test content for buffer reading with DEFLATE compression!";
    let zip_data = create_deflate_zip("test.txt", content);

    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
    let mut buffer = vec![0u8; 1024];
    let bytes_read = archive
        .read_file_into("test.txt", &mut buffer)
        .expect("Failed to read file");

    assert_eq!(bytes_read, content.len());
    assert_eq!(&buffer[..bytes_read], content);
}

#[test]
fn test_verbatim_read_allows_non_utf8_xml_passthrough() {
    let mut utf16_xml = vec![0xff, 0xfe];
    for unit in r#"<?xml version="1.0" encoding="UTF-16"?><r/>"#.encode_utf16() {
        utf16_xml.extend_from_slice(&unit.to_le_bytes());
    }
    let zip_data = create_deflate_zip("customXml/item1.xml", &utf16_xml);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let normal = archive.read_file("customXml/item1.xml");
    assert!(matches!(normal, Err(ZipError::DataCorruptionDetail(_))));

    let raw = archive
        .read_file_verbatim("customXml/item1.xml")
        .expect("verbatim passthrough should skip XML UTF-8 validation");
    assert_eq!(raw, utf16_xml);
}

#[test]
fn test_deflate_declared_size_smaller_than_actual_rejected() {
    let filename = "test.txt";
    let content = b"deflate output is larger than dishonest metadata";
    let mut zip_data = create_deflate_zip(filename, content);
    let cd_sig = CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes();
    let cd_offset = zip_data
        .windows(4)
        .position(|window| window == cd_sig)
        .expect("central directory signature");
    let dishonest_uncompressed = (content.len() as u32 - 1).to_le_bytes();
    zip_data[22..26].copy_from_slice(&dishonest_uncompressed);
    zip_data[cd_offset + 24..cd_offset + 28].copy_from_slice(&dishonest_uncompressed);
    let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

    let result = archive.read_file(filename);

    assert!(matches!(result, Err(ZipError::DataCorruptionDetail(_))));
}
