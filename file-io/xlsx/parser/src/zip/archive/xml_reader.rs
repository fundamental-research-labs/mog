//! Bounded XML reads for package validation, sharing worksheet inflate checks.

use std::io::{self, BufRead, Read};

use crate::pipeline::streaming::{DEFAULT_BUFFER_SIZE, StreamingDeflate};
use crate::zip::{CompressedEntry, ZipError};

use super::XlsxArchive;

pub(super) struct XmlEntryReader<'a, 'data> {
    archive: &'a XlsxArchive<'data>,
    source: XmlSource<'a>,
    buffer: Vec<u8>,
    position: usize,
}

enum XmlSource<'a> {
    Stored(&'a [u8]),
    Deflate(Box<StreamingDeflate<'a>>),
}

impl<'a, 'data> XmlEntryReader<'a, 'data> {
    pub(super) fn new(
        archive: &'a XlsxArchive<'data>,
        entry: CompressedEntry<'a>,
    ) -> Result<Self, ZipError> {
        if entry.uncompressed_size > entry.output_limit {
            return Err(ZipError::FileTooLargeDetail {
                limit: entry.output_limit,
                actual: entry.uncompressed_size,
            });
        }
        let source = match entry.compression_method {
            0 => {
                if entry.data.len() != entry.uncompressed_size {
                    return Err(ZipError::DataCorruptionDetail(format!(
                        "{}: stored XML size differs from declared size",
                        entry.name
                    )));
                }
                if crc32fast::hash(entry.data) != entry.crc32 {
                    return Err(ZipError::DataCorruptionDetail(format!(
                        "{}: stored XML CRC mismatch",
                        entry.name
                    )));
                }
                super::validation::validate_xml_part_utf8(entry.name, entry.data)?;
                archive.charge_uncompressed(entry.data.len())?;
                XmlSource::Stored(entry.data)
            }
            8 => XmlSource::Deflate(Box::new(StreamingDeflate::new(
                entry.data,
                DEFAULT_BUFFER_SIZE,
                entry.uncompressed_size,
                entry.output_limit,
                entry.crc32,
            )?)),
            method => return Err(ZipError::UnsupportedCompression(method)),
        };
        Ok(Self {
            archive,
            source,
            buffer: Vec::new(),
            position: 0,
        })
    }
}

impl BufRead for XmlEntryReader<'_, '_> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        match &mut self.source {
            XmlSource::Stored(bytes) => Ok(&bytes[..bytes.len().min(DEFAULT_BUFFER_SIZE)]),
            XmlSource::Deflate(inflate) => {
                while self.position == self.buffer.len() {
                    let chunk = inflate.next_chunk().map_err(|error| {
                        io::Error::other(self.archive.remember_zip_error(error))
                    })?;
                    self.position = 0;
                    self.buffer.clear();
                    match chunk {
                        Some(chunk) => {
                            self.archive
                                .charge_uncompressed(chunk.len())
                                .map_err(|error| {
                                    io::Error::other(self.archive.remember_zip_error(error))
                                })?;
                            self.buffer.extend_from_slice(chunk);
                        }
                        None => return Ok(&[]),
                    }
                }
                Ok(&self.buffer[self.position..])
            }
        }
    }

    fn consume(&mut self, amount: usize) {
        match &mut self.source {
            XmlSource::Stored(bytes) => *bytes = &bytes[amount.min(bytes.len())..],
            XmlSource::Deflate(_) => {
                self.position = (self.position + amount).min(self.buffer.len())
            }
        }
    }
}

impl Read for XmlEntryReader<'_, '_> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        let input = self.fill_buf()?;
        let size = output.len().min(input.len());
        output[..size].copy_from_slice(&input[..size]);
        self.consume(size);
        Ok(size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::{CompressionMethod, ZipWriter};

    #[test]
    fn xml_reader_is_bounded_and_preserves_multibyte_text_with_short_reads() {
        let text = "<c><v>€ &amp; 漢字</v></c>".repeat(6000);
        for method in [CompressionMethod::Store, CompressionMethod::Deflate(6)] {
            let mut zip = ZipWriter::with_compression(method);
            zip.add_file("test.xml", text.as_bytes());
            let bytes = zip.finish().unwrap();
            let archive = XlsxArchive::new(&bytes).unwrap();
            let mut reader =
                XmlEntryReader::new(&archive, archive.get_compressed_data("test.xml").unwrap())
                    .unwrap();
            let mut output = Vec::new();
            let mut chunk = [0; 17];
            loop {
                let count = reader.read(&mut chunk).unwrap();
                if count == 0 {
                    break;
                }
                output.extend_from_slice(&chunk[..count]);
                assert!(reader.buffer.len() <= DEFAULT_BUFFER_SIZE + 4);
            }
            assert_eq!(output, text.as_bytes());
            assert_eq!(archive.materialized_uncompressed.get(), text.len());
        }
    }

    #[test]
    fn xml_reader_checks_crc_and_declared_size_for_both_methods() {
        for method in [CompressionMethod::Store, CompressionMethod::Deflate(6)] {
            let mut zip = ZipWriter::with_compression(method);
            zip.add_file("test.xml", b"<worksheet/>");
            let bytes = zip.finish().unwrap();
            let archive = XlsxArchive::new(&bytes).unwrap();
            for corrupt_crc in [true, false] {
                let mut entry = archive.get_compressed_data("test.xml").unwrap();
                if corrupt_crc {
                    entry.crc32 ^= 1;
                } else {
                    entry.uncompressed_size += 1;
                }
                let result = XmlEntryReader::new(&archive, entry)
                    .map_err(io::Error::other)
                    .and_then(|mut reader| io::copy(&mut reader, &mut io::sink()));
                assert!(result.is_err(), "{method:?}, corrupt_crc={corrupt_crc}");
            }
            let mut entry = archive.get_compressed_data("test.xml").unwrap();
            entry.output_limit = 1;
            assert!(matches!(
                XmlEntryReader::new(&archive, entry),
                Err(ZipError::FileTooLargeDetail { .. })
            ));
        }
    }
    #[test]
    fn xml_reader_preserves_the_cumulative_read_budget() {
        for method in [CompressionMethod::Store, CompressionMethod::Deflate(6)] {
            let mut zip = ZipWriter::with_compression(method);
            zip.add_file("test.xml", b"<worksheet/>");
            let bytes = zip.finish().unwrap();
            let archive = XlsxArchive::new(&bytes).unwrap();
            archive
                .materialized_uncompressed
                .set(crate::zip::constants::MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE - 1);
            let result = archive
                .xml_reader("test.xml")
                .map_err(io::Error::other)
                .and_then(|mut reader| io::copy(&mut reader, &mut io::sink()));
            assert!(result.is_err());
            assert!(archive.fatal_safety_error().is_some());
        }
    }
}
