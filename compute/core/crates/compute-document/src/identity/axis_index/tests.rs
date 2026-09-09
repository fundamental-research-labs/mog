use super::*;
use cell_types::{AxisIdentityRun, AxisIdentitySeed, AxisRunId, ColId, RowId};
use std::sync::Arc;

fn run(id: u64, start: u32, len: u32) -> AxisIdentityRun {
    AxisIdentityRun::new(
        AxisRunId::from_raw(id),
        AxisIdentitySeed::from_raw(11),
        start,
        len,
    )
}

fn check_native_parity(axis: &AxisIndex<RowId>, sheet: SheetId) {
    for position in 0..axis.len() {
        let expected = axis.store().identity_at(sheet, position).unwrap();
        assert_eq!(axis.identity_at(sheet, position), Some(expected));
        assert_eq!(axis.position_of(sheet, expected), Some(position));
    }
    assert_eq!(axis.identity_at(sheet, axis.len()), None);
}

#[test]
fn a_million_rows_share_one_prefix_and_validate_identity_namespaces() {
    let sheet = SheetId::from_raw(42);
    let run = run(7, 100, 1_000_000);
    let axis = AxisIndex::<RowId>::new(sheet, AxisIdentityStore::from_runs([run]));
    assert!(
        matches!(&axis.lookup, AxisLookup::Compact { spans, reverse }
        if spans.len() == 1 && reverse.len() == 1)
    );
    for position in [0, 1, 500_000, 999_999] {
        let id = axis.identity_at(sheet, position).unwrap();
        assert_eq!(Some(id), axis.store().identity_at(sheet, position));
        assert_eq!(axis.position_of(sheet, id), Some(position));
    }
    assert_eq!(axis.identity_at(sheet, 1_000_000), None);
    let other_sheet = SheetId::from_raw(43);
    let own = axis.identity_at(sheet, 0).unwrap();
    let reserved_bit_alias = RowId::from_raw(own.as_raw() | (1_u128 << 112));
    assert_eq!(axis.store().position_of(sheet, reserved_bit_alias), Some(0));
    assert_eq!(axis.position_of(sheet, reserved_bit_alias), Some(0));
    let foreign = axis.identity_at(other_sheet, 0).unwrap();
    assert_eq!(axis.position_of(sheet, foreign), None);
    assert_eq!(axis.position_of(other_sheet, own), None);
    assert_eq!(axis.position_of(other_sheet, foreign), Some(0));
    assert_eq!(Some(foreign), axis.store().identity_at(other_sheet, 0));
    let wrong_seed = RowId::derive_compact(sheet, run.run_id, AxisIdentitySeed::from_raw(12), 100);
    assert_eq!(axis.position_of(sheet, wrong_seed), None);
    let wrong_axis = ColId::derive_compact(sheet, run.run_id, run.seed, 100);
    assert_eq!(
        axis.position_of(sheet, RowId::from_raw(wrong_axis.as_raw())),
        None
    );
    assert_eq!(axis.position_of(sheet, RowId::from_raw(0)), None);
}

#[test]
fn split_reordered_segments_and_cloned_axis_mutations_refresh_both_directions() {
    let sheet = SheetId::from_raw(42);
    let mut store = AxisIdentityStore::from_runs([run(7, 100, 10)]);
    store.split_at(4);
    let original = Arc::new(AxisIndex::<RowId>::new(sheet, store));
    let mut edited = Arc::clone(&original);
    Arc::make_mut(&mut edited).reorder_positions(&[(0, 8), (8, 0), (2, 5), (5, 2)]);
    check_native_parity(&edited, sheet);
    Arc::make_mut(&mut edited).insert_run(sheet, 3, run(8, 9, 2));
    check_native_parity(&edited, sheet);
    let removed = edited.identity_at(sheet, 6).unwrap();
    Arc::make_mut(&mut edited).delete_range(6, 1);
    assert_eq!(edited.position_of(sheet, removed), None);
    check_native_parity(&edited, sheet);
    check_native_parity(&original, sheet);
    assert_eq!(original.len(), 10);
    assert_ne!(edited.identity_at(sheet, 0), original.identity_at(sheet, 0));
    let AxisIdentityStore::Runs(store) = edited.store() else {
        panic!("compact axis retained")
    };
    assert!(
        matches!(&edited.lookup, AxisLookup::Compact { spans, reverse }
        if spans.len() == store.segments().len() && reverse.len() == spans.len())
    );
}

#[test]
fn explicit_axis_and_transition_from_compact_preserve_position_lookup() {
    let sheet = SheetId::from_raw(42);
    let mut axis = AxisIndex::<RowId>::new(sheet, AxisIdentityStore::from_runs([run(7, 100, 3)]));
    let inserted = RowId::from_raw(123);
    axis.insert_explicit(sheet, 1, [inserted]);
    assert!(matches!(axis.lookup, AxisLookup::Explicit(_)));
    check_native_parity(&axis, sheet);
    assert_eq!(axis.position_of(sheet, inserted), Some(1));
    axis.reorder_positions(&[(0, 3), (3, 0)]);
    axis.delete_range(0, 1);
    check_native_parity(&axis, sheet);
    // Explicit identity lookup remains independent of the sheet argument.
    assert_eq!(axis.position_of(SheetId::from_raw(99), inserted), Some(0));
}

#[test]
fn malformed_offsets_keep_native_overflow_checks_without_carrying_run_bits() {
    let sheet = SheetId::from_raw(42);
    let store = AxisIdentityStore::<RowId>::from_runs([run(7, u32::MAX - 1, 3)]);
    let axis = AxisIndex::new(sheet, store);
    assert!(matches!(axis.lookup, AxisLookup::Uncached));
    for position in [0, 1] {
        assert_eq!(
            axis.identity_at(sheet, position),
            axis.store().identity_at(sheet, position)
        );
    }
    assert!(std::panic::catch_unwind(|| axis.identity_at(sheet, 2)).is_err());
    assert!(std::panic::catch_unwind(|| axis.store().identity_at(sheet, 2)).is_err());
    let id = axis.identity_at(sheet, 0).unwrap();
    assert!(std::panic::catch_unwind(|| axis.position_of(sheet, id)).is_err());
    assert!(std::panic::catch_unwind(|| axis.store().position_of(sheet, id)).is_err());
}

#[test]
fn empty_and_overlapping_positioned_segments_keep_native_lookup_behavior() {
    use cell_types::{AxisIdentitySegment, CompactAxisIdentityStore};
    let sheet = SheetId::from_raw(42);
    for segments in [
        vec![
            AxisIdentitySegment::new(run(7, 0, 2), 0),
            AxisIdentitySegment::new(run(8, 0, 0), 0),
        ],
        vec![
            AxisIdentitySegment::new(run(7, 0, 3), 0),
            AxisIdentitySegment::new(run(8, 0, 2), 1),
        ],
        vec![
            AxisIdentitySegment::new(run(7, 0, 3), 0),
            AxisIdentitySegment::new(run(7, 1, 2), 3),
        ],
    ] {
        let store = AxisIdentityStore::<RowId>::Runs(CompactAxisIdentityStore::new(segments));
        let axis = AxisIndex::new(sheet, store);
        assert!(matches!(axis.lookup, AxisLookup::Uncached));
        for position in 0..5 {
            let id = axis.store().identity_at(sheet, position);
            assert_eq!(axis.identity_at(sheet, position), id);
            if let Some(id) = id {
                assert_eq!(
                    axis.position_of(sheet, id),
                    axis.store().position_of(sheet, id)
                );
            }
        }
    }
}
