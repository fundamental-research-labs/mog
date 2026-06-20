use super::axis_run::{AxisIdentityRun, AxisIdentityRunRef, AxisIdentitySegment};
use super::base_ids::SheetId;
use super::compact_encoding::{
    AxisIdentityId, AxisRunId, decode_compact_axis_identity, encode_compact_axis_identity,
};
use crate::range_id::AxisIdentityRef;
use serde::{Deserialize, Serialize};
use std::marker::PhantomData;

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

    /// Materialize a compact-or-explicit range axis reference into ordered identities.
    ///
    /// Returns `None` when the reference points outside this store, such as a
    /// compact run/offset span that no longer exists on the sheet.
    #[must_use]
    pub fn identities_for_ref(
        &self,
        sheet_id: SheetId,
        axis_ref: &AxisIdentityRef<Id>,
    ) -> Option<Vec<Id>> {
        match axis_ref {
            AxisIdentityRef::Explicit(ids) => Some(ids.clone()),
            AxisIdentityRef::StoreRun {
                run_id,
                start_offset,
                len,
            } => self.identities_for_run_ref(
                sheet_id,
                AxisIdentityRunRef::new(*run_id, *start_offset, *len),
            ),
            AxisIdentityRef::Runs(runs) => {
                let mut ids = Vec::new();
                for run_ref in runs {
                    ids.extend(self.identities_for_run_ref(sheet_id, *run_ref)?);
                }
                Some(ids)
            }
        }
    }

    fn identities_for_run_ref(
        &self,
        sheet_id: SheetId,
        run_ref: AxisIdentityRunRef,
    ) -> Option<Vec<Id>> {
        let mut ids = Vec::with_capacity(run_ref.len as usize);
        let end_offset = run_ref.start_offset.checked_add(run_ref.len)?;
        for offset in run_ref.start_offset..end_offset {
            ids.push(self.identity_for_run_offset(sheet_id, run_ref.run_id, offset)?);
        }
        Some(ids)
    }

    fn identity_for_run_offset(
        &self,
        sheet_id: SheetId,
        run_id: AxisRunId,
        offset: u32,
    ) -> Option<Id> {
        match self {
            Self::Explicit(ids) => ids.iter().copied().find(|id| {
                decode_compact_axis_identity(id.as_raw()).is_some_and(|decoded| {
                    decoded.axis_kind == Id::AXIS_KIND
                        && decoded.run_id == run_id
                        && decoded.offset == offset
                })
            }),
            Self::Runs(compact) => {
                let segment = segment_for_offset(&compact.reverse_index, run_id, offset)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AxisIdentitySeed, ColId, RowId, SheetId};

    fn run(run_id: u64, seed: u64, start_offset: u32, len: u32) -> AxisIdentityRun {
        AxisIdentityRun::new(
            AxisRunId::from_raw(run_id),
            AxisIdentitySeed::from_raw(seed),
            start_offset,
            len,
        )
    }

    #[test]
    fn compact_axis_store_resolves_position_and_identity() {
        let sheet = SheetId::from_raw(20);
        let run = run(33, 44, 100, 10);
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
        let mut store = AxisIdentityStore::<RowId>::from_runs([run(55, 66, 0, 8)]);
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
        let store = AxisIdentityStore::<ColId>::from_runs([run(77, 88, 10, 5)]);
        let offsets: Vec<u32> = store
            .identities_in(sheet, 1, 3)
            .map(|id| id.compact_axis_identity().unwrap().offset)
            .collect();

        assert_eq!(offsets, vec![11, 12, 13]);
    }

    #[test]
    fn from_runs_drops_empty_runs_and_positions_non_empty_runs() {
        let store = AxisIdentityStore::<RowId>::from_runs([
            run(1, 10, 0, 0),
            run(2, 20, 5, 2),
            run(3, 30, 9, 3),
        ]);
        let AxisIdentityStore::Runs(compact) = store else {
            panic!("expected compact store");
        };

        assert_eq!(compact.segments().len(), 2);
        assert_eq!(compact.segments()[0].position_start, 0);
        assert_eq!(compact.segments()[1].position_start, 2);
        assert_eq!(compact.segments()[1].run.run_id, AxisRunId::from_raw(3));
    }

    #[test]
    fn explicit_delete_range_clamps_inputs() {
        let mut store = AxisIdentityStore::<RowId>::Explicit(vec![
            RowId::from_raw(1),
            RowId::from_raw(2),
            RowId::from_raw(3),
        ]);

        store.delete_range(10, 2);
        assert_eq!(store.len(), 3);
        store.delete_range(1, u32::MAX);
        assert_eq!(store.len(), 1);
        assert_eq!(
            store.identity_at(SheetId::from_raw(1), 0),
            Some(RowId::from_raw(1))
        );
    }

    #[test]
    fn explicit_move_range_clamps_inputs() {
        let mut store = AxisIdentityStore::<RowId>::Explicit(vec![
            RowId::from_raw(1),
            RowId::from_raw(2),
            RowId::from_raw(3),
        ]);

        store.move_range(10, 2, 0);
        assert_eq!(
            store.identity_at(SheetId::from_raw(1), 0),
            Some(RowId::from_raw(1))
        );
        store.move_range(0, 2, u32::MAX);
        let ids: Vec<_> = store
            .identities_in(SheetId::from_raw(1), 0, 3)
            .map(|id| id.as_u128())
            .collect();
        assert_eq!(ids, vec![3, 1, 2]);
    }

    #[test]
    fn identities_in_saturates_and_clamps() {
        let sheet = SheetId::from_raw(30);
        let store = AxisIdentityStore::<RowId>::from_runs([run(1, 2, 0, 3)]);

        let ids: Vec<_> = store.identities_in(sheet, u32::MAX - 1, 10).collect();
        assert!(ids.is_empty());

        let ids: Vec<_> = store.identities_in(sheet, 1, u32::MAX).collect();
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn compact_position_rejects_wrong_seed() {
        let sheet = SheetId::from_raw(31);
        let store = AxisIdentityStore::<RowId>::from_runs([run(1, 2, 0, 3)]);
        let wrong_seed_row = RowId::derive_compact(
            sheet,
            AxisRunId::from_raw(1),
            AxisIdentitySeed::from_raw(999),
            1,
        );

        assert_eq!(store.position_of(sheet, wrong_seed_row), None);
    }
}
