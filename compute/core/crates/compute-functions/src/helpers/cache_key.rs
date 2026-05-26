//! Content-verified cache key type.
//!
//! `ContentVerifiedKey<T>` uses `(hash, len)` for fast `HashMap` bucket
//! selection but verifies the full content on hit to prevent hash collisions
//! from returning incorrect cached results.
//!
//! ## NaN safety
//!
//! If `T` contains `f64` values (e.g., `Vec<f64>`), the standard `PartialEq`
//! will say `NaN != NaN`, which would cause cache hits to fail for entries
//! containing NaN. When such types are needed as verification data, wrap them
//! in a newtype that implements `PartialEq` via `to_bits()` comparison for
//! bitwise equality. This will be needed when `sorted_cache` migrates to use
//! `ContentVerifiedKey`.

use std::hash::{Hash, Hasher};

/// A cache key that uses `(hash, len)` for `HashMap` lookup but verifies
/// the full content on hit to prevent hash collisions.
///
/// - `hash`: precomputed hash of the content (e.g., via `hash_cell_value_refs`)
/// - `len`: length of the content (extra discrimination for cheap bucket spread)
/// - `verification`: the full content, compared via `PartialEq` on cache probe
#[derive(Debug, Clone)]
pub struct ContentVerifiedKey<T: PartialEq> {
    pub hash: u64,
    pub len: usize,
    pub verification: T,
}

impl<T: PartialEq> Hash for ContentVerifiedKey<T> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.hash.hash(state);
        self.len.hash(state);
    }
}

impl<T: PartialEq> PartialEq for ContentVerifiedKey<T> {
    fn eq(&self, other: &Self) -> bool {
        self.hash == other.hash && self.len == other.len && self.verification == other.verification
    }
}

impl<T: PartialEq> Eq for ContentVerifiedKey<T> {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_equal_keys() {
        let k1 = ContentVerifiedKey {
            hash: 42,
            len: 3,
            verification: vec![1, 2, 3],
        };
        let k2 = ContentVerifiedKey {
            hash: 42,
            len: 3,
            verification: vec![1, 2, 3],
        };
        assert_eq!(k1, k2);
    }

    #[test]
    fn test_different_verification_not_equal() {
        let k1 = ContentVerifiedKey {
            hash: 42,
            len: 3,
            verification: vec![1, 2, 3],
        };
        let k2 = ContentVerifiedKey {
            hash: 42,
            len: 3,
            verification: vec![1, 2, 4],
        };
        assert_ne!(k1, k2);
    }

    #[test]
    fn test_different_hash_not_equal() {
        let k1 = ContentVerifiedKey {
            hash: 42,
            len: 3,
            verification: vec![1, 2, 3],
        };
        let k2 = ContentVerifiedKey {
            hash: 99,
            len: 3,
            verification: vec![1, 2, 3],
        };
        assert_ne!(k1, k2);
    }

    #[test]
    fn test_usable_as_hashmap_key() {
        let mut map = HashMap::new();
        let key = ContentVerifiedKey {
            hash: 42,
            len: 2,
            verification: vec!["a", "b"],
        };
        map.insert(key.clone(), "found");

        // Same key retrieves the value
        let probe = ContentVerifiedKey {
            hash: 42,
            len: 2,
            verification: vec!["a", "b"],
        };
        assert_eq!(map.get(&probe), Some(&"found"));

        // Hash collision with different verification misses
        let collision = ContentVerifiedKey {
            hash: 42,
            len: 2,
            verification: vec!["a", "c"],
        };
        assert_eq!(map.get(&collision), None);
    }
}
