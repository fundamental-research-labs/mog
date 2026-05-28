use super::super::central_dir::get_data_offset;
use super::super::constants::MAX_UNCOMPRESSED_SIZE;
use super::super::entry::CompressedEntry;
use super::super::error::ZipError;
use super::XlsxArchive;

impl<'a> XlsxArchive<'a> {
    // =========================================================================
    // Streaming Support Methods
    // =========================================================================

    /// Get the raw compressed data for a file entry.
    ///
    /// This method returns the compressed bytes directly without decompressing,
    /// allowing for streaming decompression with `StreamingDeflate`.
    ///
    /// # Arguments
    /// * `name` - Path to the file within the archive
    ///
    /// # Returns
    /// * `Ok(CompressedEntry)` - The compressed data and metadata
    /// * `Err(ZipError)` - File not found or invalid entry
    ///
    /// # Example
    /// ```ignore
    /// use xlsx_parser::streaming::StreamingDeflate;
    ///
    /// let entry = archive.get_compressed_data("xl/worksheets/sheet1.xml")?;
    /// if entry.compression_method == 8 {
    ///     let mut decompressor = StreamingDeflate::new(
    ///         entry.data,
    ///         64 * 1024,
    ///         entry.uncompressed_size,
    ///         entry.output_limit,
    ///         entry.crc32,
    ///     )?;
    ///     while let Some(chunk) = decompressor.next_chunk()? {
    ///         // Process decompressed chunk
    ///     }
    /// }
    /// ```
    pub fn get_compressed_data(&self, name: &str) -> Result<CompressedEntry<'_>, ZipError> {
        let result = (|| {
            // Find the entry
            let entry = self
                .entries
                .iter()
                .find(|e| e.name == name)
                .ok_or_else(|| ZipError::FileNotFound(name.to_string()))?;

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

            Ok(CompressedEntry {
                name: entry.name.as_str(),
                data: compressed_data,
                compression_method: entry.compression_method,
                flags: entry.flags,
                uncompressed_size: entry.uncompressed_size,
                crc32: entry.crc32,
                output_limit: MAX_UNCOMPRESSED_SIZE,
            })
        })();

        result.map_err(|e| self.remember_zip_error(e))
    }

    /// Get the raw compressed data for a worksheet by 1-based index.
    ///
    /// This is a convenience method for streaming worksheet parsing.
    ///
    /// # Arguments
    /// * `index` - 1-based worksheet index (sheet1, sheet2, etc.)
    ///
    /// # Returns
    /// * `Ok(CompressedEntry)` - The compressed worksheet data
    /// * `Err(ZipError)` - Worksheet not found or invalid entry
    pub fn get_worksheet_compressed(&self, index: usize) -> Result<CompressedEntry<'_>, ZipError> {
        let name = format!("xl/worksheets/sheet{}.xml", index);
        self.get_compressed_data(&name)
    }
}
