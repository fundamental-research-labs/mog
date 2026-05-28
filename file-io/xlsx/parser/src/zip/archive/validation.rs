use crc32fast::Hasher;

use super::super::constants::{
    MAX_RELATIONSHIPS_PER_PART, MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE,
    MAX_TOTAL_RELATIONSHIP_RECORDS,
};
use super::super::entry::ZipEntry;
use super::super::error::ZipError;
use super::XlsxArchive;

impl<'a> XlsxArchive<'a> {
    pub(super) fn validate_crc(&self, entry: &ZipEntry, data: &[u8]) -> Result<(), ZipError> {
        let mut hasher = Hasher::new();
        hasher.update(data);
        let actual_crc = hasher.finalize();
        if actual_crc != entry.crc32 {
            return Err(ZipError::DataCorruptionDetail(format!(
                "{}: CRC mismatch, declared compressed_size={}, declared uncompressed_size={}, actual_output_bytes={}, method={}, expected {:08x}, got {:08x}",
                entry.name,
                entry.compressed_size,
                entry.uncompressed_size,
                data.len(),
                entry.compression_method,
                entry.crc32,
                actual_crc
            )));
        }
        Ok(())
    }

    pub(super) fn charge_materialized(
        &self,
        entry: &ZipEntry,
        bytes: usize,
    ) -> Result<(), ZipError> {
        let new_total = self
            .materialized_uncompressed
            .get()
            .checked_add(bytes)
            .ok_or(ZipError::FileTooLarge)?;
        if new_total > MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE,
                actual: new_total,
            });
        }
        self.materialized_uncompressed.set(new_total);
        let _ = entry;
        Ok(())
    }

    pub(super) fn charge_relationship_records(
        &self,
        entry: &ZipEntry,
        data: &[u8],
    ) -> Result<(), ZipError> {
        if !entry.name.ends_with(".rels") {
            return Ok(());
        }

        let record_count = count_relationship_elements(data);
        if record_count > MAX_RELATIONSHIPS_PER_PART {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_RELATIONSHIPS_PER_PART,
                actual: record_count,
            });
        }

        let mut charged = self.relationship_record_counts.borrow_mut();
        if charged.contains_key(&entry.name) {
            return Ok(());
        }

        let new_total = charged
            .values()
            .try_fold(record_count, |acc, value| acc.checked_add(*value))
            .ok_or(ZipError::FileTooLarge)?;
        if new_total > MAX_TOTAL_RELATIONSHIP_RECORDS {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_TOTAL_RELATIONSHIP_RECORDS,
                actual: new_total,
            });
        }
        charged.insert(entry.name.clone(), record_count);
        Ok(())
    }

    pub(super) fn remember_zip_error(&self, error: ZipError) -> ZipError {
        if error.is_safety_fatal() {
            let mut fatal = self.fatal_safety_error.borrow_mut();
            if fatal.is_none() {
                *fatal = Some(error.clone());
            }
        }
        error
    }
}

pub(super) fn validate_xml_part_utf8(part_name: &str, data: &[u8]) -> Result<(), ZipError> {
    if !(part_name.ends_with(".xml") || part_name.ends_with(".rels")) {
        return Ok(());
    }
    std::str::from_utf8(data).map_err(|err| {
        ZipError::DataCorruptionDetail(format!(
            "{}: XML part is not valid UTF-8 at byte {}",
            part_name,
            err.valid_up_to()
        ))
    })?;
    Ok(())
}

pub(super) fn count_relationship_elements(xml: &[u8]) -> usize {
    let mut count = 0usize;
    let mut pos = 0usize;
    while let Some(rel) = memchr::memmem::find(&xml[pos..], b"<Relationship") {
        let start = pos + rel;
        let next = start + b"<Relationship".len();
        if next >= xml.len() || matches!(xml[next], b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r') {
            count += 1;
        }
        pos = next;
    }
    count
}
