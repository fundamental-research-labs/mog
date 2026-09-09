//! String interning helpers for viewport binary sections.

use std::collections::HashMap;

use crate::constants::NO_STRING;

/// Deduplicated string pool for viewport binary serialization.
///
/// Tracks previously interned strings so identical strings are stored only
/// once, returning the existing `(offset, length)` on cache hits.
pub(super) struct DedupStringPool {
    pool: Vec<u8>,
    index: HashMap<String, (u32, u16)>,
}

impl DedupStringPool {
    /// Create a new pool with an estimated initial capacity.
    pub(super) fn with_capacity(estimated_bytes: usize) -> Self {
        Self {
            pool: Vec::with_capacity(estimated_bytes),
            index: HashMap::new(),
        }
    }

    /// Intern an optional string, returning `(offset, len)` or `(NO_STRING, 0)`.
    #[inline]
    pub(super) fn intern_optional(&mut self, text: Option<&str>) -> (u32, u16) {
        match text {
            Some(s) => self.intern(s),
            None => (NO_STRING, 0),
        }
    }

    /// Intern a `&str`, returning `(offset, len)`.
    ///
    /// Strings longer than `u16::MAX` bytes are truncated at a UTF-8 boundary.
    #[inline]
    #[allow(clippy::cast_possible_truncation)] // pool offset < 4 GB; len guarded below
    pub(super) fn intern(&mut self, s: &str) -> (u32, u16) {
        if let Some(&entry) = self.index.get(s) {
            return entry;
        }
        let bytes = s.as_bytes();
        let truncated = truncate_to_u16_boundary(s, bytes);
        let off = self.pool.len() as u32;
        let len = truncated.len() as u16;
        self.pool.extend_from_slice(truncated);
        let entry = (off, len);
        self.index.insert(s.to_owned(), entry);
        entry
    }

    /// Consume the pool, returning the raw byte buffer.
    pub(super) fn into_bytes(self) -> Vec<u8> {
        self.pool
    }
}

fn truncate_to_u16_boundary<'a>(s: &str, bytes: &'a [u8]) -> &'a [u8] {
    if bytes.len() > u16::MAX as usize {
        let mut end = u16::MAX as usize;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &bytes[..end]
    } else {
        bytes
    }
}
