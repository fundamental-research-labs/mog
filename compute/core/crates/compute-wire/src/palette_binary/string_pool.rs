//! String interning for palette binary serialization.

use std::collections::HashMap;

// ---------------------------------------------------------------------------
// String pool builder (interning)
// ---------------------------------------------------------------------------

pub(super) struct StringPool {
    /// Maps string content to (offset, length) in the pool.
    index: HashMap<String, (u32, u16)>,
    /// Raw UTF-8 bytes.
    bytes: Vec<u8>,
}

impl StringPool {
    pub(super) fn new() -> Self {
        Self {
            index: HashMap::new(),
            bytes: Vec::new(),
        }
    }

    /// Intern a string, returning its (offset, length) `StrRef`.
    pub(super) fn intern(&mut self, s: &str) -> (u32, u16) {
        if let Some(&entry) = self.index.get(s) {
            return entry;
        }
        #[allow(clippy::cast_possible_truncation)]
        let offset = self.bytes.len() as u32;
        #[allow(clippy::cast_possible_truncation)]
        let length = s.len() as u16;
        self.bytes.extend_from_slice(s.as_bytes());
        let entry = (offset, length);
        self.index.insert(s.to_owned(), entry);
        entry
    }

    /// Consume the pool and return the raw bytes.
    pub(super) fn finish(self) -> Vec<u8> {
        self.bytes
    }
}
