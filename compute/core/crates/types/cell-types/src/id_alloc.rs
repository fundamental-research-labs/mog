//! Thread-safe monotonic ID allocator.
//!
//! Replaces `uuid::Uuid::new_v4()` for generating [`CellId`], [`SheetId`],
//! [`RowId`], and [`ColId`] values. Uses an [`AtomicU64`] counter instead of
//! per-call `getrandom` syscalls, eliminating ~15% CPU overhead on large
//! workbook imports.
//!
//! # Thread safety
//!
//! `fetch_add(Relaxed)` is lock-free and guarantees uniqueness. No ordering
//! relationship between IDs generated on different threads is needed.

use std::sync::atomic::{AtomicU64, Ordering};

use crate::{CellId, ColId, RangeId, RowId, SheetId};

/// Sentinel value for the upper 64 bits of virtual `CellId`s.
///
/// Virtual `CellId`s are derived deterministically from `(SheetId, RowId, ColId)`
/// for Range-resident cells that have no per-cell Yrs entry. The sentinel
/// ensures disjointness from real `CellId`s by construction:
/// * `with_seed`: uses `high_bits = 0` — always distinct from the sentinel.
/// * `with_client_partition`: asserts `client_id != VIRTUAL_CELL_SENTINEL` at construction.
pub const VIRTUAL_CELL_SENTINEL: u64 = 0xFFFF_FFFF_FFFF_FFFE;

/// Monotonic ID allocator — generates unique `u128` values from an `AtomicU64` counter.
///
/// Each call to `next_*` returns a value that has never been returned before
/// (within this allocator instance). IDs start at 1 by default; use
/// [`with_seed`](Self::with_seed) to resume from a persisted high-water mark,
/// or [`with_client_partition`](Self::with_client_partition) for collaborative
/// editing where multiple clients must never produce overlapping IDs.
#[derive(Debug)]
pub struct IdAllocator {
    next: AtomicU64,
    /// Upper 64 bits OR'd into every generated `u128`.
    ///
    /// Zero for local-only allocators ([`new`](Self::new) / [`with_seed`](Self::with_seed)).
    /// Set to `(client_id as u128) << 64` by [`with_client_partition`](Self::with_client_partition).
    high_bits: u128,
}

impl IdAllocator {
    /// Create a new allocator starting at 1.
    ///
    /// Suitable for single-client / offline use where no other allocator
    /// instance will race for the same ID space.
    ///
    /// ```
    /// # use cell_types::IdAllocator;
    /// let alloc = IdAllocator::new();
    /// assert_eq!(alloc.next_u128(), 1);
    /// assert_eq!(alloc.next_u128(), 2);
    /// ```
    #[must_use]
    #[inline]
    pub fn new() -> Self {
        Self {
            next: AtomicU64::new(1),
            high_bits: 0,
        }
    }

    /// Create an allocator starting at `start`.
    ///
    /// Use this to resume from a persisted [`high_water_mark`](Self::high_water_mark)
    /// so that IDs are never reused across restarts.
    ///
    /// ```
    /// # use cell_types::IdAllocator;
    /// let alloc = IdAllocator::with_seed(500);
    /// assert_eq!(alloc.next_u128(), 500);
    /// assert_eq!(alloc.high_water_mark(), 501);
    /// ```
    #[must_use]
    #[inline]
    pub fn with_seed(start: u64) -> Self {
        Self {
            next: AtomicU64::new(start),
            high_bits: 0,
        }
    }

    /// Create an allocator whose IDs are partitioned by `client_id`.
    ///
    /// # Partitioning scheme
    ///
    /// The 128-bit ID space is split into two halves:
    ///
    /// ```text
    /// ┌──────────────────────┬──────────────────────┐
    /// │  upper 64 bits       │  lower 64 bits       │
    /// │  client_id           │  monotonic counter    │
    /// └──────────────────────┴──────────────────────┘
    /// ```
    ///
    /// Each generated ID is `(client_id as u128) << 64 | counter`. Because the
    /// upper half is unique per client, two allocators with different
    /// `client_id` values can **never** produce the same ID, even without any
    /// coordination.
    ///
    /// The counter starts at 1 and increments monotonically within the lower
    /// 64 bits, giving each client 2^64 - 1 IDs before wrapping.
    ///
    /// # When to use this vs [`new`](Self::new) / [`with_seed`](Self::with_seed)
    ///
    /// | Constructor | Use case |
    /// |---|---|
    /// | [`new`](Self::new) | Single-client or offline — no collision risk |
    /// | [`with_seed`](Self::with_seed) | Single-client, resuming after restart |
    /// | **`with_client_partition`** | Multi-client / collaborative editing |
    ///
    /// In a collaborative session each participant is assigned a distinct
    /// `client_id` (e.g. from the CRDT layer). Pass that value here so every
    /// peer's allocator lives in its own non-overlapping slice of the ID space.
    ///
    /// # Panics
    ///
    /// Panics if `client_id` is [`VIRTUAL_CELL_SENTINEL`], which is reserved for
    /// deterministic virtual [`CellId`] values.
    ///
    /// # Examples
    ///
    /// Two clients allocating IDs that never overlap:
    ///
    /// ```
    /// # use cell_types::IdAllocator;
    /// let alice = IdAllocator::with_client_partition(1);
    /// let bob   = IdAllocator::with_client_partition(2);
    ///
    /// let a1 = alice.next_u128();
    /// let a2 = alice.next_u128();
    /// let b1 = bob.next_u128();
    /// let b2 = bob.next_u128();
    ///
    /// // Alice's IDs have client_id=1 in the upper 64 bits.
    /// assert_eq!(a1, (1_u128 << 64) | 1);
    /// assert_eq!(a2, (1_u128 << 64) | 2);
    ///
    /// // Bob's IDs have client_id=2 in the upper 64 bits.
    /// assert_eq!(b1, (2_u128 << 64) | 1);
    /// assert_eq!(b2, (2_u128 << 64) | 2);
    ///
    /// // The four IDs are all distinct.
    /// assert_ne!(a1, b1);
    /// assert_ne!(a2, b2);
    /// ```
    #[must_use]
    #[inline]
    pub fn with_client_partition(client_id: u64) -> Self {
        assert!(
            client_id != VIRTUAL_CELL_SENTINEL,
            "client_id collides with virtual CellId namespace"
        );
        Self {
            next: AtomicU64::new(1),
            high_bits: u128::from(client_id) << 64,
        }
    }

    /// Return the next unique `u128` and advance the counter.
    #[inline]
    pub fn next_u128(&self) -> u128 {
        self.high_bits | u128::from(self.next.fetch_add(1, Ordering::Relaxed))
    }

    /// Generate the next unique [`CellId`].
    #[inline]
    pub fn next_cell_id(&self) -> CellId {
        CellId::from_raw(self.next_u128())
    }

    /// Generate the next unique [`SheetId`].
    #[inline]
    pub fn next_sheet_id(&self) -> SheetId {
        SheetId::from_raw(self.next_u128())
    }

    /// Generate the next unique [`RowId`].
    #[inline]
    pub fn next_row_id(&self) -> RowId {
        RowId::from_raw(self.next_u128())
    }

    /// Generate the next unique [`ColId`].
    #[inline]
    pub fn next_col_id(&self) -> ColId {
        ColId::from_raw(self.next_u128())
    }

    /// Generate the next unique [`RangeId`].
    #[inline]
    pub fn next_range_id(&self) -> RangeId {
        RangeId::from_raw(self.next_u128())
    }

    /// Atomically advance the counter so future allocations never collide
    /// with `raw_id`. No-op if the counter is already past it.
    pub fn ensure_past(&self, raw_id: u128) {
        let bytes = raw_id.to_le_bytes();
        let lower_bits = u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]);
        let target = lower_bits.saturating_add(1);
        loop {
            let current = self.next.load(Ordering::Relaxed);
            if current >= target {
                break;
            }
            if self
                .next
                .compare_exchange_weak(current, target, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                break;
            }
        }
    }

    /// Current counter value — the next ID that *will* be allocated.
    ///
    /// Persist this and pass to [`with_seed`](Self::with_seed) to resume
    /// without reusing IDs after a restart.
    ///
    /// ```
    /// # use cell_types::IdAllocator;
    /// let alloc = IdAllocator::new();
    /// assert_eq!(alloc.high_water_mark(), 1);
    ///
    /// alloc.next_u128();
    /// alloc.next_u128();
    /// assert_eq!(alloc.high_water_mark(), 3);
    ///
    /// // Resume later from the saved mark.
    /// let resumed = IdAllocator::with_seed(alloc.high_water_mark());
    /// assert_eq!(resumed.next_u128(), 3);
    /// ```
    #[inline]
    pub fn high_water_mark(&self) -> u64 {
        self.next.load(Ordering::Relaxed)
    }
}

impl Default for IdAllocator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn sequential_uniqueness() {
        let alloc = IdAllocator::new();
        let ids: Vec<u128> = (0..1000).map(|_| alloc.next_u128()).collect();
        let unique: HashSet<u128> = ids.iter().copied().collect();
        assert_eq!(ids.len(), unique.len());
    }

    #[test]
    fn starts_at_one() {
        let alloc = IdAllocator::new();
        assert_eq!(alloc.next_u128(), 1);
        assert_eq!(alloc.next_u128(), 2);
        assert_eq!(alloc.next_u128(), 3);
    }

    #[test]
    fn seed_resume() {
        let alloc = IdAllocator::with_seed(100);
        assert_eq!(alloc.next_u128(), 100);
        assert_eq!(alloc.next_u128(), 101);
        assert_eq!(alloc.high_water_mark(), 102);
    }

    #[test]
    fn high_water_mark_tracks() {
        let alloc = IdAllocator::new();
        assert_eq!(alloc.high_water_mark(), 1);
        alloc.next_u128();
        assert_eq!(alloc.high_water_mark(), 2);
        alloc.next_u128();
        alloc.next_u128();
        assert_eq!(alloc.high_water_mark(), 4);
    }

    #[test]
    fn typed_id_generation() {
        let alloc = IdAllocator::new();
        let cell = alloc.next_cell_id();
        let sheet = alloc.next_sheet_id();
        let row = alloc.next_row_id();
        let col = alloc.next_col_id();
        // All unique — counter advances for each
        let range = alloc.next_range_id();
        assert_eq!(cell.as_u128(), 1);
        assert_eq!(sheet.as_u128(), 2);
        assert_eq!(row.as_u128(), 3);
        assert_eq!(col.as_u128(), 4);
        assert_eq!(range.as_u128(), 5);
    }

    #[test]
    fn thread_safety() {
        use std::sync::Arc;
        let alloc = Arc::new(IdAllocator::new());
        let mut handles = Vec::new();

        for _ in 0..4 {
            let a = Arc::clone(&alloc);
            handles.push(std::thread::spawn(move || {
                (0..10_000).map(|_| a.next_u128()).collect::<Vec<_>>()
            }));
        }

        let mut all_ids = HashSet::new();
        for h in handles {
            for id in h.join().unwrap() {
                assert!(all_ids.insert(id), "duplicate ID: {id}");
            }
        }
        assert_eq!(all_ids.len(), 40_000);
    }

    #[test]
    fn serde_roundtrip_for_monotonic_ids() {
        let alloc = IdAllocator::new();
        let cell = alloc.next_cell_id();
        // Small integer serializes as valid UUID string
        let json = serde_json::to_string(&cell).unwrap();
        assert_eq!(json, "\"00000000000000000000000000000001\"");
        let parsed: CellId = serde_json::from_str(&json).unwrap();
        assert_eq!(cell, parsed);
    }

    #[test]
    fn client_partition_ids_never_overlap() {
        let alice = IdAllocator::with_client_partition(1);
        let bob = IdAllocator::with_client_partition(2);
        let mut all = HashSet::new();
        for _ in 0..1000 {
            assert!(all.insert(alice.next_u128()));
            assert!(all.insert(bob.next_u128()));
        }
        assert_eq!(all.len(), 2000);
    }

    #[test]
    fn ensure_past_advances_counter() {
        let alloc = IdAllocator::with_seed(10);
        alloc.ensure_past(50);
        assert_eq!(alloc.high_water_mark(), 51);
        // No-op when already past
        alloc.ensure_past(30);
        assert_eq!(alloc.high_water_mark(), 51);
    }

    #[test]
    fn default_matches_new() {
        let d = IdAllocator::default();
        let n = IdAllocator::new();
        assert_eq!(d.next_u128(), n.next_u128());
    }
}
