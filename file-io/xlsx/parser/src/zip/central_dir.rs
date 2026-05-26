//! Central directory parsing for ZIP archives

use super::constants::{
    CENTRAL_FILE_HEADER_SIGNATURE, COMPRESSION_DEFLATE, COMPRESSION_STORE,
    END_OF_CENTRAL_DIR_SIGNATURE, FLAG_DATA_DESCRIPTOR, FLAG_DEFLATE_OPTION_1,
    FLAG_DEFLATE_OPTION_2, FLAG_ENCRYPTED, FLAG_PATCHED_DATA, FLAG_UTF8_NAME,
    LOCAL_FILE_HEADER_SIGNATURE, MAX_CENTRAL_DIRECTORY_SIZE, MAX_COMMENT_LENGTH,
    MAX_TOTAL_DECLARED_UNCOMPRESSED_SIZE, MAX_UNCOMPRESSED_SIZE, MAX_ZIP_ENTRIES, MIN_EOCD_SIZE,
    ZIP64_END_OF_CENTRAL_DIR_LOCATOR_SIGNATURE,
};
use super::entry::ZipEntry;
use super::error::ZipError;

const ZIP64_EXTRA_FIELD_ID: u16 = 0x0001;
const ZIP64_U16_SENTINEL: u16 = 0xffff;
const ZIP64_U32_SENTINEL: u32 = 0xffff_ffff;

// Little-endian byte reading helpers
#[inline]
pub(crate) fn read_u16_le(data: &[u8]) -> u16 {
    u16::from_le_bytes([data[0], data[1]])
}

#[inline]
pub(crate) fn read_u32_le(data: &[u8]) -> u32 {
    u32::from_le_bytes([data[0], data[1], data[2], data[3]])
}

/// Find the End of Central Directory record
///
/// The EOCD is at the end of the file, but may have a variable-length comment.
/// We search backwards from the end to find the signature.
pub fn find_eocd(data: &[u8]) -> Result<usize, ZipError> {
    // EOCD is at least 22 bytes, and comment can be up to 65535 bytes
    let search_start = data
        .len()
        .saturating_sub(MIN_EOCD_SIZE + MAX_COMMENT_LENGTH);
    let search_end = data.len().saturating_sub(MIN_EOCD_SIZE);

    // Search backwards for the signature
    for i in (search_start..=search_end).rev() {
        if data.len() >= i + 4 && read_u32_le(&data[i..]) == END_OF_CENTRAL_DIR_SIGNATURE {
            // Verify this is actually the EOCD by checking the structure
            if i + MIN_EOCD_SIZE <= data.len() {
                let comment_len = read_u16_le(&data[i + 20..]) as usize;
                if i + MIN_EOCD_SIZE + comment_len == data.len() {
                    if i >= 20
                        && read_u32_le(&data[i - 20..])
                            == ZIP64_END_OF_CENTRAL_DIR_LOCATOR_SIGNATURE
                    {
                        return Err(ZipError::UnsupportedFeature(
                            "Zip64 EOCD locator records are not supported".to_string(),
                        ));
                    }
                    return Ok(i);
                }
            }
        }
    }

    Err(ZipError::InvalidArchive)
}

/// Parse End of Central Directory record
///
/// Returns (central_directory_offset, central_directory_size, entry_count)
pub fn parse_eocd(data: &[u8], offset: usize) -> Result<(usize, usize, usize), ZipError> {
    if offset + MIN_EOCD_SIZE > data.len() {
        return Err(ZipError::CorruptedArchive);
    }

    let eocd = &data[offset..];

    // Verify signature
    if read_u32_le(eocd) != END_OF_CENTRAL_DIR_SIGNATURE {
        return Err(ZipError::InvalidArchive);
    }

    // Parse EOCD fields
    // Offset 4: disk number (2 bytes) - ignored
    // Offset 6: disk with central directory (2 bytes) - ignored
    // Offset 8: entries on this disk (2 bytes)
    // Offset 10: total entries (2 bytes)
    // Offset 12: central directory size (4 bytes)
    // Offset 16: central directory offset (4 bytes)
    // Offset 20: comment length (2 bytes)

    let disk_number = read_u16_le(&eocd[4..]);
    let cd_disk_number = read_u16_le(&eocd[6..]);
    let entries_on_disk = read_u16_le(&eocd[8..]);
    let total_entries_raw = read_u16_le(&eocd[10..]);
    let cd_size_raw = read_u32_le(&eocd[12..]);
    let cd_offset_raw = read_u32_le(&eocd[16..]);
    let comment_len = read_u16_le(&eocd[20..]) as usize;

    if offset
        .checked_add(MIN_EOCD_SIZE)
        .and_then(|end| end.checked_add(comment_len))
        != Some(data.len())
    {
        return Err(ZipError::CorruptedArchiveDetail(
            "<eocd>: comment length does not match archive length".to_string(),
        ));
    }

    if disk_number != 0 || cd_disk_number != 0 || entries_on_disk != total_entries_raw {
        return Err(ZipError::UnsupportedFeature(
            "multi-disk ZIP archives are not supported".to_string(),
        ));
    }

    if total_entries_raw == ZIP64_U16_SENTINEL
        || entries_on_disk == ZIP64_U16_SENTINEL
        || cd_size_raw == ZIP64_U32_SENTINEL
        || cd_offset_raw == ZIP64_U32_SENTINEL
    {
        return Err(ZipError::UnsupportedFeature(
            "Zip64 EOCD sentinels are not supported".to_string(),
        ));
    }

    let total_entries = total_entries_raw as usize;
    let cd_size = cd_size_raw as usize;
    let cd_offset = cd_offset_raw as usize;

    if total_entries > MAX_ZIP_ENTRIES {
        return Err(ZipError::FileTooLargeDetail {
            limit: MAX_ZIP_ENTRIES,
            actual: total_entries,
        });
    }

    if cd_size > MAX_CENTRAL_DIRECTORY_SIZE {
        return Err(ZipError::FileTooLargeDetail {
            limit: MAX_CENTRAL_DIRECTORY_SIZE,
            actual: cd_size,
        });
    }

    // Validate offsets
    if cd_offset
        .checked_add(cd_size)
        .map(|end| end > data.len())
        .unwrap_or(true)
    {
        return Err(ZipError::CorruptedArchive);
    }

    Ok((cd_offset, cd_size, total_entries))
}

/// Parse the central directory to extract file entries
pub fn parse_central_directory(
    data: &[u8],
    cd_offset: usize,
    cd_size: usize,
    expected_count: usize,
) -> Result<Vec<ZipEntry>, ZipError> {
    if expected_count > MAX_ZIP_ENTRIES {
        return Err(ZipError::FileTooLargeDetail {
            limit: MAX_ZIP_ENTRIES,
            actual: expected_count,
        });
    }
    if cd_size > MAX_CENTRAL_DIRECTORY_SIZE {
        return Err(ZipError::FileTooLargeDetail {
            limit: MAX_CENTRAL_DIRECTORY_SIZE,
            actual: cd_size,
        });
    }

    let mut entries = Vec::with_capacity(expected_count.min(4096));
    let cd_end = cd_offset
        .checked_add(cd_size)
        .ok_or(ZipError::CorruptedArchive)?;
    let mut pos = cd_offset;
    let mut declared_total = 0usize;
    let mut names = std::collections::HashSet::with_capacity(expected_count.min(4096));
    let mut headers_parsed = 0usize;

    while headers_parsed < expected_count {
        // Central directory file header structure:
        // Offset 0: signature (4 bytes) = 0x02014b50
        // Offset 4: version made by (2 bytes)
        // Offset 6: version needed (2 bytes)
        // Offset 8: flags (2 bytes)
        // Offset 10: compression method (2 bytes)
        // Offset 12: last mod time (2 bytes)
        // Offset 14: last mod date (2 bytes)
        // Offset 16: CRC-32 (4 bytes)
        // Offset 20: compressed size (4 bytes)
        // Offset 24: uncompressed size (4 bytes)
        // Offset 28: file name length (2 bytes)
        // Offset 30: extra field length (2 bytes)
        // Offset 32: file comment length (2 bytes)
        // Offset 34: disk number start (2 bytes)
        // Offset 36: internal attributes (2 bytes)
        // Offset 38: external attributes (4 bytes)
        // Offset 42: relative offset of local header (4 bytes)
        // Offset 46: file name (variable)
        // Followed by: extra field, file comment

        let header_end = pos.checked_add(46).ok_or(ZipError::CorruptedArchive)?;
        if header_end > cd_end || header_end > data.len() {
            return Err(ZipError::CorruptedArchiveDetail(
                "<central-directory>: truncated file header".to_string(),
            ));
        }
        let header = &data[pos..header_end];

        // Verify signature
        if read_u32_le(header) != CENTRAL_FILE_HEADER_SIGNATURE {
            return Err(ZipError::CorruptedArchiveDetail(
                "<central-directory>: invalid central directory signature".to_string(),
            ));
        }

        let flags = read_u16_le(&header[8..]);
        let compression_method = read_u16_le(&header[10..]);
        let crc32 = read_u32_le(&header[16..]);
        let compressed_size_raw = read_u32_le(&header[20..]);
        let uncompressed_size_raw = read_u32_le(&header[24..]);
        let compressed_size = compressed_size_raw as usize;
        let uncompressed_size = uncompressed_size_raw as usize;
        let name_len = read_u16_le(&header[28..]) as usize;
        let extra_len = read_u16_le(&header[30..]) as usize;
        let comment_len = read_u16_le(&header[32..]) as usize;
        let disk_start = read_u16_le(&header[34..]);
        let local_header_offset_raw = read_u32_le(&header[42..]);
        let local_header_offset = local_header_offset_raw as usize;

        validate_flags(flags, compression_method)?;
        validate_compression_method(compression_method)?;

        if compressed_size_raw == ZIP64_U32_SENTINEL
            || uncompressed_size_raw == ZIP64_U32_SENTINEL
            || local_header_offset_raw == ZIP64_U32_SENTINEL
        {
            return Err(ZipError::UnsupportedFeature(
                "Zip64 central-directory sentinels are not supported".to_string(),
            ));
        }

        if disk_start != 0 {
            return Err(ZipError::UnsupportedFeature(
                "multi-disk ZIP entries are not supported".to_string(),
            ));
        }

        if uncompressed_size > MAX_UNCOMPRESSED_SIZE {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_UNCOMPRESSED_SIZE,
                actual: uncompressed_size,
            });
        }

        declared_total = declared_total
            .checked_add(uncompressed_size)
            .ok_or(ZipError::FileTooLarge)?;
        if declared_total > MAX_TOTAL_DECLARED_UNCOMPRESSED_SIZE {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_TOTAL_DECLARED_UNCOMPRESSED_SIZE,
                actual: declared_total,
            });
        }

        if compression_method == COMPRESSION_STORE && compressed_size != uncompressed_size {
            return Err(ZipError::DataCorruptionDetail(format!(
                "<central-directory>: stored entry has compressed size {} but uncompressed size {}",
                compressed_size, uncompressed_size
            )));
        }

        let name_start = header_end;
        let name_end = name_start
            .checked_add(name_len)
            .ok_or(ZipError::CorruptedArchive)?;
        let extra_end = name_end
            .checked_add(extra_len)
            .ok_or(ZipError::CorruptedArchive)?;
        let entry_end = extra_end
            .checked_add(comment_len)
            .ok_or(ZipError::CorruptedArchive)?;
        if entry_end > cd_end || entry_end > data.len() {
            return Err(ZipError::CorruptedArchiveDetail(
                "<central-directory>: truncated variable-length fields".to_string(),
            ));
        }

        // Extract file name
        let name_bytes = &data[name_start..name_end];
        let extra_bytes = &data[name_end..extra_end];
        reject_zip64_extra(extra_bytes)?;

        let name = decode_part_name(name_bytes, flags)?;

        let local = parse_local_file_header(data, local_header_offset)?;
        let uses_data_descriptor = flags & FLAG_DATA_DESCRIPTOR != 0;
        let local_sizes_match = if uses_data_descriptor {
            (local.crc32 == 0 || local.crc32 == crc32)
                && (local.compressed_size == 0 || local.compressed_size == compressed_size)
                && (local.uncompressed_size == 0 || local.uncompressed_size == uncompressed_size)
        } else {
            local.crc32 == crc32
                && local.compressed_size == compressed_size
                && local.uncompressed_size == uncompressed_size
        };
        if local.flags != flags
            || local.compression_method != compression_method
            || !local_sizes_match
            || local.name_bytes != name_bytes
        {
            return Err(ZipError::DataCorruptionDetail(format!(
                "{}: central-directory metadata does not match local header",
                name
            )));
        }

        // Skip directories (names ending with /)
        if !name.ends_with('/') {
            if !names.insert(name.clone()) {
                return Err(ZipError::InvalidFileName(format!(
                    "duplicate normalized ZIP part name '{}'",
                    name
                )));
            }
            entries.push(ZipEntry {
                name,
                offset: local_header_offset,
                compressed_size,
                uncompressed_size,
                compression_method,
                flags,
                crc32,
            });
        }
        headers_parsed += 1;

        // Move to next entry
        pos = entry_end;
    }

    if headers_parsed != expected_count {
        return Err(ZipError::CorruptedArchiveDetail(format!(
            "<central-directory>: expected {} headers but parsed {}",
            expected_count, headers_parsed
        )));
    }

    if pos != cd_end {
        return Err(ZipError::CorruptedArchiveDetail(
            "<central-directory>: trailing or unparsed central-directory bytes".to_string(),
        ));
    }

    Ok(entries)
}

/// Get the offset to the actual compressed data by parsing the local file header
pub fn get_data_offset(data: &[u8], local_header_offset: usize) -> Result<usize, ZipError> {
    parse_local_file_header(data, local_header_offset).map(|header| header.data_offset)
}

#[derive(Debug)]
pub(crate) struct LocalFileHeader<'a> {
    pub flags: u16,
    pub compression_method: u16,
    pub crc32: u32,
    pub compressed_size: usize,
    pub uncompressed_size: usize,
    pub name_bytes: &'a [u8],
    pub data_offset: usize,
}

/// Parse and validate a local file header.
pub(crate) fn parse_local_file_header(
    data: &[u8],
    local_header_offset: usize,
) -> Result<LocalFileHeader<'_>, ZipError> {
    // Local file header structure:
    // Offset 0: signature (4 bytes) = 0x04034b50
    // Offset 4: version needed (2 bytes)
    // Offset 6: flags (2 bytes)
    // Offset 8: compression method (2 bytes)
    // Offset 10: last mod time (2 bytes)
    // Offset 12: last mod date (2 bytes)
    // Offset 14: CRC-32 (4 bytes)
    // Offset 18: compressed size (4 bytes)
    // Offset 22: uncompressed size (4 bytes)
    // Offset 26: file name length (2 bytes)
    // Offset 28: extra field length (2 bytes)
    // Offset 30: file name (variable)
    // Followed by: extra field, then data

    let header_end = local_header_offset
        .checked_add(30)
        .ok_or(ZipError::CorruptedArchive)?;
    if header_end > data.len() {
        return Err(ZipError::CorruptedArchive);
    }

    let header = &data[local_header_offset..header_end];

    // Verify signature
    if read_u32_le(header) != LOCAL_FILE_HEADER_SIGNATURE {
        return Err(ZipError::CorruptedArchive);
    }

    let flags = read_u16_le(&header[6..]);
    let compression_method = read_u16_le(&header[8..]);
    let crc32 = read_u32_le(&header[14..]);
    let compressed_size_raw = read_u32_le(&header[18..]);
    let uncompressed_size_raw = read_u32_le(&header[22..]);
    let name_len = read_u16_le(&header[26..]) as usize;
    let extra_len = read_u16_le(&header[28..]) as usize;

    validate_flags(flags, compression_method)?;
    validate_compression_method(compression_method)?;
    if compressed_size_raw == ZIP64_U32_SENTINEL || uncompressed_size_raw == ZIP64_U32_SENTINEL {
        return Err(ZipError::UnsupportedFeature(
            "Zip64 local-header sentinels are not supported".to_string(),
        ));
    }

    let compressed_size = compressed_size_raw as usize;
    let uncompressed_size = uncompressed_size_raw as usize;
    if uncompressed_size > MAX_UNCOMPRESSED_SIZE {
        return Err(ZipError::FileTooLargeDetail {
            limit: MAX_UNCOMPRESSED_SIZE,
            actual: uncompressed_size,
        });
    }

    let name_start = header_end;
    let name_end = name_start
        .checked_add(name_len)
        .ok_or(ZipError::CorruptedArchive)?;
    let extra_end = name_end
        .checked_add(extra_len)
        .ok_or(ZipError::CorruptedArchive)?;

    if extra_end > data.len() {
        return Err(ZipError::CorruptedArchive);
    }

    let extra_bytes = &data[name_end..extra_end];
    reject_zip64_extra(extra_bytes)?;

    Ok(LocalFileHeader {
        flags,
        compression_method,
        crc32,
        compressed_size,
        uncompressed_size,
        name_bytes: &data[name_start..name_end],
        data_offset: extra_end,
    })
}

fn validate_flags(flags: u16, compression_method: u16) -> Result<(), ZipError> {
    if flags & FLAG_ENCRYPTED != 0 {
        return Err(ZipError::UnsupportedFeature(
            "encrypted ZIP entries are not supported".to_string(),
        ));
    }
    if flags & FLAG_PATCHED_DATA != 0 {
        return Err(ZipError::UnsupportedFeature(
            "patched-data ZIP entries are not supported".to_string(),
        ));
    }
    let compression_option_flags = FLAG_DEFLATE_OPTION_1 | FLAG_DEFLATE_OPTION_2;
    if compression_method != COMPRESSION_DEFLATE && flags & compression_option_flags != 0 {
        return Err(ZipError::UnsupportedFeature(format!(
            "general-purpose ZIP compression option flags 0x{:04x} are only supported for DEFLATE entries",
            flags & compression_option_flags
        )));
    }
    let mut allowed = FLAG_UTF8_NAME | FLAG_DATA_DESCRIPTOR;
    if compression_method == COMPRESSION_DEFLATE {
        allowed |= compression_option_flags;
    }
    let unknown = flags & !allowed;
    if unknown != 0 {
        return Err(ZipError::UnsupportedFeature(format!(
            "general-purpose ZIP flags 0x{unknown:04x} are not supported"
        )));
    }
    Ok(())
}

fn validate_compression_method(method: u16) -> Result<(), ZipError> {
    match method {
        COMPRESSION_STORE | COMPRESSION_DEFLATE => Ok(()),
        other => Err(ZipError::UnsupportedCompression(other)),
    }
}

fn reject_zip64_extra(mut extra: &[u8]) -> Result<(), ZipError> {
    while extra.len() >= 4 {
        let header_id = read_u16_le(extra);
        let data_size = read_u16_le(&extra[2..]) as usize;
        if header_id == ZIP64_EXTRA_FIELD_ID {
            return Err(ZipError::UnsupportedFeature(
                "Zip64 extra fields are not supported".to_string(),
            ));
        }
        let next = 4usize
            .checked_add(data_size)
            .ok_or(ZipError::CorruptedArchive)?;
        if next > extra.len() {
            return Err(ZipError::CorruptedArchiveDetail(
                "<central-directory>: truncated ZIP extra field".to_string(),
            ));
        }
        extra = &extra[next..];
    }
    if !extra.is_empty() {
        return Err(ZipError::CorruptedArchiveDetail(
            "<central-directory>: truncated ZIP extra field header".to_string(),
        ));
    }
    Ok(())
}

fn decode_part_name(name_bytes: &[u8], flags: u16) -> Result<String, ZipError> {
    if name_bytes.is_empty() {
        return Err(ZipError::InvalidFileName("empty ZIP part name".to_string()));
    }

    let raw = escaped_bytes(name_bytes);
    let decoded = if flags & FLAG_UTF8_NAME != 0 {
        std::str::from_utf8(name_bytes).map_err(|_| {
            ZipError::InvalidFileName(format!(
                "UTF-8 filename flag set but raw name bytes are invalid UTF-8: {raw}"
            ))
        })?
    } else {
        if !name_bytes.iter().all(u8::is_ascii) {
            return Err(ZipError::InvalidFileName(format!(
                "filename lacks UTF-8 flag and contains non-ASCII bytes: {raw}"
            )));
        }
        std::str::from_utf8(name_bytes).map_err(|_| {
            ZipError::InvalidFileName(format!("invalid ASCII ZIP part name bytes: {raw}"))
        })?
    };

    normalize_part_name(decoded, &raw)
}

fn normalize_part_name(decoded: &str, raw: &str) -> Result<String, ZipError> {
    let normalized = decoded.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(':') {
        return Err(ZipError::InvalidFileName(format!(
            "unsafe absolute or drive-qualified ZIP part name: {raw}"
        )));
    }
    let is_directory = normalized.ends_with('/');
    for (idx, component) in normalized.split('/').enumerate() {
        let is_final_empty_dir_marker = is_directory && idx == normalized.split('/').count() - 1;
        if is_final_empty_dir_marker {
            continue;
        }
        if component.is_empty() || component == "." || component == ".." {
            return Err(ZipError::InvalidFileName(format!(
                "unsafe ZIP part path component in raw name bytes: {raw}"
            )));
        }
    }
    Ok(normalized)
}

fn escaped_bytes(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("\\x{b:02x}"))
        .collect::<Vec<_>>()
        .join("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_u16_le() {
        assert_eq!(read_u16_le(&[0x34, 0x12]), 0x1234);
        assert_eq!(read_u16_le(&[0xFF, 0xFF]), 0xFFFF);
        assert_eq!(read_u16_le(&[0x00, 0x00]), 0x0000);
    }

    #[test]
    fn test_read_u32_le() {
        assert_eq!(read_u32_le(&[0x78, 0x56, 0x34, 0x12]), 0x12345678);
        assert_eq!(read_u32_le(&[0xFF, 0xFF, 0xFF, 0xFF]), 0xFFFFFFFF);
        assert_eq!(read_u32_le(&[0x00, 0x00, 0x00, 0x00]), 0x00000000);
    }
}
