//! Versioned cache entry wrapper.
//!
//! Pairs a cached value with the [`RangeVersion`] snapshot taken at creation
//! time. The entry is considered valid as long as all tracked column versions
//! still match, enabling O(1) staleness checks without rehashing cell data.

use super::range_version::RangeVersion;
use crate::eval::context::traits::DataSource;

/// A cached value paired with the column versions at the time of creation.
/// The entry is valid as long as all tracked column versions match.
#[derive(Debug, Clone)]
pub struct VersionedEntry<V> {
    pub value: V,
    pub range_version: RangeVersion,
}

impl<V> VersionedEntry<V> {
    pub fn new(value: V, range_version: RangeVersion) -> Self {
        Self {
            value,
            range_version,
        }
    }

    /// Returns `true` if all tracked columns are still at the same versions.
    pub fn is_valid(&self, source: &dyn DataSource) -> bool {
        self.range_version.is_valid(source)
    }
}
