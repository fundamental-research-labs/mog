use cell_types::{
    AxisIdentityId, AxisIdentityRef, AxisIdentityRunRef, AxisIdentityStore, AxisKind, ColId,
    CompactAxisIdentity, RowId, SheetId,
};
use compute_document::identity::AxisIndex;
use rustc_hash::{FxHashMap, FxHashSet};

/// Stable payload offsets. Generated identities retain their run arithmetic;
/// deletions are sparse tombstones, so the payload stride never changes.
#[derive(Debug, Clone)]
pub enum RangeOffsets<Id> {
    Compact {
        runs: Vec<OffsetRun<Id>>,
        removed: FxHashSet<Id>,
        len: usize,
    },
    Explicit(FxHashMap<Id, u32>),
}

#[derive(Debug, Clone)]
pub struct OffsetRun<Id> {
    first: Id,
    len: u32,
    payload_start: u32,
}

fn decode<Id: AxisIdentityId>(id: Id) -> Option<CompactAxisIdentity> {
    match Id::AXIS_KIND {
        AxisKind::Row => RowId::from_raw(id.as_raw()).compact_axis_identity(),
        AxisKind::Col => ColId::from_raw(id.as_raw()).compact_axis_identity(),
    }
}

impl<Id: AxisIdentityId> OffsetRun<Id> {
    fn id_at(&self, local: u32) -> Id {
        // A compact run reserves its low 32 bits for the stable domain offset.
        Id::from_compact_raw(self.first.as_raw() + u128::from(local))
    }

    fn offset_of(&self, id: Id) -> Option<u32> {
        let local = id.as_raw().checked_sub(self.first.as_raw())?;
        (local < u128::from(self.len)).then(|| self.payload_start + local as u32)
    }
}

impl<Id> Default for RangeOffsets<Id> {
    fn default() -> Self {
        Self::Explicit(FxHashMap::default())
    }
}

impl<Id: AxisIdentityId + std::hash::Hash> RangeOffsets<Id> {
    /// Capture payload order from physical positions without generating an ID
    /// for every position of a compact run.
    pub fn from_positions(
        sheet: SheetId,
        axis: &AxisIdentityStore<Id>,
        positions: impl IntoIterator<Item = u32>,
    ) -> Self {
        let AxisIdentityStore::Runs(compact) = axis else {
            return positions
                .into_iter()
                .enumerate()
                .map(|(offset, pos)| {
                    (
                        axis.identity_at(sheet, pos)
                            .expect("range position within allocated axis"),
                        offset as u32,
                    )
                })
                .collect();
        };
        let mut spans: Vec<std::ops::Range<u32>> = Vec::new();
        for pos in positions {
            if let Some(span) = spans.last_mut()
                && span.end == pos
            {
                span.end += 1;
            } else {
                spans.push(pos..pos + 1);
            }
        }
        let mut runs = Vec::new();
        let mut payload_start = 0;
        for span in spans {
            for segment in compact.segments() {
                let start = span.start.max(segment.position_start);
                let end = span.end.min(segment.position_end());
                if start < end {
                    runs.push(OffsetRun {
                        first: axis
                            .identity_at(sheet, start)
                            .expect("range position within allocated axis"),
                        len: end - start,
                        payload_start,
                    });
                    payload_start += end - start;
                }
            }
        }
        runs.sort_unstable_by_key(|run| run.first.as_raw());
        Self::Compact {
            runs,
            removed: FxHashSet::default(),
            len: payload_start as usize,
        }
    }

    /// Resolve a persisted compact reference by intersecting run spans. This
    /// never expands a compact sheet into a vector of individual identities.
    pub fn from_axis_ref(
        sheet: SheetId,
        reference: &AxisIdentityRef<Id>,
        axis: &AxisIdentityStore<Id>,
    ) -> Option<Self> {
        if let AxisIdentityRef::Explicit(ids) = reference {
            return Some(
                ids.iter()
                    .enumerate()
                    .map(|(i, id)| (*id, i as u32))
                    .collect(),
            );
        }
        let AxisIdentityStore::Runs(compact) = axis else {
            return Some(
                axis.identities_for_ref(sheet, reference)?
                    .into_iter()
                    .enumerate()
                    .map(|(i, id)| (id, i as u32))
                    .collect(),
            );
        };
        let refs = match reference {
            AxisIdentityRef::StoreRun {
                run_id,
                start_offset,
                len,
            } => {
                vec![AxisIdentityRunRef::new(*run_id, *start_offset, *len)]
            }
            AxisIdentityRef::Runs(runs) => runs.clone(),
            AxisIdentityRef::Explicit(_) => unreachable!(),
        };
        let mut runs = Vec::new();
        let mut payload_start = 0_u32;
        for reference in refs {
            let end = reference.start_offset.checked_add(reference.len)?;
            let mut pieces: Vec<_> = compact
                .segments()
                .iter()
                .filter_map(|segment| {
                    if segment.run.run_id != reference.run_id {
                        return None;
                    }
                    let start = segment.run.start_offset.max(reference.start_offset);
                    let end = segment.run.end_offset().min(end);
                    (start < end).then_some((start, end, segment))
                })
                .collect();
            pieces.sort_unstable_by_key(|(start, _, _)| *start);
            let mut next = reference.start_offset;
            for (start, end, segment) in pieces {
                if start != next {
                    return None;
                }
                runs.push(OffsetRun {
                    first: axis.identity_at(
                        sheet,
                        segment.position_start + start - segment.run.start_offset,
                    )?,
                    len: end - start,
                    payload_start,
                });
                payload_start = payload_start.checked_add(end - start)?;
                next = end;
            }
            if next != end {
                return None;
            }
        }
        runs.sort_unstable_by_key(|run| run.first.as_raw());
        if runs
            .windows(2)
            .any(|pair| pair[0].first.as_raw() + u128::from(pair[0].len) > pair[1].first.as_raw())
        {
            return None;
        }
        Some(Self::Compact {
            runs,
            removed: FxHashSet::default(),
            len: payload_start as usize,
        })
    }

    pub fn len(&self) -> usize {
        match self {
            Self::Compact { len, .. } => *len,
            Self::Explicit(map) => map.len(),
        }
    }

    pub fn get(&self, id: &Id) -> Option<u32> {
        match self {
            Self::Compact { runs, removed, .. } => {
                if removed.contains(id) {
                    return None;
                }
                let index = runs
                    .partition_point(|run| run.first.as_raw() <= id.as_raw())
                    .checked_sub(1)?;
                runs[index].offset_of(*id)
            }
            Self::Explicit(map) => map.get(id).copied(),
        }
    }

    pub fn contains_key(&self, id: &Id) -> bool {
        self.get(id).is_some()
    }

    pub fn iter(&self) -> impl Iterator<Item = (Id, u32)> + '_ {
        let (compact, explicit) = match self {
            Self::Compact { runs, removed, .. } => (Some((runs, removed)), None),
            Self::Explicit(map) => (None, Some(map)),
        };
        compact
            .into_iter()
            .flat_map(|(runs, removed)| {
                runs.iter()
                    .flat_map(|run| {
                        (0..run.len).map(move |local| (run.id_at(local), run.payload_start + local))
                    })
                    .filter(move |(id, _)| !removed.contains(id))
            })
            .chain(
                explicit
                    .into_iter()
                    .flat_map(|map| map.iter().map(|(id, offset)| (*id, *offset))),
            )
    }

    pub fn keys(&self) -> impl Iterator<Item = Id> + '_ {
        self.iter().map(|(id, _)| id)
    }

    pub fn remove(&mut self, id: &Id) -> Option<u32> {
        let previous = self.get(id)?;
        match self {
            Self::Compact { removed, len, .. } => {
                removed.insert(*id);
                *len -= 1;
            }
            Self::Explicit(map) => {
                map.remove(id);
            }
        }
        Some(previous)
    }

    /// History restores an original offset without expanding a compact range.
    /// An arbitrary identity/offset remap needs an explicit lookup instead.
    pub fn insert(&mut self, id: Id, offset: u32) -> Option<u32> {
        if let Self::Compact { runs, removed, len } = self {
            if runs.iter().find_map(|run| run.offset_of(id)) == Some(offset) {
                return if removed.remove(&id) {
                    *len += 1;
                    None
                } else {
                    Some(offset)
                };
            }
            *self = Self::Explicit(self.iter().collect());
        }
        let Self::Explicit(map) = self else {
            unreachable!()
        };
        map.insert(id, offset)
    }

    /// Native compact spans, split only where payload identities were removed.
    fn active_runs(&self) -> Option<Vec<OffsetRun<Id>>> {
        let Self::Compact { runs, removed, .. } = self else {
            return None;
        };
        let mut active = Vec::new();
        for run in runs {
            let mut deleted: Vec<_> = removed
                .iter()
                .filter_map(|id| run.offset_of(*id))
                .map(|offset| offset - run.payload_start)
                .collect();
            deleted.sort_unstable();
            let mut start = 0;
            for end in deleted.into_iter().chain([run.len]) {
                if start < end {
                    active.push(OffsetRun {
                        first: run.id_at(start),
                        len: end - start,
                        payload_start: run.payload_start + start,
                    });
                }
                start = end.saturating_add(1);
            }
        }
        active.sort_unstable_by_key(|run| run.payload_start);
        Some(active)
    }

    /// Compact snapshot transport remains compact after deletes and restores.
    pub fn axis_ref(&self) -> Option<AxisIdentityRef<Id>> {
        let runs = self.active_runs()?;
        let mut refs: Vec<AxisIdentityRunRef> = Vec::new();
        for run in runs {
            let first = decode(run.first)?;
            if let Some(previous) = refs.last_mut()
                && previous.run_id == first.run_id
                && previous.start_offset + previous.len == first.offset
            {
                previous.len += run.len;
            } else {
                refs.push(AxisIdentityRunRef::new(first.run_id, first.offset, run.len));
            }
        }
        if refs.len() == 1 {
            let run = refs[0];
            Some(AxisIdentityRef::StoreRun {
                run_id: run.run_id,
                start_offset: run.start_offset,
                len: run.len,
            })
        } else {
            Some(AxisIdentityRef::Runs(refs))
        }
    }

    /// IDs in stable payload order, used only by explicit snapshot transport.
    pub fn ordered_ids(&self) -> Vec<Id> {
        if let Some(runs) = self.active_runs() {
            return runs
                .iter()
                .flat_map(|run| (0..run.len).map(|local| run.id_at(local)))
                .collect();
        }
        let mut entries: Vec<_> = self.iter().collect();
        entries.sort_unstable_by_key(|(_, offset)| *offset);
        entries.into_iter().map(|(id, _)| id).collect()
    }

    /// Intersect compact identity spans with the current physical axis. Each
    /// callback receives (payload offset, physical position, span length).
    fn visit_positions(
        &self,
        sheet: SheetId,
        axis: &AxisIndex<Id>,
        mut visit: impl FnMut(u32, u32, u32),
    ) {
        if let (Some(runs), AxisIdentityStore::Runs(current)) = (self.active_runs(), axis.store()) {
            for segment in current.segments() {
                let Some(first) = axis.identity_at(sheet, segment.position_start) else {
                    continue;
                };
                let current_start = first.as_raw();
                let current_end = current_start + u128::from(segment.run.len);
                for run in &runs {
                    let run_start = run.first.as_raw();
                    let start = run_start.max(current_start);
                    let end = (run_start + u128::from(run.len)).min(current_end);
                    if start < end {
                        visit(
                            run.payload_start + (start - run_start) as u32,
                            segment.position_start + (start - current_start) as u32,
                            (end - start) as u32,
                        );
                    }
                }
            }
        } else {
            for (id, offset) in self.iter() {
                if let Some(pos) = axis.position_of(sheet, id) {
                    visit(offset, pos, 1);
                }
            }
        }
    }

    pub fn position_bounds(&self, sheet: SheetId, axis: &AxisIndex<Id>) -> Option<(u32, u32)> {
        let mut bounds: Option<(u32, u32)> = None;
        self.visit_positions(sheet, axis, |_, start, len| {
            let end = start + len - 1;
            bounds = Some(bounds.map_or((start, end), |(min, max)| (min.min(start), max.max(end))));
        });
        bounds
    }

    /// Copy identities by physical position while retaining immutable payload
    /// offsets. Compact axes are intersected as spans, including after edits.
    pub fn remap_positions(
        &self,
        source_sheet: SheetId,
        source: &AxisIndex<Id>,
        destination_sheet: SheetId,
        destination: &AxisIndex<Id>,
    ) -> Self {
        let AxisIdentityStore::Runs(destination_runs) = destination.store() else {
            return self
                .iter()
                .filter_map(|(id, offset)| {
                    let position = source.position_of(source_sheet, id)?;
                    Some((
                        destination.identity_at(destination_sheet, position)?,
                        offset,
                    ))
                })
                .collect();
        };
        let mut runs = Vec::new();
        let mut count = 0;
        self.visit_positions(source_sheet, source, |offset, position, len| {
            for segment in destination_runs.segments() {
                let start = position.max(segment.position_start);
                let end = (position + len).min(segment.position_end());
                if start < end {
                    runs.push(OffsetRun {
                        first: destination
                            .identity_at(destination_sheet, start)
                            .expect("copied position within allocated axis"),
                        len: end - start,
                        payload_start: offset + start - position,
                    });
                    count += (end - start) as usize;
                }
            }
        });
        runs.sort_unstable_by_key(|run| run.first.as_raw());
        Self::Compact {
            runs,
            removed: FxHashSet::default(),
            len: count,
        }
    }

    /// Physical origin when every payload offset still addresses a contiguous
    /// row span. Sorting or interior inserts invalidate the shared column view.
    pub fn contiguous_start(&self, sheet: SheetId, axis: &AxisIndex<Id>) -> Option<u32> {
        let mut origin = None;
        let mut valid = true;
        let mut count = 0_usize;
        let mut payload_end = 0;
        self.visit_positions(sheet, axis, |offset, position, len| {
            let candidate = position.checked_sub(offset);
            if candidate.is_none() || origin.is_some_and(|origin| Some(origin) != candidate) {
                valid = false;
            }
            origin = candidate;
            count += len as usize;
            payload_end = payload_end.max(offset as usize + len as usize);
        });
        (valid && count == self.len() && payload_end == count)
            .then_some(origin)
            .flatten()
    }
}

impl<Id: AxisIdentityId + std::hash::Hash> FromIterator<(Id, u32)> for RangeOffsets<Id> {
    fn from_iter<T: IntoIterator<Item = (Id, u32)>>(iter: T) -> Self {
        let mut result = Self::Compact {
            runs: Vec::new(),
            removed: FxHashSet::default(),
            len: 0,
        };
        for (id, offset) in iter {
            if let Self::Compact { runs, len, .. } = &mut result {
                if decode(id).is_some()
                    && (runs.len() < 16 || runs.len() * 2 <= *len)
                    && offset == *len as u32
                    && !runs.iter().any(|run| run.offset_of(id).is_some())
                {
                    if let Some(last) = runs.last_mut()
                        && last.first.as_raw() + u128::from(last.len) == id.as_raw()
                        && (last.first.as_raw() >> 32) == (id.as_raw() >> 32)
                    {
                        last.len += 1;
                    } else {
                        runs.push(OffsetRun {
                            first: id,
                            len: 1,
                            payload_start: offset,
                        });
                    }
                    *len += 1;
                    continue;
                }
            }
            result.insert(id, offset);
        }
        // Scrambled explicit inputs gain nothing from a one-entry run per ID.
        if let Self::Compact { runs, len, .. } = &result
            && runs.len() > 1
            && runs.len() * 2 > *len
        {
            result = Self::Explicit(result.iter().collect());
        }
        if let Self::Compact { runs, .. } = &mut result {
            runs.sort_unstable_by_key(|run| run.first.as_raw());
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::{AxisIdentityRun, AxisIdentitySeed, AxisRunId};

    fn fixture(len: u32) -> (SheetId, AxisIdentityStore<RowId>, AxisIdentityRef<RowId>) {
        let sheet = SheetId::from_raw(42);
        let run = AxisIdentityRun::new(
            AxisRunId::from_raw(7),
            AxisIdentitySeed::from_raw(11),
            100,
            len,
        );
        let axis = AxisIdentityStore::from_runs([run]);
        let reference = AxisIdentityRef::StoreRun {
            run_id: run.run_id,
            start_offset: 100,
            len,
        };
        (sheet, axis, reference)
    }

    #[test]
    fn million_rows_use_one_arithmetic_span_and_sparse_restore_records() {
        let (sheet, axis, reference) = fixture(1_000_000);
        let mut offsets = RangeOffsets::from_axis_ref(sheet, &reference, &axis).unwrap();
        let row = axis.identity_at(sheet, 500_000).unwrap();
        assert_eq!(offsets.get(&row), Some(500_000));
        assert_eq!(offsets.len(), 1_000_000);
        assert!(
            matches!(&offsets, RangeOffsets::Compact { runs, removed, .. }
            if runs.len() == 1 && removed.is_empty())
        );
        assert_eq!(offsets.remove(&row), Some(500_000));
        assert_eq!(offsets.get(&row), None);
        assert_eq!(offsets.len(), 999_999);
        assert!(
            matches!(&offsets, RangeOffsets::Compact { runs, removed, .. }
            if runs.len() == 1 && removed.len() == 1)
        );
        assert_eq!(offsets.insert(row, 500_000), None);
        assert_eq!(offsets.axis_ref(), Some(reference));
        assert_eq!(offsets.len(), 1_000_000);
        let wrong_sheet = axis.identity_at(SheetId::from_raw(43), 500_000).unwrap();
        assert_eq!(offsets.get(&wrong_sheet), None);
    }

    #[test]
    fn physical_edits_preserve_offsets_and_detect_noncontiguous_column_views() {
        let (sheet, axis, reference) = fixture(8);
        let mut offsets = RangeOffsets::from_axis_ref(sheet, &reference, &axis).unwrap();
        let mut current = AxisIndex::new(sheet, axis.clone());
        assert_eq!(offsets.contiguous_start(sheet, &current), Some(0));
        current.insert_run(
            sheet,
            3,
            AxisIdentityRun::new(AxisRunId::from_raw(8), AxisIdentitySeed::from_raw(12), 0, 2),
        );
        assert_eq!(offsets.position_bounds(sheet, &current), Some((0, 9)));
        assert_eq!(offsets.contiguous_start(sheet, &current), None);
        assert_eq!(
            offsets.get(&current.identity_at(sheet, 5).unwrap()),
            Some(3)
        );
        assert_eq!(offsets.get(&current.identity_at(sheet, 3).unwrap()), None);
        current.delete_range(3, 2);
        assert_eq!(offsets.contiguous_start(sheet, &current), Some(0));
        current.reorder_positions(&[(1, 6), (6, 1)]);
        assert_eq!(offsets.contiguous_start(sheet, &current), None);
        let deleted = current.identity_at(sheet, 0).unwrap();
        offsets.remove(&deleted);
        current.delete_range(0, 1);
        assert_eq!(offsets.position_bounds(sheet, &current), Some((0, 6)));
        assert_eq!(offsets.get(&axis.identity_at(sheet, 6).unwrap()), Some(6));
    }

    #[test]
    fn compact_snapshot_refs_skip_deleted_ids_and_compact_payload_offsets() {
        let (sheet, mut axis, reference) = fixture(8);
        let mut offsets = RangeOffsets::from_axis_ref(sheet, &reference, &axis).unwrap();
        let deleted = axis.identity_at(sheet, 3).unwrap();
        offsets.remove(&deleted);
        axis.delete_range(3, 1);
        let snapshot = offsets.axis_ref().unwrap();
        let restored = RangeOffsets::from_axis_ref(sheet, &snapshot, &axis).unwrap();
        assert_eq!(restored.ordered_ids(), offsets.ordered_ids());
        assert_eq!(restored.get(&deleted), None);
        let last = axis.identity_at(sheet, 6).unwrap();
        assert_eq!(offsets.get(&last), Some(7));
        assert_eq!(restored.get(&last), Some(6));
        assert_eq!(
            restored.contiguous_start(sheet, &AxisIndex::new(sheet, axis)),
            Some(0)
        );
    }

    #[test]
    fn fragmented_explicit_payload_order_and_history_remaps_are_preserved() {
        let (sheet, axis, _) = fixture(4);
        let rows: Vec<_> = axis.identities_in(sheet, 0, 4).collect();
        let mut offsets: RangeOffsets<_> = [(rows[3], 0), (rows[1], 1), (rows[0], 2), (rows[2], 3)]
            .into_iter()
            .collect();
        assert!(matches!(offsets, RangeOffsets::Explicit(_)));
        assert_eq!(
            offsets.ordered_ids(),
            vec![rows[3], rows[1], rows[0], rows[2]]
        );
        assert_eq!(offsets.insert(rows[3], 7), Some(0));
        assert_eq!(offsets.get(&rows[3]), Some(7));
        let repeated: RangeOffsets<_> = [(rows[0], 0), (rows[0], 1)].into_iter().collect();
        assert_eq!(repeated.len(), 1);
        assert_eq!(repeated.get(&rows[0]), Some(1));
    }

    #[test]
    fn imported_position_gaps_stay_compact_and_reject_missing_run_spans() {
        let (sheet, mut axis, reference) = fixture(10);
        let offsets = RangeOffsets::from_positions(sheet, &axis, [0, 1, 2, 5, 6, 9]);
        assert!(matches!(&offsets, RangeOffsets::Compact { runs, .. } if runs.len() == 3));
        assert_eq!(offsets.get(&axis.identity_at(sheet, 6).unwrap()), Some(4));
        assert_eq!(offsets.get(&axis.identity_at(sheet, 3).unwrap()), None);
        assert_eq!(
            offsets.position_bounds(sheet, &AxisIndex::new(sheet, axis.clone())),
            Some((0, 9))
        );
        axis.delete_range(4, 1);
        assert!(RangeOffsets::from_axis_ref(sheet, &reference, &axis).is_none());
    }

    #[test]
    fn copying_a_million_row_range_remaps_spans_and_preserves_payload_holes() {
        let (sheet, axis, reference) = fixture(1_000_000);
        let mut offsets = RangeOffsets::from_axis_ref(sheet, &reference, &axis).unwrap();
        let mut source = AxisIndex::new(sheet, axis);
        offsets.remove(&source.identity_at(sheet, 4).unwrap());
        source.delete_range(4, 1);
        source.reorder_positions(&[(1, 6), (6, 1)]);
        let destination_sheet = SheetId::from_raw(43);
        let destination = AxisIndex::new(
            destination_sheet,
            AxisIdentityStore::from_runs([AxisIdentityRun::new(
                AxisRunId::from_raw(9),
                AxisIdentitySeed::from_raw(13),
                0,
                source.len(),
            )]),
        );
        let copied = offsets.remap_positions(sheet, &source, destination_sheet, &destination);
        assert!(
            matches!(&copied, RangeOffsets::Compact { runs, removed, .. }
            if runs.len() <= 7 && removed.is_empty())
        );
        assert_eq!(copied.len(), 999_999);
        for position in [0, 1, 3, 4, 6, 7, 999_998] {
            assert_eq!(
                copied.get(
                    &destination
                        .identity_at(destination_sheet, position)
                        .unwrap()
                ),
                offsets.get(&source.identity_at(sheet, position).unwrap()),
            );
        }
        assert_eq!(
            copied.contiguous_start(destination_sheet, &destination),
            None
        );
    }
}
