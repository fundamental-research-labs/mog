use super::base_ids::{ColId, RowId, SheetId};
use serde::{Deserialize, Serialize};

/// Axis dimension for compact row/column identity derivation.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Serialize, Deserialize)]
pub enum AxisKind {
    /// Row axis.
    Row,
    /// Column axis.
    Col,
}

/// Immutable identity domain for a compact axis run.
///
/// A run ID identifies generated identities, not a mutable physical segment.
/// Structural edits may split or move segments, but must not reuse the same
/// `(run_id, offset)` pair for a different row or column.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Serialize, Deserialize)]
#[repr(transparent)]
pub struct AxisRunId(pub u64);

impl AxisRunId {
    /// Create an axis run ID from raw bits.
    #[must_use]
    #[inline]
    pub const fn from_raw(raw: u64) -> Self {
        Self(raw)
    }

    /// Return raw run ID bits.
    #[must_use]
    #[inline]
    pub const fn as_u64(self) -> u64 {
        self.0
    }
}

/// Stable derivation seed for a compact axis run.
///
/// The seed is persisted with the run. Generated IDs carry a compact
/// fingerprint of `(sheet_id, seed)` so decode can reject obvious wrong-sheet
/// or wrong-seed uses while still decoding run membership in O(1).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Serialize, Deserialize)]
#[repr(transparent)]
pub struct AxisIdentitySeed(pub u64);

impl AxisIdentitySeed {
    /// Create an axis identity seed from raw bits.
    #[must_use]
    #[inline]
    pub const fn from_raw(raw: u64) -> Self {
        Self(raw)
    }

    /// Return raw seed bits.
    #[must_use]
    #[inline]
    pub const fn as_u64(self) -> u64 {
        self.0
    }
}

/// Decoded compact row/column identity descriptor.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub struct CompactAxisIdentity {
    /// Axis kind encoded in the identity.
    pub axis_kind: AxisKind,
    /// Immutable run domain encoded in the identity.
    pub run_id: AxisRunId,
    /// Stable offset within the run domain.
    pub offset: u32,
    /// Compact fingerprint of `(sheet_id, seed)` for validation.
    pub seed_fingerprint: u32,
}

impl CompactAxisIdentity {
    /// Return true when this descriptor matches the expected sheet and seed.
    #[must_use]
    pub fn matches_sheet_seed(self, sheet_id: SheetId, seed: AxisIdentitySeed) -> bool {
        self.seed_fingerprint == seed_fingerprint(sheet_id, seed)
    }
}

/// Axis identity contract for row and column ID newtypes.
pub trait AxisIdentityId: Copy + Eq {
    /// Axis kind represented by this identity type.
    const AXIS_KIND: AxisKind;

    /// Build this identity type from raw compact bits.
    fn from_compact_raw(raw: u128) -> Self;

    /// Return raw identity bits.
    fn as_raw(self) -> u128;
}

impl AxisIdentityId for RowId {
    const AXIS_KIND: AxisKind = AxisKind::Row;

    #[inline]
    fn from_compact_raw(raw: u128) -> Self {
        Self(raw)
    }

    #[inline]
    fn as_raw(self) -> u128 {
        self.0
    }
}

impl AxisIdentityId for ColId {
    const AXIS_KIND: AxisKind = AxisKind::Col;

    #[inline]
    fn from_compact_raw(raw: u128) -> Self {
        Self(raw)
    }

    #[inline]
    fn as_raw(self) -> u128 {
        self.0
    }
}

const COMPACT_AXIS_TAG: u128 = 0xA7;
const COMPACT_AXIS_VERSION: u128 = 1;
const COMPACT_AXIS_TAG_SHIFT: u32 = 120;
const COMPACT_AXIS_VERSION_SHIFT: u32 = 116;
const COMPACT_AXIS_KIND_SHIFT: u32 = 115;
const COMPACT_AXIS_FINGERPRINT_SHIFT: u32 = 80;
const COMPACT_AXIS_RUN_ID_SHIFT: u32 = 32;
const COMPACT_AXIS_FINGERPRINT_BITS: u32 = 32;
const COMPACT_AXIS_RUN_ID_BITS: u32 = 48;
const COMPACT_AXIS_FINGERPRINT_MASK: u128 = (1_u128 << COMPACT_AXIS_FINGERPRINT_BITS) - 1;
const COMPACT_AXIS_RUN_ID_MASK: u128 = (1_u128 << COMPACT_AXIS_RUN_ID_BITS) - 1;
const COMPACT_AXIS_OFFSET_MASK: u128 = u32::MAX as u128;

#[inline]
fn seed_fingerprint(sheet_id: SheetId, seed: AxisIdentitySeed) -> u32 {
    use siphasher::sip128::{Hasher128, SipHasher};
    use std::hash::Hasher;

    let mut h = SipHasher::new();
    h.write(&sheet_id.0.to_le_bytes());
    h.write(&seed.0.to_le_bytes());
    let masked = h.finish128().as_u128() & COMPACT_AXIS_FINGERPRINT_MASK;
    u32::try_from(masked).expect("compact axis fingerprint fits in u32")
}

/// Encode a compact row or column identity into the shared `u128` layout.
#[inline]
pub(super) fn encode_compact_axis_identity(
    axis_kind: AxisKind,
    sheet_id: SheetId,
    run_id: AxisRunId,
    seed: AxisIdentitySeed,
    offset: u32,
) -> u128 {
    assert!(
        u128::from(run_id.0) <= COMPACT_AXIS_RUN_ID_MASK,
        "compact axis run id exceeds encodable range"
    );
    let axis_bit = match axis_kind {
        AxisKind::Row => 0_u128,
        AxisKind::Col => 1_u128,
    };
    (COMPACT_AXIS_TAG << COMPACT_AXIS_TAG_SHIFT)
        | (COMPACT_AXIS_VERSION << COMPACT_AXIS_VERSION_SHIFT)
        | (axis_bit << COMPACT_AXIS_KIND_SHIFT)
        | (u128::from(seed_fingerprint(sheet_id, seed)) << COMPACT_AXIS_FINGERPRINT_SHIFT)
        | (u128::from(run_id.0) << COMPACT_AXIS_RUN_ID_SHIFT)
        | u128::from(offset)
}

/// Decode a compact row or column identity from the shared `u128` layout.
#[inline]
pub(super) fn decode_compact_axis_identity(raw: u128) -> Option<CompactAxisIdentity> {
    let tag = raw >> COMPACT_AXIS_TAG_SHIFT;
    if tag != COMPACT_AXIS_TAG {
        return None;
    }

    let version = (raw >> COMPACT_AXIS_VERSION_SHIFT) & 0xF;
    if version != COMPACT_AXIS_VERSION {
        return None;
    }

    let axis_kind = if ((raw >> COMPACT_AXIS_KIND_SHIFT) & 1) == 0 {
        AxisKind::Row
    } else {
        AxisKind::Col
    };
    let seed_fingerprint =
        ((raw >> COMPACT_AXIS_FINGERPRINT_SHIFT) & COMPACT_AXIS_FINGERPRINT_MASK) as u32;
    let run_id = AxisRunId(
        u64::try_from((raw >> COMPACT_AXIS_RUN_ID_SHIFT) & COMPACT_AXIS_RUN_ID_MASK)
            .expect("compact axis run id fits in u64"),
    );
    let offset =
        u32::try_from(raw & COMPACT_AXIS_OFFSET_MASK).expect("compact axis offset fits in u32");

    Some(CompactAxisIdentity {
        axis_kind,
        run_id,
        offset,
        seed_fingerprint,
    })
}

impl RowId {
    /// Derive a reversible compact-run row identity.
    #[must_use]
    pub fn derive_compact(
        sheet_id: SheetId,
        run_id: AxisRunId,
        seed: AxisIdentitySeed,
        offset: u32,
    ) -> Self {
        Self(encode_compact_axis_identity(
            AxisKind::Row,
            sheet_id,
            run_id,
            seed,
            offset,
        ))
    }

    /// Decode this row identity if it was generated from a compact axis run.
    #[must_use]
    pub fn compact_axis_identity(self) -> Option<CompactAxisIdentity> {
        let decoded = decode_compact_axis_identity(self.0)?;
        (decoded.axis_kind == AxisKind::Row).then_some(decoded)
    }

    /// Return true when this row ID uses the compact generated identity layout.
    #[must_use]
    pub fn is_compact_axis_identity(self) -> bool {
        self.compact_axis_identity().is_some()
    }
}

impl ColId {
    /// Derive a reversible compact-run column identity.
    #[must_use]
    pub fn derive_compact(
        sheet_id: SheetId,
        run_id: AxisRunId,
        seed: AxisIdentitySeed,
        offset: u32,
    ) -> Self {
        Self(encode_compact_axis_identity(
            AxisKind::Col,
            sheet_id,
            run_id,
            seed,
            offset,
        ))
    }

    /// Decode this column identity if it was generated from a compact axis run.
    #[must_use]
    pub fn compact_axis_identity(self) -> Option<CompactAxisIdentity> {
        let decoded = decode_compact_axis_identity(self.0)?;
        (decoded.axis_kind == AxisKind::Col).then_some(decoded)
    }

    /// Return true when this column ID uses the compact generated identity layout.
    #[must_use]
    pub fn is_compact_axis_identity(self) -> bool {
        self.compact_axis_identity().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_row_id_decode_roundtrip() {
        let sheet = SheetId::from_raw(10);
        let run_id = AxisRunId::from_raw(0xCAFE_BABE);
        let seed = AxisIdentitySeed::from_raw(0x1234_5678);
        let row = RowId::derive_compact(sheet, run_id, seed, 42);

        let decoded = row.compact_axis_identity().unwrap();
        assert_eq!(decoded.axis_kind, AxisKind::Row);
        assert_eq!(decoded.run_id, run_id);
        assert_eq!(decoded.offset, 42);
        assert!(decoded.matches_sheet_seed(sheet, seed));
    }

    #[test]
    fn compact_col_id_decode_roundtrip() {
        let sheet = SheetId::from_raw(11);
        let run_id = AxisRunId::from_raw(0xABCD);
        let seed = AxisIdentitySeed::from_raw(0x9876);
        let col = ColId::derive_compact(sheet, run_id, seed, 7);

        let decoded = col.compact_axis_identity().unwrap();
        assert_eq!(decoded.axis_kind, AxisKind::Col);
        assert_eq!(decoded.run_id, run_id);
        assert_eq!(decoded.offset, 7);
        assert!(decoded.matches_sheet_seed(sheet, seed));
    }

    #[test]
    fn compact_axis_decode_is_axis_typed() {
        let sheet = SheetId::from_raw(12);
        let run_id = AxisRunId::from_raw(1);
        let seed = AxisIdentitySeed::from_raw(2);
        let col = ColId::derive_compact(sheet, run_id, seed, 0);

        assert!(
            RowId::from_raw(col.as_u128())
                .compact_axis_identity()
                .is_none()
        );
        assert!(RowId::from_raw(42).compact_axis_identity().is_none());
        assert!(ColId::from_raw(42).compact_axis_identity().is_none());
    }

    #[test]
    #[should_panic(expected = "compact axis run id exceeds encodable range")]
    fn compact_run_id_above_48_bits_panics() {
        let _ = RowId::derive_compact(
            SheetId::from_raw(1),
            AxisRunId::from_raw(1 << 48),
            AxisIdentitySeed::from_raw(2),
            0,
        );
    }

    #[test]
    fn compact_decode_rejects_wrong_tag_and_version() {
        let raw = RowId::derive_compact(
            SheetId::from_raw(1),
            AxisRunId::from_raw(2),
            AxisIdentitySeed::from_raw(3),
            4,
        )
        .as_u128();

        let wrong_tag = raw ^ (0xFF_u128 << COMPACT_AXIS_TAG_SHIFT);
        assert!(decode_compact_axis_identity(wrong_tag).is_none());

        let wrong_version = raw ^ (0x2_u128 << COMPACT_AXIS_VERSION_SHIFT);
        assert!(decode_compact_axis_identity(wrong_version).is_none());
    }
}
