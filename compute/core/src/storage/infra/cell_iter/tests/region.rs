use std::cell::Cell;

use super::*;

#[test]
fn test_get_current_region_dense_extra_data_avoids_repeated_blank_boundary_scans() {
    let (storage, sid, grid) = storage_with_grid();
    let probe_count = Cell::new(0usize);

    let region = get_current_region_with_extra_data(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        1,
        1,
        |row, col| {
            probe_count.set(probe_count.get() + 1);
            row < 1813 && col < 10
        },
    );

    assert_eq!(region.start_row(), 0);
    assert_eq!(region.start_col(), 0);
    assert_eq!(region.end_row(), 1812);
    assert_eq!(region.end_col(), 9);
    assert!(
        probe_count.get() < 20_000,
        "dense 1813x10 current-region lookup should not repeatedly rescan blank side boundaries; probes={}",
        probe_count.get()
    );
}
