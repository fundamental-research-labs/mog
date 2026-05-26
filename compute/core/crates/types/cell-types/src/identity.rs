//! Identity types — stable across structural changes (insert/delete rows/cols).
//!
//! These are newtype wrappers over `u128` (UUID bytes). NOT `String` — no heap allocation,
//! `Copy`, single-instruction hash via `FxHashMap`. UUID string / u128 conversion happens
//! only at the IPC boundary via `uuid::Uuid::parse_str(s).as_u128()`.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::marker::PhantomData;

macro_rules! define_id {
    ($(#[$meta:meta])* $name:ident, $display_prefix:literal, $doc:literal) => {
        #[doc = $doc]
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(into = "String", try_from = "String")]
        #[repr(transparent)]
        pub struct $name(pub(crate) u128);

        impl $name {
            /// Create from raw u128 bytes.
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
                // Fast path: 32-char lowercase hex (the format we generate internally)
                if s.len() == 32 {
                    if let Some(val) = Self::parse_hex32(s.as_bytes()) {
                        return Ok(Self(val));
                    }
                }
                let id = uuid::Uuid::parse_str(s)?;
                Ok(Self(id.as_u128()))
            }

            /// Fast hex parser for exactly 32 hex chars (no dashes).
            #[inline]
            fn parse_hex32(bytes: &[u8]) -> Option<u128> {
                if bytes.len() != 32 {
                    return None;
                }
                let mut result: u128 = 0;
                for &b in bytes {
                    let digit = match b {
                        b'0'..=b'9' => b - b'0',
                        b'a'..=b'f' => b - b'a' + 10,
                        b'A'..=b'F' => b - b'A' + 10,
                        _ => return None,
                    };
                    result = (result << 4) | u128::from(digit);
                }
                Some(result)
            }

            /// Convert to hex string without dashes (IPC boundary only).
            /// Produces `"ba5e8e043e5541c4be55192e1bf10470"` — the format TS uses internally.
            #[must_use]
            pub fn to_uuid_string(&self) -> String {
                // Fast inline hex: avoid uuid::Uuid round-trip + Display formatting.
                const HEX: &[u8; 16] = b"0123456789abcdef";
                let bytes = self.0.to_be_bytes();
                let mut buf = [0u8; 32];
                for (i, &b) in bytes.iter().enumerate() {
                    buf[i * 2] = HEX[(b >> 4) as usize];
                    buf[i * 2 + 1] = HEX[(b & 0xf) as usize];
                }
                String::from_utf8(buf.to_vec()).expect("hex is valid UTF-8")
            }

            /// Get the raw u128 value.
            #[inline]
            pub const fn as_u128(&self) -> u128 {
                self.0
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{prefix}({id})", prefix = $display_prefix, id = uuid::Uuid::from_u128(self.0))
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                let id = uuid::Uuid::from_u128(self.0);
                write!(f, "{id}")
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Self::from_uuid_str(s)
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> String {
                id.to_uuid_string()
            }
        }

        impl TryFrom<String> for $name {
            type Error = uuid::Error;
            fn try_from(s: String) -> Result<Self, Self::Error> {
                Self::from_uuid_str(&s)
            }
        }
    };
}

define_id!(
    #[doc(alias = "UUID")]
    CellId,
    "CellId",
    "Stable identity for a cell — survives insert/delete operations. u128 newtype over UUID bytes."
);
define_id!(
    SheetId,
    "SheetId",
    "Stable identity for a sheet. u128 newtype over UUID bytes."
);
define_id!(
    RowId,
    "RowId",
    "Stable identity for a row. u128 newtype over UUID bytes."
);
define_id!(
    ColId,
    "ColId",
    "Stable identity for a column. u128 newtype over UUID bytes."
);
define_id!(
    NameId,
    "NameId",
    "Stable identity for a defined name (named range). u128 newtype over UUID bytes. \
Reserved for unified-reference PR 2; only the type exists in PR 1 so the `WorkbookLookup` \
trait signatures compile. No allocator method yet."
);
define_id!(
    TableId,
    "TableId",
    "Stable identity for a table. u128 newtype over UUID bytes. Reserved for table dependency work; \
only the type exists in PR 1 so the `WorkbookLookup` trait signatures compile. \
No allocator method yet."
);

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

/// Compact run of generated row or column identities.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisIdentityRun {
    /// Immutable identity domain.
    pub run_id: AxisRunId,
    /// Persisted derivation seed for this domain.
    pub seed: AxisIdentitySeed,
    /// First stable domain offset represented by this segment.
    pub start_offset: u32,
    /// Number of identities represented by this segment.
    pub len: u32,
}

impl AxisIdentityRun {
    /// Create a compact axis identity run.
    #[must_use]
    #[inline]
    pub const fn new(
        run_id: AxisRunId,
        seed: AxisIdentitySeed,
        start_offset: u32,
        len: u32,
    ) -> Self {
        Self {
            run_id,
            seed,
            start_offset,
            len,
        }
    }

    /// Return true when the run has no identities.
    #[must_use]
    #[inline]
    pub const fn is_empty(self) -> bool {
        self.len == 0
    }

    /// Exclusive end offset for this run segment.
    ///
    /// # Panics
    ///
    /// Panics if `start_offset + len` overflows `u32`.
    #[must_use]
    #[inline]
    pub fn end_offset(self) -> u32 {
        self.start_offset
            .checked_add(self.len)
            .expect("axis identity run end offset overflow")
    }

    /// Return true when `offset` belongs to this run segment.
    #[must_use]
    #[inline]
    pub fn contains_offset(self, offset: u32) -> bool {
        self.start_offset <= offset && offset < self.end_offset()
    }
}

/// Current physical segment for a compact axis run.
///
/// `run.start_offset` remains the stable identity-domain offset. `position_start`
/// is the current sheet position where that segment begins.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisIdentitySegment {
    /// Compact run domain represented by this segment.
    pub run: AxisIdentityRun,
    /// Current physical start position of the segment.
    pub position_start: u32,
}

impl AxisIdentitySegment {
    /// Create a segment for a compact run at a current physical start position.
    #[must_use]
    #[inline]
    pub const fn new(run: AxisIdentityRun, position_start: u32) -> Self {
        Self {
            run,
            position_start,
        }
    }

    /// Exclusive physical end position for this segment.
    ///
    /// # Panics
    ///
    /// Panics if `position_start + len` overflows `u32`.
    #[must_use]
    #[inline]
    pub fn position_end(self) -> u32 {
        self.position_start
            .checked_add(self.run.len)
            .expect("axis identity segment position overflow")
    }

    /// Return true when `position` belongs to this current segment.
    #[must_use]
    #[inline]
    pub fn contains_position(self, position: u32) -> bool {
        self.position_start <= position && position < self.position_end()
    }
}

/// Lightweight reference to a compact run span.
///
/// Range snapshot contracts use this shape when payload order refers to a
/// sheet-level axis run without expanding every row or column identity.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisIdentityRunRef {
    /// Referenced immutable run domain.
    pub run_id: AxisRunId,
    /// First stable offset within the run domain.
    pub start_offset: u32,
    /// Number of identities referenced from the run.
    pub len: u32,
}

impl AxisIdentityRunRef {
    /// Create a run-span reference.
    #[must_use]
    #[inline]
    pub const fn new(run_id: AxisRunId, start_offset: u32, len: u32) -> Self {
        Self {
            run_id,
            start_offset,
            len,
        }
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

#[inline]
fn encode_compact_axis_identity(
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

#[inline]
fn decode_compact_axis_identity(raw: u128) -> Option<CompactAxisIdentity> {
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

/// Compact or explicit row/column identity storage.
///
/// Compact run lookups avoid per-row/per-column maps. Position lookup performs
/// a binary search over current segments; reverse lookup decodes generated IDs
/// in O(1) and then binary-searches compact run spans.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum AxisIdentityStore<Id> {
    /// Legacy dense explicit identities.
    Explicit(Vec<Id>),
    /// Compact generated identity segments.
    Runs(CompactAxisIdentityStore),
}

/// Compact generated identity store for one sheet axis.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct CompactAxisIdentityStore {
    segments: Vec<AxisIdentitySegment>,
    reverse_index: Vec<AxisIdentitySegment>,
}

impl CompactAxisIdentityStore {
    /// Build a compact store from already-positioned segments.
    ///
    /// Segments are sorted by current physical position and indexed by
    /// `(run_id, start_offset)` for generated-ID reverse lookup.
    #[must_use]
    pub fn new(mut segments: Vec<AxisIdentitySegment>) -> Self {
        segments.sort_by_key(|segment| segment.position_start);
        let reverse_index = compact_reverse_index(&segments);
        Self {
            segments,
            reverse_index,
        }
    }

    /// Borrow the current compact segments.
    #[must_use]
    pub fn segments(&self) -> &[AxisIdentitySegment] {
        &self.segments
    }

    fn rebuild_reverse_index(&mut self) {
        self.reverse_index = compact_reverse_index(&self.segments);
    }
}

impl<Id> AxisIdentityStore<Id>
where
    Id: AxisIdentityId,
{
    /// Build a compact store from runs in current physical order.
    ///
    /// # Panics
    ///
    /// Panics if total run length overflows `u32`.
    #[must_use]
    pub fn from_runs(runs: impl IntoIterator<Item = AxisIdentityRun>) -> Self {
        let mut position_start = 0_u32;
        let segments = runs
            .into_iter()
            .filter(|run| !run.is_empty())
            .map(|run| {
                let segment = AxisIdentitySegment::new(run, position_start);
                position_start = position_start
                    .checked_add(run.len)
                    .expect("axis identity store length overflow");
                segment
            })
            .collect();
        Self::Runs(CompactAxisIdentityStore::new(segments))
    }

    /// Number of identities in this axis store.
    ///
    /// # Panics
    ///
    /// Panics if an explicit store contains more than `u32::MAX` identities.
    #[must_use]
    pub fn len(&self) -> u32 {
        match self {
            Self::Explicit(ids) => u32::try_from(ids.len()).expect("axis identity length overflow"),
            Self::Runs(compact) => compact
                .segments
                .last()
                .map_or(0, |segment| segment.position_end()),
        }
    }

    /// Return true when the store has no identities.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Resolve current position to an identity.
    ///
    /// # Panics
    ///
    /// Panics if a compact segment's current local position would overflow its
    /// stable run offset.
    #[must_use]
    pub fn identity_at(&self, sheet_id: SheetId, position: u32) -> Option<Id> {
        match self {
            Self::Explicit(ids) => ids.get(position as usize).copied(),
            Self::Runs(compact) => {
                let segment = segment_at_position(&compact.segments, position)?;
                let offset = segment
                    .run
                    .start_offset
                    .checked_add(position - segment.position_start)
                    .expect("axis identity offset overflow");
                Some(Id::from_compact_raw(encode_compact_axis_identity(
                    Id::AXIS_KIND,
                    sheet_id,
                    segment.run.run_id,
                    segment.run.seed,
                    offset,
                )))
            }
        }
    }

    /// Resolve a generated compact identity to its current position in `sheet_id`.
    ///
    /// Explicit stores preserve legacy behavior and scan their small dense
    /// vector. Compact stores decode generated identities directly, then use a
    /// compact per-run segment index without per-row/per-column maps. The
    /// encoded sheet/seed fingerprint is validated against the referenced run
    /// segment so IDs from another sheet cannot resolve in this store.
    #[must_use]
    pub fn position_of(&self, sheet_id: SheetId, id: Id) -> Option<u32> {
        match self {
            Self::Explicit(ids) => ids
                .iter()
                .position(|candidate| *candidate == id)
                .and_then(|position| u32::try_from(position).ok()),
            Self::Runs(compact) => {
                let decoded = decode_compact_axis_identity(id.as_raw())?;
                if decoded.axis_kind != Id::AXIS_KIND {
                    return None;
                }
                let segment =
                    segment_for_offset(&compact.reverse_index, decoded.run_id, decoded.offset)?;
                if !decoded.matches_sheet_seed(sheet_id, segment.run.seed) {
                    return None;
                }
                Some(segment.position_start + (decoded.offset - segment.run.start_offset))
            }
        }
    }

    /// Return true when `id` belongs to this store for `sheet_id`.
    #[must_use]
    pub fn contains_identity(&self, sheet_id: SheetId, id: Id) -> bool {
        self.position_of(sheet_id, id).is_some()
    }

    /// Iterate identities in the half-open current position range
    /// `[start, start + len)`.
    #[must_use]
    pub fn identities_in(
        &self,
        sheet_id: SheetId,
        start: u32,
        len: u32,
    ) -> AxisIdentityIter<'_, Id> {
        let end = start.saturating_add(len).min(self.len());
        AxisIdentityIter {
            store: self,
            sheet_id,
            next: start.min(end),
            end,
            _marker: PhantomData,
        }
    }

    /// Split compact segments at a current position.
    ///
    /// Explicit stores are unchanged because their dense vector already has an
    /// element boundary at every position.
    pub fn split_at(&mut self, position: u32) {
        let Self::Runs(compact) = self else {
            return;
        };
        split_segments_at(&mut compact.segments, position);
        compact.rebuild_reverse_index();
    }

    /// Delete identities in the current half-open range `[start, start + len)`.
    pub fn delete_range(&mut self, start: u32, len: u32) {
        if len == 0 {
            return;
        }
        match self {
            Self::Explicit(ids) => {
                let remove_start = (start as usize).min(ids.len());
                let remove_end = start
                    .saturating_add(len)
                    .try_into()
                    .map_or(ids.len(), |end: usize| end.min(ids.len()));
                ids.drain(remove_start..remove_end);
            }
            Self::Runs(compact) => {
                let end = start.saturating_add(len);
                split_segments_at(&mut compact.segments, end);
                split_segments_at(&mut compact.segments, start);
                compact.segments.retain(|segment| {
                    !(start <= segment.position_start && segment.position_start < end)
                });
                recompute_position_starts(&mut compact.segments);
                compact.rebuild_reverse_index();
            }
        }
    }

    /// Move identities in `[start, start + len)` to `dest`.
    pub fn move_range(&mut self, start: u32, len: u32, dest: u32) {
        if len == 0 || start == dest {
            return;
        }
        match self {
            Self::Explicit(ids) => move_vec_range(ids, start, len, dest),
            Self::Runs(compact) => {
                let end = start.saturating_add(len);
                split_segments_at(&mut compact.segments, end);
                split_segments_at(&mut compact.segments, start);

                let mut moved = Vec::new();
                let mut kept = Vec::with_capacity(compact.segments.len());
                for segment in compact.segments.drain(..) {
                    if start <= segment.position_start && segment.position_start < end {
                        moved.push(segment);
                    } else {
                        kept.push(segment);
                    }
                }
                recompute_position_starts(&mut kept);
                let adjusted_dest = if dest > start {
                    dest.saturating_sub(len)
                } else {
                    dest
                };
                split_segments_at(&mut kept, adjusted_dest);
                let insert_at =
                    kept.partition_point(|segment| segment.position_start < adjusted_dest);
                kept.splice(insert_at..insert_at, moved);
                recompute_position_starts(&mut kept);
                compact.segments = kept;
                compact.rebuild_reverse_index();
            }
        }
    }
}

/// Iterator over row or column identities from an [`AxisIdentityStore`].
pub struct AxisIdentityIter<'a, Id> {
    store: &'a AxisIdentityStore<Id>,
    sheet_id: SheetId,
    next: u32,
    end: u32,
    _marker: PhantomData<Id>,
}

impl<Id> Iterator for AxisIdentityIter<'_, Id>
where
    Id: AxisIdentityId,
{
    type Item = Id;

    fn next(&mut self) -> Option<Self::Item> {
        if self.next >= self.end {
            return None;
        }
        let position = self.next;
        self.next = self.next.saturating_add(1);
        self.store.identity_at(self.sheet_id, position)
    }
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

fn segment_at_position(
    segments: &[AxisIdentitySegment],
    position: u32,
) -> Option<AxisIdentitySegment> {
    let idx = segments.partition_point(|segment| segment.position_start <= position);
    let segment = segments.get(idx.checked_sub(1)?)?;
    segment.contains_position(position).then_some(*segment)
}

fn compact_reverse_index(segments: &[AxisIdentitySegment]) -> Vec<AxisIdentitySegment> {
    let mut index = segments.to_vec();
    index.sort_by_key(|segment| (segment.run.run_id, segment.run.start_offset));
    index
}

fn segment_for_offset(
    index: &[AxisIdentitySegment],
    run_id: AxisRunId,
    offset: u32,
) -> Option<AxisIdentitySegment> {
    let idx = index.partition_point(|segment| {
        (segment.run.run_id, segment.run.start_offset) <= (run_id, offset)
    });
    let segment = *index.get(idx.checked_sub(1)?)?;
    (segment.run.run_id == run_id && segment.run.contains_offset(offset)).then_some(segment)
}

fn split_segments_at(segments: &mut Vec<AxisIdentitySegment>, position: u32) {
    let Some(idx) = segments
        .iter()
        .position(|segment| segment.position_start < position && position < segment.position_end())
    else {
        return;
    };
    let segment = segments[idx];
    let left_len = position - segment.position_start;
    let right_len = segment.run.len - left_len;

    segments[idx].run.len = left_len;
    let right_run = AxisIdentityRun::new(
        segment.run.run_id,
        segment.run.seed,
        segment.run.start_offset + left_len,
        right_len,
    );
    segments.insert(idx + 1, AxisIdentitySegment::new(right_run, position));
}

fn recompute_position_starts(segments: &mut [AxisIdentitySegment]) {
    let mut position = 0_u32;
    for segment in segments {
        segment.position_start = position;
        position = position
            .checked_add(segment.run.len)
            .expect("axis identity store length overflow");
    }
}

fn move_vec_range<Id>(ids: &mut Vec<Id>, start: u32, len: u32, dest: u32) {
    let remove_start = (start as usize).min(ids.len());
    let remove_end = start
        .saturating_add(len)
        .try_into()
        .map_or(ids.len(), |end: usize| end.min(ids.len()));
    if remove_start >= remove_end {
        return;
    }
    let moved: Vec<Id> = ids.drain(remove_start..remove_end).collect();
    let adjusted_dest = if dest > start {
        dest.saturating_sub(len)
    } else {
        dest
    };
    let insert_at = (adjusted_dest as usize).min(ids.len());
    ids.splice(insert_at..insert_at, moved);
}

// Doc-tests for identity types.
// Added as separate impl blocks because doc-tests in macro-generated code
// do not run as doc-tests. These thin wrappers carry runnable examples.

impl CellId {
    /// Create a [`CellId`] from raw u128 bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::CellId;
    ///
    /// let id = CellId::from_raw(42);
    /// assert_eq!(id.as_u128(), 42);
    /// ```
    #[doc(hidden)]
    pub fn _doctest_from_raw() {}

    /// Parse a [`CellId`] from a UUID string at the IPC boundary.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::CellId;
    ///
    /// let id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    /// assert_eq!(id.to_uuid_string(), "550e8400e29b41d4a716446655440000");
    ///
    /// assert!(CellId::from_uuid_str("not-a-uuid").is_err());
    /// ```
    #[doc(hidden)]
    pub fn _doctest_from_uuid_str() {}

    /// Convert a [`CellId`] back to a UUID string (simple format, no dashes).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::CellId;
    ///
    /// let id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    /// let s = id.to_uuid_string();
    /// assert_eq!(s, "550e8400e29b41d4a716446655440000");
    /// ```
    #[doc(hidden)]
    pub fn _doctest_to_uuid_string() {}
}

impl CellId {
    /// Derive a deterministic virtual `CellId` for a Range-resident cell.
    ///
    /// Identity is a function of structural position `(SheetId, RowId, ColId)`,
    /// not of which Range contains the cell. This ensures virtual `CellId`s
    /// survive Range compaction, deletion, and replacement.
    #[must_use]
    pub fn virtual_at(sheet_id: SheetId, row_id: RowId, col_id: ColId) -> CellId {
        use siphasher::sip128::{Hasher128, SipHasher};
        use std::hash::Hasher;
        let mut h = SipHasher::new();
        h.write(&sheet_id.0.to_le_bytes());
        h.write(&row_id.0.to_le_bytes());
        h.write(&col_id.0.to_le_bytes());
        let hash128 = h.finish128();
        let bytes = hash128.as_u128().to_le_bytes();
        let lo = u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]);
        CellId((u128::from(crate::id_alloc::VIRTUAL_CELL_SENTINEL) << 64) | u128::from(lo))
    }

    /// Returns true if this `CellId` was derived via [`virtual_at`](Self::virtual_at).
    #[must_use]
    pub fn is_virtual(&self) -> bool {
        let bytes = self.0.to_be_bytes();
        let high_bits = u64::from_be_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]);
        high_bits == crate::id_alloc::VIRTUAL_CELL_SENTINEL
    }
}

impl SheetId {
    /// Create and compare [`SheetId`] values.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetId;
    ///
    /// let s1 = SheetId::from_raw(1);
    /// let s2 = SheetId::from_raw(2);
    /// assert_ne!(s1, s2);
    /// assert_eq!(s1, SheetId::from_raw(1));
    /// ```
    #[doc(hidden)]
    pub fn _doctest_sheet_id() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uuid_roundtrip() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id = CellId::from_uuid_str(uuid_str).unwrap();
        // to_uuid_string() uses simple (no-dash) format
        assert_eq!(id.to_uuid_string(), "550e8400e29b41d4a716446655440000");
    }

    #[test]
    fn test_copy_semantics() {
        let id = CellId::from_raw(42);
        let copy = id; // Copy, not move
        assert_eq!(id, copy);
    }

    #[test]
    fn test_hash_deterministic() {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let id = CellId::from_raw(12345);
        let mut h1 = DefaultHasher::new();
        let mut h2 = DefaultHasher::new();
        id.hash(&mut h1);
        id.hash(&mut h2);
        assert_eq!(h1.finish(), h2.finish());
    }

    // === 5i: additional identity tests ===

    #[test]
    fn cell_id_serde_roundtrip() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id = CellId::from_uuid_str(uuid_str).unwrap();
        let json = serde_json::to_string(&id).unwrap();
        // Serde uses Into<String> which calls to_uuid_string() → simple format
        assert_eq!(json, "\"550e8400e29b41d4a716446655440000\"");
        let id2: CellId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, id2);
    }

    #[test]
    fn from_uuid_str_invalid() {
        assert!(CellId::from_uuid_str("not-a-uuid").is_err());
        assert!(CellId::from_uuid_str("").is_err());
        assert!(CellId::from_uuid_str("12345").is_err());
    }

    #[test]
    fn from_raw_as_u128_roundtrip() {
        let raw: u128 = 0xDEAD_BEEF_CAFE_BABE_1234_5678_9ABC_DEF0;
        let id = CellId::from_raw(raw);
        assert_eq!(id.as_u128(), raw);
    }

    #[test]
    fn sheet_id_basic() {
        let s1 = SheetId::from_raw(1);
        let s2 = SheetId::from_raw(2);
        assert_ne!(s1, s2);
        assert_eq!(s1, SheetId::from_raw(1));
    }

    #[test]
    fn row_id_basic() {
        let r = RowId::from_raw(100);
        assert_eq!(r.as_u128(), 100);
    }

    #[test]
    fn col_id_basic() {
        let c = ColId::from_raw(200);
        assert_eq!(c.as_u128(), 200);
    }

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
    fn compact_axis_store_resolves_position_and_identity() {
        let sheet = SheetId::from_raw(20);
        let run = AxisIdentityRun::new(
            AxisRunId::from_raw(33),
            AxisIdentitySeed::from_raw(44),
            100,
            10,
        );
        let store = AxisIdentityStore::<RowId>::from_runs([run]);

        let row = store.identity_at(sheet, 3).unwrap();
        let decoded = row.compact_axis_identity().unwrap();
        assert_eq!(decoded.offset, 103);
        assert_eq!(store.position_of(sheet, row), Some(3));
        assert!(store.contains_identity(sheet, row));
        assert_eq!(store.position_of(SheetId::from_raw(999), row), None);
    }

    #[test]
    fn compact_axis_store_split_delete_and_move_preserve_ids() {
        let sheet = SheetId::from_raw(21);
        let run = AxisIdentityRun::new(
            AxisRunId::from_raw(55),
            AxisIdentitySeed::from_raw(66),
            0,
            8,
        );
        let mut store = AxisIdentityStore::<RowId>::from_runs([run]);
        let row_2 = store.identity_at(sheet, 2).unwrap();
        let row_5 = store.identity_at(sheet, 5).unwrap();

        store.split_at(4);
        assert_eq!(store.position_of(sheet, row_2), Some(2));
        assert_eq!(store.position_of(sheet, row_5), Some(5));

        store.move_range(1, 3, 7);
        assert_eq!(store.position_of(sheet, row_5), Some(2));
        assert_eq!(store.position_of(sheet, row_2), Some(5));

        store.delete_range(4, 2);
        assert_eq!(store.position_of(sheet, row_2), None);
        assert_eq!(store.position_of(sheet, row_5), Some(2));
    }

    #[test]
    fn compact_axis_store_iterates_slice() {
        let sheet = SheetId::from_raw(22);
        let run = AxisIdentityRun::new(
            AxisRunId::from_raw(77),
            AxisIdentitySeed::from_raw(88),
            10,
            5,
        );
        let store = AxisIdentityStore::<ColId>::from_runs([run]);
        let offsets: Vec<u32> = store
            .identities_in(sheet, 1, 3)
            .map(|id| id.compact_axis_identity().unwrap().offset)
            .collect();

        assert_eq!(offsets, vec![11, 12, 13]);
    }

    #[test]
    fn display_format() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id = CellId::from_uuid_str(uuid_str).unwrap();
        assert_eq!(format!("{id}"), uuid_str);
    }

    #[test]
    fn debug_format() {
        let id = CellId::from_raw(0);
        let dbg = format!("{id:?}");
        assert!(dbg.starts_with("CellId("));
    }

    #[test]
    fn sheet_id_serde_roundtrip() {
        let uuid_str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let id = SheetId::from_uuid_str(uuid_str).unwrap();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"a1b2c3d4e5f67890abcdef1234567890\"");
        let id2: SheetId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, id2);
    }

    #[test]
    fn deserialize_from_uuid_string() {
        // Deserialization accepts both hyphenated and simple formats
        let json = "\"550e8400-e29b-41d4-a716-446655440000\"";
        let id: CellId = serde_json::from_str(json).unwrap();
        assert_eq!(id.to_uuid_string(), "550e8400e29b41d4a716446655440000");
    }

    #[test]
    fn deserialize_invalid_uuid_string_fails() {
        let json = "\"not-a-uuid\"";
        let result: Result<CellId, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn all_id_types_serde_as_uuid_string() {
        let uuid_str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let simple = "a1b2c3d4e5f67890abcdef1234567890";

        let rid = RowId::from_uuid_str(uuid_str).unwrap();
        let json = serde_json::to_string(&rid).unwrap();
        assert_eq!(json, format!("\"{simple}\""));
        let rid2: RowId = serde_json::from_str(&json).unwrap();
        assert_eq!(rid, rid2);

        let cid = ColId::from_uuid_str(uuid_str).unwrap();
        let json = serde_json::to_string(&cid).unwrap();
        assert_eq!(json, format!("\"{simple}\""));
        let cid2: ColId = serde_json::from_str(&json).unwrap();
        assert_eq!(cid, cid2);
    }

    #[test]
    fn uuid_str_roundtrip_all_types() {
        let uuid_str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let simple = "a1b2c3d4e5f67890abcdef1234567890";
        let sid = SheetId::from_uuid_str(uuid_str).unwrap();
        assert_eq!(sid.to_uuid_string(), simple);

        let rid = RowId::from_uuid_str(uuid_str).unwrap();
        assert_eq!(rid.to_uuid_string(), simple);

        let cid = ColId::from_uuid_str(uuid_str).unwrap();
        assert_eq!(cid.to_uuid_string(), simple);
    }

    // --- Virtual CellId tests ---

    #[test]
    fn virtual_id_deterministic() {
        let sheet = SheetId::from_raw(1);
        let row = RowId::from_raw(42);
        let col = ColId::from_raw(7);
        let a = CellId::virtual_at(sheet, row, col);
        let b = CellId::virtual_at(sheet, row, col);
        assert_eq!(a, b);
    }

    #[test]
    fn virtual_id_disjoint() {
        let alloc = crate::IdAllocator::new();
        let sheet = SheetId::from_raw(1);
        let real_ids: Vec<CellId> = (0..1000).map(|_| alloc.next_cell_id()).collect();
        let virtual_ids: Vec<CellId> = (0..1000)
            .map(|i| CellId::virtual_at(sheet, RowId::from_raw(i), ColId::from_raw(0)))
            .collect();
        for r in &real_ids {
            for v in &virtual_ids {
                assert_ne!(r, v, "real and virtual CellId collision");
            }
        }
    }

    #[test]
    fn virtual_id_is_virtual() {
        let sheet = SheetId::from_raw(1);
        let vid = CellId::virtual_at(sheet, RowId::from_raw(0), ColId::from_raw(0));
        assert!(vid.is_virtual());
    }

    #[test]
    fn real_id_not_virtual() {
        let alloc = crate::IdAllocator::new();
        let rid = alloc.next_cell_id();
        assert!(!rid.is_virtual());
    }

    #[test]
    fn virtual_id_stable_across_threads() {
        use std::thread;
        let sheet = SheetId::from_raw(99);
        let row = RowId::from_raw(500);
        let col = ColId::from_raw(10);
        let handles: Vec<_> = (0..4)
            .map(|_| thread::spawn(move || CellId::virtual_at(sheet, row, col)))
            .collect();
        let results: Vec<CellId> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert!(results.windows(2).all(|w| w[0] == w[1]));
    }

    #[test]
    fn virtual_id_differs_across_sheets() {
        let row = RowId::from_raw(0);
        let col = ColId::from_raw(0);
        let a = CellId::virtual_at(SheetId::from_raw(1), row, col);
        let b = CellId::virtual_at(SheetId::from_raw(2), row, col);
        assert_ne!(a, b);
    }

    #[test]
    #[should_panic(expected = "virtual CellId namespace")]
    fn sentinel_client_id_rejected() {
        let _ = crate::IdAllocator::with_client_partition(crate::id_alloc::VIRTUAL_CELL_SENTINEL);
    }
}
