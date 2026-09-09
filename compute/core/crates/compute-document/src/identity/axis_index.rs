//! Shared native axis order and its derived lookup index.

use cell_types::{AxisIdentityId, AxisIdentityStore, SheetId};
use rustc_hash::FxHashMap;
use std::ops::Deref;

/// Native axis order shared by the grid and formula lookup store.
/// Compact axes resolve identities directly; explicit axes use one reverse index.
#[derive(Debug, Clone)]
pub struct AxisIndex<Id> {
    sheet: SheetId,
    store: AxisIdentityStore<Id>,
    lookup: AxisLookup<Id>,
}

#[derive(Debug, Clone)]
enum AxisLookup<Id> {
    Explicit(FxHashMap<Id, u32>),
    Compact {
        spans: Vec<IdentitySpan>,
        reverse: Vec<usize>,
    },
    Uncached,
}

/// The sheet/seed fingerprint is constant throughout a compact segment.
/// Retain its first encoded ID so hot reads only add/subtract an offset.
#[derive(Debug, Clone)]
struct IdentitySpan {
    first: u128,
    position: u32,
    len: u32,
}

impl<Id: AxisIdentityId + std::hash::Hash> AxisIndex<Id> {
    /// Build an index without expanding compact runs.
    pub fn new(sheet: SheetId, store: AxisIdentityStore<Id>) -> Self {
        let lookup = Self::build_lookup(sheet, &store);
        Self {
            sheet,
            store,
            lookup,
        }
    }

    /// Borrow the serializable native axis order.
    #[inline]
    pub fn store(&self) -> &AxisIdentityStore<Id> {
        &self.store
    }

    /// Resolve physical position without hashing a compact run's fingerprint
    /// again for every cell read. The index remains proportional to segments.
    #[inline]
    pub fn identity_at(&self, sheet: SheetId, position: u32) -> Option<Id> {
        match &self.lookup {
            AxisLookup::Explicit(_) | AxisLookup::Uncached => {
                self.store.identity_at(sheet, position)
            }
            AxisLookup::Compact { spans, .. } => {
                if sheet != self.sheet {
                    return self.store.identity_at(sheet, position);
                }
                let index = spans
                    .partition_point(|span| span.position <= position)
                    .checked_sub(1)?;
                let span = &spans[index];
                let offset = position - span.position;
                (offset < span.len).then(|| Id::from_compact_raw(span.first + u128::from(offset)))
            }
        }
    }

    /// Resolve an identity in constant time for explicit axes, or by compact run.
    #[inline]
    pub fn position_of(&self, sheet: SheetId, id: Id) -> Option<u32> {
        match &self.lookup {
            AxisLookup::Explicit(positions) => positions.get(&id).copied(),
            AxisLookup::Uncached => self.store.position_of(sheet, id),
            AxisLookup::Compact { spans, reverse } => {
                if sheet != self.sheet {
                    return self.store.position_of(sheet, id);
                }
                let raw = id.as_raw();
                let span = reverse
                    .partition_point(|index| spans[*index].first <= raw)
                    .checked_sub(1)
                    .map(|index| &spans[reverse[index]]);
                // Full raw bounds validate the axis kind, sheet/seed fingerprint,
                // run ID and offset together; other namespaces cannot match.
                if let Some(span) = span
                    && let Some(offset) = raw.checked_sub(span.first)
                    && offset < u128::from(span.len)
                {
                    Some(span.position + offset as u32)
                } else {
                    // The native decoder accepts aliases with reserved bits set.
                    // Keep that compatibility on misses without hashing hot hits.
                    self.store.position_of(sheet, id)
                }
            }
        }
    }

    /// Remove an interval and rebuild the compact spans or explicit reverse index.
    pub fn delete_range(&mut self, at: u32, count: u32) {
        self.store.delete_range(at, count);
        self.reindex();
    }

    /// Insert existing identities into their new physical positions.
    pub fn insert_explicit(&mut self, sheet: SheetId, at: u32, ids: impl IntoIterator<Item = Id>) {
        let at = at.min(self.store.len()) as usize;
        match &mut self.store {
            AxisIdentityStore::Explicit(existing) => {
                existing.splice(at..at, ids);
            }
            store => {
                let mut existing: Vec<Id> = store.identities_in(sheet, 0, store.len()).collect();
                existing.splice(at..at, ids);
                *store = AxisIdentityStore::Explicit(existing);
            }
        }
        self.reindex();
    }

    /// Insert a generated run without expanding a compact axis.
    pub fn insert_run(&mut self, sheet: SheetId, at: u32, run: cell_types::AxisIdentityRun) {
        self.store.insert_run(sheet, at, run);
        self.reindex();
    }

    /// Reorder selected positions while retaining unaffected compact runs.
    pub fn reorder_positions(&mut self, permutation: &[(u32, u32)]) {
        self.store.reorder_positions(permutation);
        self.reindex();
    }

    fn reindex(&mut self) {
        self.lookup = Self::build_lookup(self.sheet, &self.store);
    }

    fn build_lookup(sheet: SheetId, store: &AxisIdentityStore<Id>) -> AxisLookup<Id> {
        match store {
            AxisIdentityStore::Explicit(ids) => AxisLookup::Explicit(
                ids.iter()
                    .enumerate()
                    .map(|(pos, id)| (*id, pos as u32))
                    .collect(),
            ),
            AxisIdentityStore::Runs(compact) => {
                // Preserve the native store's checked-overflow behavior for
                // malformed descriptors; offsets must never carry into run bits.
                if compact.segments().iter().any(|segment| {
                    segment.run.len == 0
                        || segment
                            .run
                            .start_offset
                            .checked_add(segment.run.len)
                            .is_none()
                        || segment
                            .position_start
                            .checked_add(segment.run.len)
                            .is_none()
                        || segment.run.run_id.as_u64() >= (1_u64 << 48)
                }) {
                    return AxisLookup::Uncached;
                }
                if compact
                    .segments()
                    .windows(2)
                    .any(|pair| pair[0].position_start + pair[0].run.len > pair[1].position_start)
                {
                    return AxisLookup::Uncached;
                }
                let spans: Vec<_> = compact
                    .segments()
                    .iter()
                    .filter(|segment| segment.run.len > 0)
                    .map(|segment| IdentitySpan {
                        first: store
                            .identity_at(sheet, segment.position_start)
                            .expect("nonempty compact segment")
                            .as_raw(),
                        position: segment.position_start,
                        len: segment.run.len,
                    })
                    .collect();
                let mut reverse: Vec<_> = (0..spans.len()).collect();
                reverse.sort_unstable_by_key(|index| spans[*index].first);
                if reverse.windows(2).any(|pair| {
                    spans[pair[0]].first + u128::from(spans[pair[0]].len) > spans[pair[1]].first
                }) {
                    return AxisLookup::Uncached;
                }
                AxisLookup::Compact { spans, reverse }
            }
        }
    }
}

#[cfg(test)]
mod tests;

impl<Id> Deref for AxisIndex<Id> {
    type Target = AxisIdentityStore<Id>;
    fn deref(&self) -> &Self::Target {
        &self.store
    }
}
