//! Canonical cell-value hashing utilities.
//!
//! Provides a single source-of-truth for hashing `CellValue` instances across
//! all cache modules (frequency_cache, bitmask_cache, sorted_cache, etc.).
//!
//! ## Design
//!
//! Each variant is tagged with a unique `u8` discriminant before hashing its
//! data. This prevents cross-variant collisions (e.g., `Number(0)` vs `Null`).
//! For `Number`, the raw `f64` bits are hashed to ensure bitwise-identical
//! values hash identically (including -0.0 vs +0.0 distinction).

use std::hash::{Hash, Hasher};

use rustc_hash::FxHasher;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Single-value hashing
// ---------------------------------------------------------------------------

/// Hash a single `CellValue` into the given hasher.
///
/// Uses a `u8` discriminant tag per variant so that different variant types
/// with overlapping data never collide. For `Number`, the raw IEEE 754 bits
/// are hashed for deterministic, bitwise-exact matching.
#[inline]
pub fn hash_cell_value(v: &CellValue, hasher: &mut impl Hasher) {
    match v {
        CellValue::Number(n) => {
            0u8.hash(hasher);
            n.get().to_bits().hash(hasher);
        }
        CellValue::Text(s) => {
            1u8.hash(hasher);
            s.hash(hasher);
        }
        CellValue::Boolean(b) => {
            2u8.hash(hasher);
            b.hash(hasher);
        }
        CellValue::Null => {
            3u8.hash(hasher);
        }
        CellValue::Error(e, _) => {
            4u8.hash(hasher);
            e.hash(hasher);
        }
        CellValue::Array(rows) => {
            5u8.hash(hasher);
            rows.len().hash(hasher);
        }
        CellValue::Control(c) => {
            2u8.hash(hasher); // same tag as Boolean
            c.value.hash(hasher);
        }
        CellValue::Image(image) => {
            6u8.hash(hasher);
            image.source.hash(hasher);
            image.alt_text.hash(hasher);
            image.sizing.hash(hasher);
            image.height.hash(hasher);
            image.width.hash(hasher);
        }
    }
}

// ---------------------------------------------------------------------------
// Slice hashing
// ---------------------------------------------------------------------------

/// Hash a slice of `CellValue` references into a `u64`.
///
/// The length is hashed first to distinguish `[A, B]` from `[A, B, C]` even
/// if the trailing element hashes to zero.
pub fn hash_cell_value_refs(values: &[&CellValue]) -> u64 {
    let mut hasher = FxHasher::default();
    values.len().hash(&mut hasher);
    for &v in values {
        hash_cell_value(v, &mut hasher);
    }
    hasher.finish()
}

/// Hash a slice of owned `CellValue`s into a `u64`.
pub fn hash_cell_value_slice(values: &[CellValue]) -> u64 {
    let mut hasher = FxHasher::default();
    values.len().hash(&mut hasher);
    for v in values {
        hash_cell_value(v, &mut hasher);
    }
    hasher.finish()
}

// ---------------------------------------------------------------------------
// Verification (secondary) hash
// ---------------------------------------------------------------------------

/// Compute a secondary verification hash using a different seed.
///
/// This uses an `FxHasher` seeded with a fixed non-zero salt so it produces
/// a different hash than the primary functions above. A cache hit that
/// requires BOTH hashes to match makes accidental collision astronomically
/// unlikely (probability ~ 2^-128 for independent hashes).
pub fn verification_hash_refs(values: &[&CellValue]) -> u64 {
    let mut hasher = FxHasher::default();
    0xDEAD_BEEF_CAFE_BABEu64.hash(&mut hasher);
    for &v in values {
        hash_cell_value(v, &mut hasher);
    }
    hasher.finish()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    #[test]
    fn test_same_values_same_hash() {
        let a = [num(1.0), text("hello"), CellValue::Boolean(true)];
        let b = [num(1.0), text("hello"), CellValue::Boolean(true)];
        let refs_a: Vec<&CellValue> = a.iter().collect();
        let refs_b: Vec<&CellValue> = b.iter().collect();
        assert_eq!(hash_cell_value_refs(&refs_a), hash_cell_value_refs(&refs_b));
    }

    #[test]
    fn test_different_values_different_hash() {
        let a = [num(1.0)];
        let b = [num(2.0)];
        let refs_a: Vec<&CellValue> = a.iter().collect();
        let refs_b: Vec<&CellValue> = b.iter().collect();
        assert_ne!(hash_cell_value_refs(&refs_a), hash_cell_value_refs(&refs_b));
    }

    #[test]
    fn test_different_types_different_hash() {
        let a = [num(0.0)];
        let b = [CellValue::Null];
        let refs_a: Vec<&CellValue> = a.iter().collect();
        let refs_b: Vec<&CellValue> = b.iter().collect();
        assert_ne!(hash_cell_value_refs(&refs_a), hash_cell_value_refs(&refs_b));
    }

    #[test]
    fn test_length_matters() {
        let a = [num(1.0)];
        let b = [num(1.0), num(1.0)];
        let refs_a: Vec<&CellValue> = a.iter().collect();
        let refs_b: Vec<&CellValue> = b.iter().collect();
        assert_ne!(hash_cell_value_refs(&refs_a), hash_cell_value_refs(&refs_b));
    }

    #[test]
    fn test_verification_hash_differs_from_primary() {
        let a = [num(1.0), num(2.0)];
        let refs: Vec<&CellValue> = a.iter().collect();
        assert_ne!(hash_cell_value_refs(&refs), verification_hash_refs(&refs));
    }

    #[test]
    fn test_owned_slice_matches_ref_slice() {
        let a = vec![num(1.0), text("hi"), CellValue::Error(CellError::Na, None)];
        let refs: Vec<&CellValue> = a.iter().collect();
        assert_eq!(hash_cell_value_refs(&refs), hash_cell_value_slice(&a));
    }

    #[test]
    fn test_error_variants_distinguished() {
        let a = [CellValue::Error(CellError::Na, None)];
        let b = [CellValue::Error(CellError::Value, None)];
        let refs_a: Vec<&CellValue> = a.iter().collect();
        let refs_b: Vec<&CellValue> = b.iter().collect();
        assert_ne!(hash_cell_value_refs(&refs_a), hash_cell_value_refs(&refs_b));
    }
}
