use super::FiniteF64;
use std::cmp::Ordering;
use std::hash::{Hash, Hasher};

// ---------------------------------------------------------------------------
// Comparison & Hashing
// ---------------------------------------------------------------------------
// NOTE: Eq/Ord/Hash intentionally compare only `val`, not `lo`.
// The `lo` term is engine-internal precision metadata, not part of the
// cell's logical identity.

impl PartialEq for FiniteF64 {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.val == other.val
    }
}

/// `Eq` is sound because NaN is excluded by construction.
impl Eq for FiniteF64 {}

impl PartialOrd for FiniteF64 {
    #[inline]
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for FiniteF64 {
    #[inline]
    fn cmp(&self, other: &Self) -> Ordering {
        self.val.total_cmp(&other.val)
    }
}

impl Hash for FiniteF64 {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.val.to_bits().hash(state);
    }
}
