use super::*;
use crate::cells::{CellStore, SheetStore};
use crate::eval::context::traits::EvalMetadata;
use crate::eval_bridge::{EvalContext, OverrideContext};
use cell_types::{CellId, SheetPos};
use std::cell::{Cell, RefCell};

fn fixture() -> (CellStore, SheetId) {
    let mut cell_store = CellStore::new();
    let sheet = SheetId::from_raw(1);
    cell_store.add_sheet_store(
        sheet,
        "Sheet1".into(),
        SheetStore::new(sheet, "Sheet1".into(), 10, 2),
    );
    for (row, value) in [1.0, 2.0, 1.0, 2.0].into_iter().enumerate() {
        cell_store.apply_edit(
            &sheet,
            CellId::from_raw(row as u128 + 100),
            SheetPos::new(row as u32, 0),
            CellValue::number(value),
            None,
        );
    }
    (cell_store, sheet)
}

#[test]
fn native_bitmask_cache_borrows_on_miss_and_refreshes_versions_and_collisions() {
    struct Counted<'a> {
        values: &'a [CellValue],
        reads: Cell<usize>,
    }
    impl ValueSlice for Counted<'_> {
        fn len(&self) -> usize {
            self.values.len()
        }
        fn get_value(&self, row: usize) -> Option<&CellValue> {
            self.reads.set(self.reads.get() + 1);
            self.values.get(row)
        }
    }
    let (mut cell_store, sheet) = fixture();
    let cache = WorkbookCache::new();
    let values = [
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(1.0),
    ];
    let counted = Counted {
        values: &values,
        reads: Cell::new(0),
    };
    let key = (sheet, 0, 0, 2, 123);
    let criterion = CellValue::number(1.0);
    for _ in 0..3 {
        let mask = cache
            .get_or_build_bitmask(key, &cell_store, &criterion, &counted)
            .unwrap();
        assert_eq!(mask.ones().collect::<Vec<_>>(), vec![0, 2]);
        assert_eq!(counted.reads.get(), 3, "cache hit reread native values");
    }
    assert!(
        cache
            .bitmask_cache
            .get(&key)
            .unwrap()
            .value
            ._arc_ref
            .is_none()
    );
    // A forced hash collision must compare the raw criterion and rebuild.
    let other = CellValue::number(2.0);
    assert!(cache.try_get_bitmask(&key, &cell_store, &other).is_none());
    let mask = cache
        .get_or_build_bitmask(key, &cell_store, &other, &counted)
        .unwrap();
    assert_eq!(mask.ones().collect::<Vec<_>>(), vec![1]);
    assert_eq!(counted.reads.get(), 6);
    cell_store.set_value_mut(&CellId::from_raw(100), CellValue::number(2.0));
    assert!(cache.try_get_bitmask(&key, &cell_store, &other).is_none());
    let changed = [
        CellValue::number(2.0),
        CellValue::number(2.0),
        CellValue::number(1.0),
    ];
    let mask = cache
        .get_or_build_bitmask(key, &cell_store, &other, &changed)
        .unwrap();
    assert_eq!(mask.ones().collect::<Vec<_>>(), vec![0, 1]);
}

#[test]
fn native_bitmask_cache_bounds_retained_bytes_and_rejects_oversized_builds() {
    struct Oversized;
    impl ValueSlice for Oversized {
        fn len(&self) -> usize {
            BITMASK_CACHE_BYTES * 8 + 1
        }
        fn get_value(&self, _: usize) -> Option<&CellValue> {
            panic!("oversized mask must not scan")
        }
    }
    let (cell_store, sheet) = fixture();
    let cache = WorkbookCache::new();
    let criterion = CellValue::number(1.0);
    assert!(
        cache
            .get_or_build_bitmask(
                (sheet, 0, 0, u32::MAX, 0),
                &cell_store,
                &criterion,
                &Oversized
            )
            .is_none()
    );
    for hash in 0..64 {
        let mask = ColumnBitset::new_all_false(8_000_000);
        let bytes = bitmask_entry_bytes(mask.len(), &criterion).unwrap();
        let entry = VersionedEntry::new(
            CachedBitmask {
                _arc_ref: None,
                criteria: criterion.clone(),
                bitmask: mask,
            },
            RangeVersion::capture(&cell_store, &sheet, 0, 0),
        );
        cache.insert_bitmask((sheet, 0, 0, 7_999_999, hash), entry, bytes);
        let stats = cache.stats_snapshot();
        assert!(stats.bitmask_memory_bytes <= BITMASK_CACHE_BYTES);
        assert!(stats.bitmask_entries <= BITMASK_CACHE_MAX);
    }
    assert!(cache.stats_snapshot().bitmask.evictions > 0);
    cache.invalidate_structure();
    let stats = cache.stats_snapshot();
    assert_eq!(stats.bitmask_entries, 0);
    assert_eq!(stats.bitmask_memory_bytes, 0);
}

#[test]
fn native_bitmask_context_uses_borrowed_window_and_bypasses_probe_overrides() {
    let (cell_store, sheet) = fixture();
    let cache = WorkbookCache::new();
    let current = CellId::from_raw(100);
    let column = cell_store
        .get_column_view(&sheet, 0)
        .unwrap();
    let window = column.slice(1..4);
    let criterion = CellValue::number(1.0);
    let mut context = EvalContext::new(&cell_store, current, sheet);
    context.workbook_cache = Some(&cache);
    let mask = context
        .get_or_build_criteria_bitmask(&sheet, 0, 1, 3, &criterion, window)
        .unwrap();
    assert_eq!(mask.len(), 3);
    assert_eq!(mask.ones().collect::<Vec<_>>(), vec![1]);
    assert!(
        context
            .get_criteria_bitmask(&sheet, 0, 1, 3, &criterion, window)
            .is_some()
    );
    assert!(
        context
            .get_criteria_bitmask(&sheet, 0, 0, 2, &criterion, window)
            .is_none()
    );

    let mut pending = EvalContext::with_pending_override(
        &cell_store,
        current,
        sheet,
        crate::eval_bridge::store_access::PendingCellOverride {
            sheet,
            pos: SheetPos::new(1, 0),
            value: CellValue::number(1.0),
        },
    );
    pending.workbook_cache = Some(&cache);
    assert!(
        pending
            .get_criteria_bitmask(&sheet, 0, 1, 3, &criterion, window)
            .is_none()
    );
    assert!(
        pending
            .get_or_build_criteria_bitmask(&sheet, 0, 1, 3, &criterion, window)
            .is_none()
    );
    let overrides = rustc_hash::FxHashMap::default();
    let ast_cache = rustc_hash::FxHashMap::default();
    let eval_cache = RefCell::new(rustc_hash::FxHashMap::default());
    let evaluating = RefCell::new(rustc_hash::FxHashSet::default());
    let probe = OverrideContext::new(
        &cell_store,
        current,
        sheet,
        &overrides,
        &ast_cache,
        &eval_cache,
        &evaluating,
    );
    assert!(
        probe
            .get_criteria_bitmask(&sheet, 0, 1, 3, &criterion, window)
            .is_none()
    );
    assert!(
        probe
            .get_or_build_criteria_bitmask(&sheet, 0, 1, 3, &criterion, window)
            .is_none()
    );
}
