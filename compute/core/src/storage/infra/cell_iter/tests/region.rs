use std::cell::Cell;

use super::*;

#[test]
fn current_region_expands_contiguous_data_and_stops_at_empty_boundaries() {
    let sid = make_sheet_id(1);
    let region = get_current_region(sid, 1, 1, |row, col| row < 3 && col < 3);
    assert_eq!(region, RangePos::new(sid, 0, 0, 2, 2));
    let isolated = get_current_region(sid, 10, 10, |row, col| row == 10 && col == 10);
    assert_eq!(isolated, RangePos::new(sid, 10, 10, 10, 10));
    let empty = get_current_region(sid, 50, 10, |_, _| false);
    assert_eq!(empty, RangePos::new(sid, 50, 10, 50, 10));
}

#[test]
fn empty_start_uses_cardinal_adjacency_only() {
    let sid = make_sheet_id(1);
    let adjacent = get_current_region(sid, 5, 5, |row, col| row == 5 && (6..=7).contains(&col));
    assert_eq!(adjacent, RangePos::new(sid, 5, 5, 5, 7));
    let diagonal = get_current_region(sid, 5, 5, |row, col| row == 6 && col == 6);
    assert_eq!(diagonal, RangePos::new(sid, 5, 5, 5, 5));
}

#[test]
fn data_bounds_constrain_whole_axes_and_preserve_exact_selections() {
    let sid = make_sheet_id(1);
    let exact = RangePos::new(sid, 0, 0, 5, 5);
    assert_eq!(
        get_data_bounds_for_range(sid, &exact, RangeSpan::Exact, |_, _| false),
        Some(exact)
    );
    let column = RangePos::new(sid, 0, 0, 99, 0);
    assert_eq!(
        get_data_bounds_for_range(sid, &column, RangeSpan::FullColumns, |_, _| false),
        None
    );
    assert_eq!(
        get_data_bounds_for_range(sid, &column, RangeSpan::FullColumns, |row, col| (2..=4)
            .contains(&row)
            && col == 0),
        Some(RangePos::new(sid, 2, 0, 4, 0))
    );
    let row = RangePos::new(sid, 2, 0, 2, 25);
    assert_eq!(
        get_data_bounds_for_range(sid, &row, RangeSpan::FullRows, |row, col| row == 2
            && (3..=4).contains(&col)),
        Some(RangePos::new(sid, 2, 3, 2, 4))
    );
}

#[test]
fn dense_current_region_avoids_repeated_blank_boundary_scans() {
    let sid = make_sheet_id(1);
    let probe_count = Cell::new(0usize);
    let region = get_current_region(sid, 1, 1, |row, col| {
        probe_count.set(probe_count.get() + 1);
        row < 1813 && col < 10
    });
    assert_eq!(region, RangePos::new(sid, 0, 0, 1812, 9));
    assert!(
        probe_count.get() < 20_000,
        "dense lookup should not repeatedly rescan blank side boundaries: {} probes",
        probe_count.get()
    );
}
