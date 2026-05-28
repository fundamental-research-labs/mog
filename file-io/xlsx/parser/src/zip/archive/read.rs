use super::super::central_dir::get_data_offset;
use super::super::constants::{COMPRESSION_DEFLATE, COMPRESSION_STORE, MAX_UNCOMPRESSED_SIZE};
use super::super::decompress::decompress_deflate;
use super::super::entry::ZipEntry;
use super::super::error::ZipError;
use super::XlsxArchive;
use super::validation::validate_xml_part_utf8;

impl<'a> XlsxArchive<'a> {
    /// Read a file from the archive by name
    ///
    /// # Arguments
    /// * `name` - Path to the file within the archive
    ///
    /// # Returns
    /// * `Ok(Vec<u8>)` - Decompressed file contents
    /// * `Err(ZipError)` - File not found or decompression error
    pub fn read_file(&self, name: &str) -> Result<Vec<u8>, ZipError> {
        // Find the entry
        let entry = self
            .entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| ZipError::FileNotFound(name.to_string()))?;

        self.read_entry(entry, true, true)
            .map_err(|e| self.remember_zip_error(e))
    }

    /// Read a file verbatim for lossless passthrough.
    ///
    /// This preserves ZIP safety checks (size, decompression, CRC, and
    /// relationship-count limits) but skips the UTF-8 precondition for XML-like
    /// paths. Use this only for parts that are stored and re-emitted as opaque
    /// bytes, not for XML that the parser interprets.
    pub fn read_file_verbatim(&self, name: &str) -> Result<Vec<u8>, ZipError> {
        let entry = self
            .entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| ZipError::FileNotFound(name.to_string()))?;

        self.read_entry(entry, true, false)
            .map_err(|e| self.remember_zip_error(e))
    }

    /// Read a file using a ZipEntry reference
    pub(super) fn read_entry(
        &self,
        entry: &ZipEntry,
        charge_materialized: bool,
        validate_xml_utf8: bool,
    ) -> Result<Vec<u8>, ZipError> {
        // Validate sizes
        if entry.uncompressed_size > MAX_UNCOMPRESSED_SIZE {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_UNCOMPRESSED_SIZE,
                actual: entry.uncompressed_size,
            });
        }

        // Get compressed data offset by parsing local file header
        let compressed_offset = get_data_offset(self.data, entry.offset)?;

        // Validate we have enough data
        let data_end = compressed_offset
            .checked_add(entry.compressed_size)
            .ok_or(ZipError::CorruptedArchive)?;
        if data_end > self.data.len() {
            return Err(ZipError::CorruptedArchive);
        }

        let compressed_data = &self.data[compressed_offset..data_end];

        let output = match entry.compression_method {
            COMPRESSION_STORE => {
                if entry.compressed_size != entry.uncompressed_size {
                    return Err(ZipError::DataCorruptionDetail(format!(
                        "{}: stored entry compressed size {} does not match uncompressed size {}",
                        entry.name, entry.compressed_size, entry.uncompressed_size
                    )));
                }
                if compressed_data.len() != entry.uncompressed_size {
                    return Err(ZipError::DataCorruptionDetail(format!(
                        "{}: stored entry actual data length {} does not match declared uncompressed size {}",
                        entry.name,
                        compressed_data.len(),
                        entry.uncompressed_size
                    )));
                }
                Ok(compressed_data.to_vec())
            }
            COMPRESSION_DEFLATE => {
                // DEFLATE compression - use raw deflate decompression
                let data = decompress_deflate(compressed_data, entry.uncompressed_size)?;
                if data.len() != entry.uncompressed_size {
                    return Err(ZipError::DataCorruptionDetail(format!(
                        "{}: decompressed size {} does not match declared uncompressed size {}",
                        entry.name,
                        data.len(),
                        entry.uncompressed_size
                    )));
                }
                Ok(data)
            }
            method => Err(ZipError::UnsupportedCompression(method)),
        }?;

        self.validate_crc(entry, &output)?;
        if validate_xml_utf8 {
            validate_xml_part_utf8(&entry.name, &output)?;
        }
        self.charge_relationship_records(entry, &output)?;
        if charge_materialized {
            self.charge_materialized(entry, output.len())?;
        }
        Ok(output)
    }

    /// Read a file directly into a pre-allocated buffer (zero-copy when possible)
    ///
    /// # Arguments
    /// * `name` - Path to the file within the archive
    /// * `output` - Pre-allocated buffer to write decompressed data
    ///
    /// # Returns
    /// Number of bytes written or a `ZipError`
    pub fn read_file_into(&self, name: &str, output: &mut [u8]) -> Result<usize, ZipError> {
        let entry = self
            .entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| ZipError::FileNotFound(name.to_string()))?;

        let decompressed = self
            .read_entry(entry, false, true)
            .map_err(|e| self.remember_zip_error(e))?;
        if output.len() < decompressed.len() {
            return Err(ZipError::FileTooLargeDetail {
                limit: output.len(),
                actual: decompressed.len(),
            });
        }
        output[..decompressed.len()].copy_from_slice(&decompressed);
        self.charge_materialized(entry, decompressed.len())
            .map_err(|e| self.remember_zip_error(e))?;
        Ok(decompressed.len())
    }
}
