//! Memory-mapped XLSX parsing.
//!
//! Available only with the `native` feature.
//! Optimal for files >100MB — uses OS page cache, no explicit read().

use std::path::Path;

use crate::error::XlsxApiError;
use crate::parse::ParsedWorkbook;

pub use xlsx_parser::pipeline::mmap::{MMAP_THRESHOLD, should_use_mmap};

/// Parse an XLSX file using memory-mapped I/O.
///
/// The file is mapped into the process address space using `mmap`,
/// then parsed using the standard full-parse pipeline via [`crate::parse::parse`].
///
/// This is optimal for files >100MB where the OS page cache avoids
/// explicit read() overhead. For smaller files, regular [`crate::parse::parse`]
/// with `std::fs::read` is fine.
///
/// Requires the `native` feature flag.
///
/// # Arguments
/// * `path` — Path to the .xlsx file on disk.
///
/// # Example
/// ```ignore
/// use xlsx_api::mmap::mmap_parse;
/// use std::path::Path;
///
/// // SAFETY: The caller controls this trusted local file and guarantees it is
/// // not mutated or truncated for the duration of parsing.
/// let wb = unsafe { mmap_parse(Path::new("huge_workbook.xlsx"))? };
/// println!("{} sheets", wb.result.sheets.len());
/// ```
///
/// # Safety
///
/// This uses a read-only memory mapping for the native large-file optimization
/// path and is intended only for trusted local files. Safe ingestion of
/// untrusted XLSX payloads must use [`crate::parse::parse`] with owned bytes.
///
/// The caller must ensure the backing file is not mutated or truncated for the
/// lifetime of the mapping created during parsing. Violating that invariant can
/// cause undefined behavior, not merely an I/O error or process abort.
pub unsafe fn mmap_parse(path: &Path) -> Result<ParsedWorkbook, XlsxApiError> {
    use xlsx_parser::pipeline::mmap::MmapXlsxFile;

    // SAFETY: This facade intentionally carries the same file-stability
    // invariant as `MmapXlsxFile::open`; callers of this unsafe function must
    // guarantee the backing file is not mutated or truncated during parsing.
    let mapped = unsafe { MmapXlsxFile::open(path) }.map_err(|e| {
        XlsxApiError::InvalidArchive(format!("failed to mmap file {}: {}", path.display(), e))
    })?;

    crate::parse::parse(mapped.as_slice())
}

/// Parse an XLSX file using memory-mapped I/O with custom options.
///
/// Same as [`mmap_parse`] but accepts [`crate::options::ParseOptions`] for
/// mode selection (Strict/Lenient/Permissive) and profiling.
///
/// # Arguments
/// * `path` — Path to the .xlsx file on disk.
/// * `options` — Parse configuration.
///
/// # Safety
///
/// This uses a read-only memory mapping for the native large-file optimization
/// path and is intended only for trusted local files. Safe ingestion of
/// untrusted XLSX payloads must use [`crate::parse::parse_with_options`] with
/// owned bytes.
///
/// The caller must ensure the backing file is not mutated or truncated for the
/// lifetime of the mapping created during parsing. Violating that invariant can
/// cause undefined behavior, not merely an I/O error or process abort.
pub unsafe fn mmap_parse_with_options(
    path: &Path,
    options: &crate::options::ParseOptions,
) -> Result<ParsedWorkbook, XlsxApiError> {
    use xlsx_parser::pipeline::mmap::MmapXlsxFile;

    // SAFETY: This facade intentionally carries the same file-stability
    // invariant as `MmapXlsxFile::open`; callers of this unsafe function must
    // guarantee the backing file is not mutated or truncated during parsing.
    let mapped = unsafe { MmapXlsxFile::open(path) }.map_err(|e| {
        XlsxApiError::InvalidArchive(format!("failed to mmap file {}: {}", path.display(), e))
    })?;

    crate::parse::parse_with_options(mapped.as_slice(), options)
}
