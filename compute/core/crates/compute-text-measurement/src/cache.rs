use rustc_hash::FxHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

/// Maximum number of cached entries.
const MAX_CACHE_SIZE: usize = 10_000;

/// Cache key: font_id + font_size (as bits) + text hash.
/// Using u64 text hash instead of String avoids allocation per lookup.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct CacheKey {
    font_id: u16,
    font_size_bits: u32,
    text_hash: u64,
}

/// LRU-approximated measurement cache.
///
/// Uses a simple HashMap with periodic eviction rather than a full LRU list
/// to avoid pointer-chasing overhead. When the cache exceeds MAX_CACHE_SIZE,
/// we clear the oldest half (approximated by clearing the entire map --
/// for autofit's access pattern this is fine since we iterate columns
/// sequentially and rarely revisit).
pub struct MeasurementCache {
    map: HashMap<CacheKey, f32>,
}

impl MeasurementCache {
    pub fn new() -> Self {
        Self {
            map: HashMap::with_capacity(MAX_CACHE_SIZE / 2),
        }
    }

    /// Look up a cached width measurement.
    pub fn get(&self, font_id: u16, font_size: f32, text: &str) -> Option<f32> {
        let key = make_key(font_id, font_size, text);
        self.map.get(&key).copied()
    }

    /// Store a width measurement in the cache.
    pub fn put(&mut self, font_id: u16, font_size: f32, text: &str, width: f32) {
        if self.map.len() >= MAX_CACHE_SIZE {
            self.map.clear(); // Simple eviction — fine for sequential column iteration
        }
        let key = make_key(font_id, font_size, text);
        self.map.insert(key, width);
    }

    /// Clear all cached entries.
    pub fn clear(&mut self) {
        self.map.clear();
    }
}

impl Default for MeasurementCache {
    fn default() -> Self {
        Self::new()
    }
}

fn make_key(font_id: u16, font_size: f32, text: &str) -> CacheKey {
    let mut hasher = FxHasher::default();
    text.hash(&mut hasher);
    CacheKey {
        font_id,
        font_size_bits: font_size.to_bits(),
        text_hash: hasher.finish(),
    }
}
