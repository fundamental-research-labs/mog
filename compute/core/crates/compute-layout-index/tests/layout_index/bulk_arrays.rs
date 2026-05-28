use compute_layout_index::{DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, LayoutIndex};
use domain_types::units::Pixels;

#[test]
fn layout_index_bulk_positions() {
    let li = LayoutIndex::from_sparse(
        10,
        5,
        DEFAULT_ROW_HEIGHT,
        DEFAULT_COL_WIDTH,
        vec![(3, Pixels(50.0))],
        vec![],
        vec![],
        vec![],
    );
    let row_positions = li.build_row_positions(2, 6);
    assert_eq!(row_positions.len(), 5);
    assert_eq!(row_positions[0], 40.0);
    assert_eq!(row_positions[1], 60.0);
    assert_eq!(row_positions[2], 110.0);
    assert_eq!(row_positions[3], 130.0);
    assert_eq!(row_positions[4], 150.0);
}

#[test]
fn build_row_positions_sentinel_lets_caller_derive_last_row_height() {
    let li = LayoutIndex::from_sparse(
        10,
        5,
        DEFAULT_ROW_HEIGHT,
        DEFAULT_COL_WIDTH,
        vec![(5, Pixels(50.0))],
        vec![],
        vec![],
        vec![],
    );
    let row_positions = li.build_row_positions(2, 6);
    assert_eq!(row_positions.len(), 5);
    assert_eq!(row_positions[4] - row_positions[3], 50.0);
}

#[test]
fn fp_col_build_positions() {
    let li = LayoutIndex::from_sparse(
        5,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![(1, Pixels(100.0))],
        vec![],
        vec![],
    );
    let pos = li.build_col_positions(0, 5);
    assert_eq!(pos.len(), 6);
    assert_eq!(pos[0], 0.0);
    assert_eq!(pos[1], 64.0);
    assert_eq!(pos[2], 164.0);
    assert_eq!(pos[3], 228.0);
    assert_eq!(pos[4], 292.0);
    assert_eq!(pos[5], 356.0);
}

#[test]
fn fp_col_build_dimensions() {
    let li = LayoutIndex::from_sparse(
        5,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![(2, Pixels(100.0))],
        vec![],
        vec![3],
    );
    let dims = li.build_col_dimensions(0, 5);
    assert_eq!(dims, vec![64.0, 64.0, 100.0, 0.0, 64.0]);
}

#[test]
fn fp_row_build_dimensions() {
    let li = LayoutIndex::from_sparse(
        5,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![(1, Pixels(40.0))],
        vec![],
        vec![3],
        vec![],
    );
    let dims = li.build_row_dimensions(0, 5);
    assert_eq!(dims, vec![20.0, 40.0, 20.0, 0.0, 20.0]);
}

#[test]
fn fp_bulk_row_positions_match_individual() {
    let li = LayoutIndex::from_sparse(
        10,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![(2, Pixels(50.0)), (7, Pixels(5.0))],
        vec![],
        vec![4],
        vec![],
    );
    let bulk = li.build_row_positions(0, 10);
    assert_eq!(bulk.len(), 11);
    for i in 0..=10 {
        assert!(
            (bulk[i] - li.get_row_position(i).0).abs() < 1e-9,
            "Row position mismatch at {}: bulk={}, individual={:?}",
            i,
            bulk[i],
            li.get_row_position(i)
        );
    }
}

#[test]
fn fp_bulk_col_positions_match_individual() {
    let li = LayoutIndex::from_sparse(
        5,
        10,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![(0, Pixels(100.0)), (5, Pixels(30.0))],
        vec![],
        vec![3],
    );
    let bulk = li.build_col_positions(0, 10);
    assert_eq!(bulk.len(), 11);
    for j in 0..=10 {
        assert!(
            (bulk[j] - li.get_col_position(j).0).abs() < 1e-9,
            "Col position mismatch at {}: bulk={}, individual={:?}",
            j,
            bulk[j],
            li.get_col_position(j)
        );
    }
}

#[test]
fn fp_bulk_row_dimensions_match_individual() {
    let li = LayoutIndex::from_sparse(
        10,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![(1, Pixels(40.0)), (8, Pixels(5.0))],
        vec![],
        vec![3, 6],
        vec![],
    );
    let bulk = li.build_row_dimensions(0, 10);
    for i in 0..10 {
        assert!(
            (bulk[i] - li.get_row_height(i).0).abs() < 1e-9,
            "Row dim mismatch at {}: bulk={}, individual={:?}",
            i,
            bulk[i],
            li.get_row_height(i)
        );
    }
}

#[test]
fn fp_bulk_col_dimensions_match_individual() {
    let li = LayoutIndex::from_sparse(
        5,
        10,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![(2, Pixels(120.0)), (9, Pixels(10.0))],
        vec![],
        vec![0, 7],
    );
    let bulk = li.build_col_dimensions(0, 10);
    for j in 0..10 {
        assert!(
            (bulk[j] - li.get_col_width(j).0).abs() < 1e-9,
            "Col dim mismatch at {}: bulk={}, individual={:?}",
            j,
            bulk[j],
            li.get_col_width(j)
        );
    }
}

#[test]
fn fp_bulk_positions_subrange() {
    let li = LayoutIndex::with_defaults(20, 20, Pixels(20.0), Pixels(64.0));
    let bulk = li.build_row_positions(5, 10);
    assert_eq!(bulk.len(), 6);
    for (k, i) in (5..=10).enumerate() {
        assert_eq!(bulk[k], li.get_row_position(i).0);
    }
    let bulk_c = li.build_col_positions(3, 8);
    assert_eq!(bulk_c.len(), 6);
    for (k, j) in (3..=8).enumerate() {
        assert_eq!(bulk_c[k], li.get_col_position(j).0);
    }
}
