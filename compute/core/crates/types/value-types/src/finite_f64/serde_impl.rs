use super::FiniteF64;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

// ---------------------------------------------------------------------------
// Serde
// ---------------------------------------------------------------------------
// Always serialize/deserialize only the `val` field (f64).
// The `lo` term is engine-internal and not persisted across IPC boundaries.

impl Serialize for FiniteF64 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.val.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for FiniteF64 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let n = f64::deserialize(deserializer)?;
        Self::new(n)
            .ok_or_else(|| serde::de::Error::custom("expected finite f64, got NaN or Infinity"))
    }
}
