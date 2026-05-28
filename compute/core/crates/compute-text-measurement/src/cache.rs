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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_miss_returns_none() {
        let cache = MeasurementCache::new();
        assert_eq!(cache.get(0, 11.0, "anything"), None);
    }

    #[test]
    fn cache_hit_returns_stored_value() {
        let mut cache = MeasurementCache::new();
        cache.put(0, 11.0, "Hello", 42.5);
        assert_eq!(cache.get(0, 11.0, "Hello"), Some(42.5));
    }

    #[test]
    fn cache_distinguishes_font_id_and_size() {
        let mut cache = MeasurementCache::new();
        cache.put(0, 11.0, "Hello", 42.5);
        assert_eq!(cache.get(1, 11.0, "Hello"), None, "different font_id");
        assert_eq!(cache.get(0, 12.0, "Hello"), None, "different font_size");
        assert_eq!(cache.get(0, 11.0, "World"), None, "different text");
    }

    #[test]
    fn cache_eviction_at_capacity() {
        let mut cache = MeasurementCache::new();
        for i in 0..MAX_CACHE_SIZE as u16 {
            cache.put(i, 11.0, "x", i as f32);
        }
        assert_eq!(cache.get(0, 11.0, "x"), Some(0.0), "entry 0 before evict");

        cache.put(0, 99.0, "trigger", 999.0);
        assert_eq!(
            cache.get(0, 99.0, "trigger"),
            Some(999.0),
            "new entry exists"
        );
        assert_eq!(cache.get(0, 11.0, "x"), None, "old entry 0 was evicted");
    }

    #[test]
    fn cache_clear_removes_all() {
        let mut cache = MeasurementCache::new();
        cache.put(0, 11.0, "A", 1.0);
        cache.put(1, 12.0, "B", 2.0);
        cache.clear();
        assert_eq!(cache.get(0, 11.0, "A"), None);
        assert_eq!(cache.get(1, 12.0, "B"), None);
    }

    #[test]
    fn cache_default_is_empty() {
        let cache = MeasurementCache::default();
        assert_eq!(cache.get(0, 11.0, "anything"), None);
    }
}
