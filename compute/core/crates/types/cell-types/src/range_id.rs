//! Range identity and metadata types for first-class range support.
//!
//! [`RangeId`] is a stable u128 identity for a range, following the same
//! pattern as [`CellId`](crate::CellId) and friends. Supporting enums
//! ([`RangeKind`], [`PayloadEncoding`]) and the [`RangeAnchor`] enum
//! describe range metadata without coupling to the storage layer.

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::identity::{AxisIdentityRunRef, AxisRunId, ColId, RowId};

// ---------------------------------------------------------------------------
// RangeId
// ---------------------------------------------------------------------------

/// Stable identity for a range. u128 newtype over UUID bytes.
///
/// Serialises as a 32-char lowercase hex string (simple UUID format, no
/// dashes) — the same wire format used by [`CellId`](crate::CellId).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(into = "String", try_from = "String")]
#[repr(transparent)]
pub struct RangeId(pub(crate) u128);

impl RangeId {
    /// Create from raw u128 bytes.
    #[must_use]
    #[inline]
    pub const fn from_raw(raw: u128) -> Self {
        Self(raw)
    }

    /// Parse from UUID string (IPC boundary only).
    ///
    /// # Errors
    ///
    /// Returns `uuid::Error` if the string is not a valid UUID.
    pub fn from_uuid_str(s: &str) -> Result<Self, uuid::Error> {
        let id = uuid::Uuid::parse_str(s)?;
        Ok(Self(id.as_u128()))
    }

    /// Convert to hex string without dashes (IPC boundary only).
    #[must_use]
    pub fn to_uuid_string(&self) -> String {
        uuid::Uuid::from_u128(self.0).simple().to_string()
    }

    /// Get the raw u128 value.
    #[must_use]
    #[inline]
    pub const fn as_u128(&self) -> u128 {
        self.0
    }
}

impl fmt::Debug for RangeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "RangeId({id})", id = uuid::Uuid::from_u128(self.0))
    }
}

impl fmt::Display for RangeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let id = uuid::Uuid::from_u128(self.0);
        write!(f, "{id}")
    }
}

impl std::str::FromStr for RangeId {
    type Err = uuid::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_uuid_str(s)
    }
}

impl From<RangeId> for String {
    fn from(id: RangeId) -> String {
        id.to_uuid_string()
    }
}

impl TryFrom<String> for RangeId {
    type Error = uuid::Error;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Self::from_uuid_str(&s)
    }
}

/// Allow `RangeId::from(42u128)` in test code only.
/// Production minting goes through [`IdAllocator`](crate::IdAllocator).
#[cfg(test)]
impl From<u128> for RangeId {
    fn from(raw: u128) -> Self {
        Self(raw)
    }
}

// ---------------------------------------------------------------------------
// RangeKind
// ---------------------------------------------------------------------------

/// Discriminant for the semantic role of a range.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub enum RangeKind {
    /// Plain data (cell values).
    Data,
    /// Format-only range (styles, fonts, borders).
    Format,
    /// Named range (a user-defined name bound to a region).
    NamedRange,
    /// Conditional-format range.
    CondFormat,
    /// Data-validation range.
    Validation,
    /// Sheet/range protection.
    Protection,
    /// Print area.
    PrintArea,
    /// Structured table (`ListObject` / Excel Table).
    Table,
}

// ---------------------------------------------------------------------------
// RangeAnchor
// ---------------------------------------------------------------------------

/// Anchor describing which rows/cols a range covers.
///
/// `Elastic` ranges grow with row/col inserts that fall within their bounds.
/// `Strict` ranges are pinned to an explicit set of row/col identities.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub enum RangeAnchor {
    /// Index-bounded anchor: the range spans the row/col identity interval
    /// `[start_row, end_row] x [start_col, end_col]` and grows with inserts.
    #[serde(rename_all = "camelCase")]
    Elastic {
        /// First row identity (inclusive).
        start_row: RowId,
        /// Last row identity (inclusive).
        end_row: RowId,
        /// First column identity (inclusive).
        start_col: ColId,
        /// Last column identity (inclusive).
        end_col: ColId,
    },
    /// Explicit membership: the range covers exactly the listed row/col ids.
    #[serde(rename_all = "camelCase")]
    Strict {
        /// Ordered row identities.
        row_ids: Vec<RowId>,
        /// Ordered column identities.
        col_ids: Vec<ColId>,
    },
}

// ---------------------------------------------------------------------------
// AxisIdentityRef
// ---------------------------------------------------------------------------

/// Compact-or-explicit reference to row or column identities used by range payloads.
///
/// `StoreRun` and `Runs` point at sheet-level compact axis runs. `Explicit`
/// preserves the existing dense identity contract for small, migrated, or
/// fragmented ranges.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub enum AxisIdentityRef<Id> {
    /// One contiguous span from a sheet-level axis run.
    #[serde(rename_all = "camelCase")]
    StoreRun {
        /// Referenced immutable run domain.
        run_id: AxisRunId,
        /// First stable offset within the run domain.
        start_offset: u32,
        /// Number of identities referenced from the run.
        len: u32,
    },
    /// Multiple compact run spans in payload order.
    Runs(Vec<AxisIdentityRunRef>),
    /// Explicit identity list for legacy or fragmented ranges.
    Explicit(Vec<Id>),
}

impl<Id> AxisIdentityRef<Id> {
    /// Return the number of identities represented by this reference.
    ///
    /// # Panics
    ///
    /// Panics if the represented identity count overflows `u32`.
    #[must_use]
    pub fn len(&self) -> u32 {
        match self {
            Self::StoreRun { len, .. } => *len,
            Self::Runs(runs) => runs
                .iter()
                .map(|run| run.len)
                .try_fold(0_u32, u32::checked_add)
                .expect("axis identity ref length overflow"),
            Self::Explicit(ids) => {
                u32::try_from(ids.len()).expect("axis identity ref length overflow")
            }
        }
    }

    /// Return true when this reference contains no identities.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

// ---------------------------------------------------------------------------
// PayloadEncoding
// ---------------------------------------------------------------------------

/// Encoding scheme for bulk payload data attached to a range.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub enum PayloadEncoding {
    /// No payload — used by non-data Range kinds (Format, `CondFormat`, Validation, `PrintArea`).
    None,
    /// Little-endian f64 array.
    F64Le,
    /// Little-endian i64 array.
    I64Le,
    /// Mixed-type column encoded as CBOR.
    MixedCbor,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_raw_roundtrip() {
        let raw: u128 = 0xDEAD_BEEF_CAFE_BABE_1234_5678_9ABC_DEF0;
        let id = RangeId::from_raw(raw);
        assert_eq!(id.as_u128(), raw);
    }

    #[test]
    fn from_u128_test_only() {
        let id = RangeId::from(42u128);
        assert_eq!(id.as_u128(), 42);
    }

    #[test]
    fn copy_semantics() {
        let id = RangeId::from_raw(99);
        let copy = id;
        assert_eq!(id, copy);
    }

    #[test]
    fn display_format_uuid_with_dashes() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id = RangeId::from_uuid_str(uuid_str).unwrap();
        assert_eq!(format!("{id}"), uuid_str);
    }

    #[test]
    fn debug_format_has_prefix() {
        let id = RangeId::from_raw(0);
        let dbg = format!("{id:?}");
        assert!(dbg.starts_with("RangeId("));
    }

    #[test]
    fn from_str_roundtrip() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id: RangeId = uuid_str.parse().unwrap();
        assert_eq!(format!("{id}"), uuid_str);
    }

    #[test]
    fn from_str_simple_format() {
        let simple = "550e8400e29b41d4a716446655440000";
        let id: RangeId = simple.parse().unwrap();
        assert_eq!(id.to_uuid_string(), simple);
    }

    #[test]
    fn from_str_invalid() {
        assert!("not-a-uuid".parse::<RangeId>().is_err());
        assert!("".parse::<RangeId>().is_err());
        assert!("12345".parse::<RangeId>().is_err());
    }

    #[test]
    fn serde_roundtrip() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id = RangeId::from_uuid_str(uuid_str).unwrap();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"550e8400e29b41d4a716446655440000\"");
        let id2: RangeId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, id2);
    }

    #[test]
    fn deserialize_from_hyphenated_uuid() {
        let json = "\"550e8400-e29b-41d4-a716-446655440000\"";
        let id: RangeId = serde_json::from_str(json).unwrap();
        assert_eq!(id.to_uuid_string(), "550e8400e29b41d4a716446655440000");
    }

    #[test]
    fn deserialize_invalid_fails() {
        let json = "\"not-a-uuid\"";
        let result: Result<RangeId, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn range_kind_all_variants() {
        let kinds = [
            RangeKind::Data,
            RangeKind::Format,
            RangeKind::NamedRange,
            RangeKind::CondFormat,
            RangeKind::Validation,
            RangeKind::Protection,
            RangeKind::PrintArea,
            RangeKind::Table,
        ];
        for (i, a) in kinds.iter().enumerate() {
            for (j, b) in kinds.iter().enumerate() {
                if i == j {
                    assert_eq!(a, b);
                } else {
                    assert_ne!(a, b);
                }
            }
        }
    }

    #[test]
    fn range_kind_serde_roundtrip() {
        let kind = RangeKind::CondFormat;
        let json = serde_json::to_string(&kind).unwrap();
        let kind2: RangeKind = serde_json::from_str(&json).unwrap();
        assert_eq!(kind, kind2);
    }

    #[test]
    fn range_anchor_elastic_equality() {
        let a = RangeAnchor::Elastic {
            start_row: RowId::from_raw(1),
            end_row: RowId::from_raw(10),
            start_col: ColId::from_raw(2),
            end_col: ColId::from_raw(5),
        };
        let b = RangeAnchor::Elastic {
            start_row: RowId::from_raw(1),
            end_row: RowId::from_raw(10),
            start_col: ColId::from_raw(2),
            end_col: ColId::from_raw(5),
        };
        assert_eq!(a, b);
    }

    #[test]
    fn range_anchor_strict_equality() {
        let a = RangeAnchor::Strict {
            row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
            col_ids: vec![ColId::from_raw(3)],
        };
        let b = RangeAnchor::Strict {
            row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
            col_ids: vec![ColId::from_raw(3)],
        };
        assert_eq!(a, b);
    }

    #[test]
    fn range_anchor_elastic_serde_roundtrip() {
        let anchor = RangeAnchor::Elastic {
            start_row: RowId::from_raw(100),
            end_row: RowId::from_raw(200),
            start_col: ColId::from_raw(10),
            end_col: ColId::from_raw(20),
        };
        let json = serde_json::to_string(&anchor).unwrap();
        let anchor2: RangeAnchor = serde_json::from_str(&json).unwrap();
        assert_eq!(anchor, anchor2);
    }

    #[test]
    fn range_anchor_strict_serde_roundtrip() {
        let anchor = RangeAnchor::Strict {
            row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
            col_ids: vec![ColId::from_raw(3), ColId::from_raw(4)],
        };
        let json = serde_json::to_string(&anchor).unwrap();
        let anchor2: RangeAnchor = serde_json::from_str(&json).unwrap();
        assert_eq!(anchor, anchor2);
    }

    #[test]
    fn range_anchor_variants_not_equal() {
        let elastic = RangeAnchor::Elastic {
            start_row: RowId::from_raw(1),
            end_row: RowId::from_raw(2),
            start_col: ColId::from_raw(1),
            end_col: ColId::from_raw(2),
        };
        let strict = RangeAnchor::Strict {
            row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
            col_ids: vec![ColId::from_raw(1), ColId::from_raw(2)],
        };
        assert_ne!(elastic, strict);
    }

    #[test]
    fn payload_encoding_variants() {
        let encodings = [
            PayloadEncoding::None,
            PayloadEncoding::F64Le,
            PayloadEncoding::I64Le,
            PayloadEncoding::MixedCbor,
        ];
        for (i, a) in encodings.iter().enumerate() {
            for (j, b) in encodings.iter().enumerate() {
                if i == j {
                    assert_eq!(a, b);
                } else {
                    assert_ne!(a, b);
                }
            }
        }
    }

    #[test]
    fn payload_encoding_serde_roundtrip() {
        for variant in [
            PayloadEncoding::None,
            PayloadEncoding::F64Le,
            PayloadEncoding::I64Le,
            PayloadEncoding::MixedCbor,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let v2: PayloadEncoding = serde_json::from_str(&json).unwrap();
            assert_eq!(variant, v2);
        }
    }
}
