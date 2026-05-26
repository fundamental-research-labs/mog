//! Memory-mapped I/O module for high-performance XLSX file reading.
//!
//! This module provides memory-mapped file access for large XLSX files (>100MB),
//! eliminating file read overhead by mapping the file directly into virtual memory.
//!
//! This module is only available on native platforms (not WASM).
//! It is a trusted-local-file optimization; untrusted XLSX byte imports should
//! use the owned-bytes parser path.

#![cfg(not(target_arch = "wasm32"))]

use memmap2::Mmap;
use std::fs::File;
use std::io::Result;
use std::path::Path;

/// Threshold for using memory mapping (100MB).
/// Files larger than this should use mmap for better performance.
pub const MMAP_THRESHOLD: usize = 100 * 1024 * 1024;

/// A memory-mapped XLSX file wrapper.
///
/// This struct provides efficient read-only access to large files by mapping
/// them directly into the process's virtual memory space, avoiding explicit
/// read calls and leveraging the operating system's page cache.
///
/// # Example
///
/// ```ignore
/// use xlsx_parser::mmap::MmapXlsxFile;
///
/// // SAFETY: The caller controls this trusted local file and guarantees it is
/// // not mutated or truncated while `mapped_file` is alive.
/// let mapped_file = unsafe { MmapXlsxFile::open("large_file.xlsx")? };
/// let data = mapped_file.as_slice();
/// println!("File size: {} bytes", mapped_file.len());
/// ```
pub struct MmapXlsxFile {
    mmap: Mmap,
}

impl MmapXlsxFile {
    /// Opens a file and creates a memory mapping.
    ///
    /// # Arguments
    ///
    /// * `path` - The path to the file to open and map.
    ///
    /// # Returns
    ///
    /// Returns `Ok(MmapXlsxFile)` on success, or an `Err` containing the I/O error.
    ///
    /// # Safety
    ///
    /// This creates a read-only memory mapping for the native large-file
    /// optimization path and is intended only for trusted local files. Safe
    /// ingestion of untrusted XLSX payloads must use the owned-bytes parser path.
    ///
    /// The caller must ensure the backing file is not mutated or truncated for
    /// the lifetime of the returned mapping. Violating that invariant can cause
    /// undefined behavior, not merely an I/O error or process abort.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The file cannot be opened
    /// - The memory mapping cannot be created
    pub unsafe fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let file = File::open(path)?;
        // SAFETY: We create a read-only mapping for a trusted local file. Callers
        // must ensure no other process mutates or truncates the file for the
        // lifetime of the mapping; otherwise memmap can observe undefined
        // behavior.
        let mmap = unsafe { Mmap::map(&file)? };
        Ok(Self { mmap })
    }

    /// Returns a slice of the entire memory-mapped file contents.
    ///
    /// This operation is essentially free as it just returns a reference
    /// to the already-mapped memory region.
    #[inline]
    pub fn as_slice(&self) -> &[u8] {
        &self.mmap
    }

    /// Returns the size of the memory-mapped file in bytes.
    #[inline]
    pub fn len(&self) -> usize {
        self.mmap.len()
    }

    /// Returns true if the file is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.mmap.is_empty()
    }
}

/// Determines whether memory mapping should be used for a file of the given size.
///
/// Memory mapping provides significant performance benefits for large files by:
/// - Avoiding explicit read system calls
/// - Leveraging the OS page cache efficiently
/// - Enabling random access without seeking
///
/// For smaller files, the overhead of setting up a memory mapping may not be
/// worth the benefits, so regular file I/O is preferred.
///
/// # Arguments
///
/// * `file_size` - The size of the file in bytes.
///
/// # Returns
///
/// Returns `true` if the file size exceeds the [`MMAP_THRESHOLD`] (100MB).
#[inline]
pub fn should_use_mmap(file_size: u64) -> bool {
    file_size > MMAP_THRESHOLD as u64
}

#[cfg(all(test, not(target_arch = "wasm32"), feature = "native"))]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn create_temp_file_with_content(content: &[u8]) -> NamedTempFile {
        let mut file = NamedTempFile::new().expect("Failed to create temp file");
        file.write_all(content)
            .expect("Failed to write to temp file");
        file.flush().expect("Failed to flush temp file");
        file
    }

    #[test]
    fn test_mmap_open_and_read() {
        let content = b"Hello, memory-mapped world!";
        let temp_file = create_temp_file_with_content(content);

        // SAFETY: The test owns the temporary file and does not mutate or
        // truncate it while the mapping is alive.
        let mmap_file =
            unsafe { MmapXlsxFile::open(temp_file.path()) }.expect("Failed to open mmap file");

        assert_eq!(mmap_file.as_slice(), content);
        assert_eq!(mmap_file.len(), content.len());
        assert!(!mmap_file.is_empty());
    }

    #[test]
    fn test_mmap_empty_file() {
        let temp_file = create_temp_file_with_content(b"");

        // SAFETY: The test owns the temporary file and does not mutate or
        // truncate it while the mapping is alive.
        let mmap_file =
            unsafe { MmapXlsxFile::open(temp_file.path()) }.expect("Failed to open mmap file");

        assert!(mmap_file.is_empty());
        assert_eq!(mmap_file.len(), 0);
        assert_eq!(mmap_file.as_slice(), &[] as &[u8]);
    }

    #[test]
    fn test_mmap_open_nonexistent_file() {
        // SAFETY: This call is expected to fail before any mapping is created,
        // so no backing-file stability obligation is reached.
        let result = unsafe { MmapXlsxFile::open("/nonexistent/path/to/file.xlsx") };
        assert!(result.is_err());
    }

    #[test]
    fn test_mmap_large_content() {
        // Create a file with 1MB of data
        let content: Vec<u8> = (0u8..=255).cycle().take(1024 * 1024).collect();
        let temp_file = create_temp_file_with_content(&content);

        // SAFETY: The test owns the temporary file and does not mutate or
        // truncate it while the mapping is alive.
        let mmap_file =
            unsafe { MmapXlsxFile::open(temp_file.path()) }.expect("Failed to open mmap file");

        assert_eq!(mmap_file.len(), content.len());
        assert_eq!(mmap_file.as_slice(), content.as_slice());
    }

    #[test]
    fn test_should_use_mmap_below_threshold() {
        // 50MB - below threshold
        assert!(!should_use_mmap(50 * 1024 * 1024));
    }

    #[test]
    fn test_should_use_mmap_at_threshold() {
        // Exactly at threshold - should return false (not greater than)
        assert!(!should_use_mmap(MMAP_THRESHOLD as u64));
    }

    #[test]
    fn test_should_use_mmap_above_threshold() {
        // 150MB - above threshold
        assert!(should_use_mmap(150 * 1024 * 1024));
    }

    #[test]
    fn test_should_use_mmap_zero_size() {
        assert!(!should_use_mmap(0));
    }

    #[test]
    fn test_mmap_threshold_value() {
        // Verify the threshold is 100MB
        assert_eq!(MMAP_THRESHOLD, 100 * 1024 * 1024);
        assert_eq!(MMAP_THRESHOLD, 104_857_600);
    }
}
