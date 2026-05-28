use crate::filter_resolve::test_compute_top_bottom_cutoff;
use crate::types::TopBottomBy;

#[test]
fn test_cutoff_items() {
    assert_eq!(
        test_compute_top_bottom_cutoff(&[1.0, 2.0, 3.0], 2, TopBottomBy::Items),
        2
    );
    assert_eq!(
        test_compute_top_bottom_cutoff(&[1.0, 2.0, 3.0], 10, TopBottomBy::Items),
        3
    );
}

#[test]
fn test_cutoff_percent() {
    assert_eq!(
        test_compute_top_bottom_cutoff(&[1.0, 2.0, 3.0, 4.0, 5.0], 40, TopBottomBy::Percent),
        2
    );
    assert_eq!(
        test_compute_top_bottom_cutoff(&[1.0, 2.0, 3.0, 4.0, 5.0], 5, TopBottomBy::Percent),
        1
    );
}

#[test]
fn test_cutoff_sum() {
    assert_eq!(
        test_compute_top_bottom_cutoff(&[5.0, 4.0, 3.0, 2.0, 1.0], 60, TopBottomBy::Sum),
        2
    );
}

#[test]
fn test_cutoff_empty() {
    assert_eq!(
        test_compute_top_bottom_cutoff(&[], 5, TopBottomBy::Items),
        0
    );
}
