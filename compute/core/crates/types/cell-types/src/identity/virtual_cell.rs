use super::base_ids::{CellId, ColId, RowId, SheetId};

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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn virtual_id_differs_across_rows_and_columns() {
        let sheet = SheetId::from_raw(1);
        let base = CellId::virtual_at(sheet, RowId::from_raw(1), ColId::from_raw(1));
        let different_row = CellId::virtual_at(sheet, RowId::from_raw(2), ColId::from_raw(1));
        let different_col = CellId::virtual_at(sheet, RowId::from_raw(1), ColId::from_raw(2));

        assert_ne!(base, different_row);
        assert_ne!(base, different_col);
    }

    #[test]
    #[should_panic(expected = "virtual CellId namespace")]
    fn sentinel_client_id_rejected() {
        let _ = crate::IdAllocator::with_client_partition(crate::id_alloc::VIRTUAL_CELL_SENTINEL);
    }
}
