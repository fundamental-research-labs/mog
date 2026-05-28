use super::compact_encoding::{AxisIdentitySeed, AxisRunId};
use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    use super::*;

    fn run(start_offset: u32, len: u32) -> AxisIdentityRun {
        AxisIdentityRun::new(
            AxisRunId::from_raw(1),
            AxisIdentitySeed::from_raw(2),
            start_offset,
            len,
        )
    }

    #[test]
    fn run_end_empty_and_contains_are_half_open() {
        let empty = run(10, 0);
        assert!(empty.is_empty());

        let run = run(10, 3);
        assert!(!run.is_empty());
        assert_eq!(run.end_offset(), 13);
        assert!(!run.contains_offset(9));
        assert!(run.contains_offset(10));
        assert!(run.contains_offset(12));
        assert!(!run.contains_offset(13));
    }

    #[test]
    fn segment_end_and_contains_are_half_open() {
        let segment = AxisIdentitySegment::new(run(100, 3), 7);

        assert_eq!(segment.position_end(), 10);
        assert!(!segment.contains_position(6));
        assert!(segment.contains_position(7));
        assert!(segment.contains_position(9));
        assert!(!segment.contains_position(10));
    }

    #[test]
    fn run_ref_constructor_preserves_fields() {
        let run_id = AxisRunId::from_raw(9);
        let run_ref = AxisIdentityRunRef::new(run_id, 10, 11);

        assert_eq!(run_ref.run_id, run_id);
        assert_eq!(run_ref.start_offset, 10);
        assert_eq!(run_ref.len, 11);
    }

    #[test]
    fn run_and_segment_serialize_camel_case() {
        let segment = AxisIdentitySegment::new(run(5, 6), 7);
        let json = serde_json::to_string(&segment).unwrap();

        assert!(json.contains("startOffset"));
        assert!(json.contains("positionStart"));
        assert!(!json.contains("start_offset"));
        assert!(!json.contains("position_start"));
    }

    #[test]
    #[should_panic(expected = "axis identity run end offset overflow")]
    fn run_end_offset_overflow_panics() {
        let _ = run(u32::MAX, 1).end_offset();
    }

    #[test]
    #[should_panic(expected = "axis identity segment position overflow")]
    fn segment_position_end_overflow_panics() {
        let _ = AxisIdentitySegment::new(run(0, 1), u32::MAX).position_end();
    }
}
