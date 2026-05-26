//! Re-export of the generic interval tree from `cell-types`, specialized to `RangePos`.

use cell_types::RangePos;
use cell_types::interval_tree::IntervalTree;

/// Augmented interval tree specialized to [`RangePos`] for range containment queries.
pub(crate) type RangeIntervalTree = IntervalTree<RangePos>;

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::SheetId;

    fn range(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> RangePos {
        RangePos::new(SheetId::from_raw(1), start_row, start_col, end_row, end_col)
    }

    #[test]
    fn empty_tree() {
        let tree = RangeIntervalTree::new();
        assert!(tree.is_empty());
        assert_eq!(tree.len(), 0);
        assert!(tree.query(0, 0).is_empty());
    }

    #[test]
    fn build_empty() {
        let tree = RangeIntervalTree::build(&[]);
        assert!(tree.is_empty());
        assert_eq!(tree.len(), 0);
        assert!(tree.query(5, 5).is_empty());
    }

    #[test]
    fn single_range_hit() {
        let r = range(2, 3, 8, 6);
        let tree = RangeIntervalTree::build(&[r]);
        assert_eq!(tree.len(), 1);
        assert!(!tree.is_empty());

        let hits = tree.query(5, 4);
        assert_eq!(hits.len(), 1);
        assert_eq!(*hits[0], r);

        assert_eq!(tree.query(2, 3).len(), 1);
        assert_eq!(tree.query(8, 6).len(), 1);
        assert_eq!(tree.query(2, 6).len(), 1);
        assert_eq!(tree.query(8, 3).len(), 1);
    }

    #[test]
    fn single_range_miss() {
        let r = range(2, 3, 8, 6);
        let tree = RangeIntervalTree::build(&[r]);

        assert!(tree.query(1, 4).is_empty());
        assert!(tree.query(9, 4).is_empty());
        assert!(tree.query(5, 2).is_empty());
        assert!(tree.query(5, 7).is_empty());
        assert!(tree.query(0, 0).is_empty());
    }

    #[test]
    fn multiple_overlapping_ranges() {
        let ranges = vec![range(0, 0, 10, 10), range(3, 3, 7, 7), range(5, 0, 15, 5)];
        let tree = RangeIntervalTree::build(&ranges);
        assert_eq!(tree.len(), 3);

        let hits = tree.query(5, 4);
        assert_eq!(hits.len(), 3);

        let hits = tree.query(1, 1);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].start_row(), 0);

        let hits = tree.query(12, 3);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].start_row(), 5);

        assert!(tree.query(12, 8).is_empty());
    }

    #[test]
    fn column_filtering() {
        let r = range(0, 5, 10, 8);
        let tree = RangeIntervalTree::build(&[r]);

        assert!(tree.query(5, 2).is_empty());
        assert!(tree.query(5, 4).is_empty());
        assert!(tree.query(5, 9).is_empty());

        assert_eq!(tree.query(5, 5).len(), 1);
        assert_eq!(tree.query(5, 8).len(), 1);
    }

    #[test]
    fn single_cell_range() {
        let r = range(7, 3, 7, 3);
        let tree = RangeIntervalTree::build(&[r]);

        assert_eq!(tree.query(7, 3).len(), 1);
        assert!(tree.query(7, 2).is_empty());
        assert!(tree.query(7, 4).is_empty());
        assert!(tree.query(6, 3).is_empty());
        assert!(tree.query(8, 3).is_empty());
    }

    #[test]
    fn single_row_range() {
        let r = range(5, 0, 5, 100);
        let tree = RangeIntervalTree::build(&[r]);

        assert_eq!(tree.query(5, 0).len(), 1);
        assert_eq!(tree.query(5, 50).len(), 1);
        assert_eq!(tree.query(5, 100).len(), 1);
        assert!(tree.query(4, 50).is_empty());
        assert!(tree.query(6, 50).is_empty());
    }

    #[test]
    fn full_sheet_range() {
        let r = range(0, 0, u32::MAX, u32::MAX);
        let tree = RangeIntervalTree::build(&[r]);

        assert_eq!(tree.query(0, 0).len(), 1);
        assert_eq!(tree.query(u32::MAX, u32::MAX).len(), 1);
        assert_eq!(tree.query(500_000, 100).len(), 1);
    }

    #[test]
    fn boundary_values() {
        let r = range(0, 0, 0, 0);
        let tree = RangeIntervalTree::build(&[r]);

        assert_eq!(tree.query(0, 0).len(), 1);
        assert!(tree.query(0, 1).is_empty());
        assert!(tree.query(1, 0).is_empty());
    }

    #[test]
    fn adjacent_non_overlapping_ranges() {
        let ranges = vec![range(0, 0, 4, 4), range(5, 0, 9, 4), range(10, 0, 14, 4)];
        let tree = RangeIntervalTree::build(&ranges);

        assert_eq!(tree.query(2, 2).len(), 1);
        assert_eq!(tree.query(7, 2).len(), 1);
        assert_eq!(tree.query(12, 2).len(), 1);

        assert_eq!(tree.query(4, 2).len(), 1);
        assert_eq!(tree.query(5, 2).len(), 1);
    }

    #[test]
    fn stress_test_many_ranges() {
        let ranges: Vec<RangePos> = (0..1000).map(|i| range(i * 10, 0, i * 10 + 5, 5)).collect();
        let tree = RangeIntervalTree::build(&ranges);
        assert_eq!(tree.len(), 1000);

        for i in 0..1000u32 {
            let hits = tree.query(i * 10 + 2, 3);
            assert_eq!(hits.len(), 1, "Expected 1 hit for range {i}");
            assert_eq!(hits[0].start_row(), i * 10);
        }

        assert!(tree.query(7, 3).is_empty());
        assert!(tree.query(9998, 3).is_empty());
    }

    #[test]
    fn stress_test_overlapping_ranges() {
        let ranges: Vec<RangePos> = (0..1000).map(|i| range(0, 0, i, 10)).collect();
        let tree = RangeIntervalTree::build(&ranges);
        assert_eq!(tree.len(), 1000);

        let hits = tree.query(0, 5);
        assert_eq!(hits.len(), 1000);

        let hits = tree.query(500, 5);
        assert_eq!(hits.len(), 500);

        let hits = tree.query(999, 5);
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn duplicate_ranges() {
        let r = range(3, 3, 7, 7);
        let ranges = vec![r, r, r];
        let tree = RangeIntervalTree::build(&ranges);
        assert_eq!(tree.len(), 3);

        let hits = tree.query(5, 5);
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn build_preserves_all_ranges() {
        let ranges = vec![
            range(10, 0, 20, 5),
            range(1, 0, 15, 5),
            range(15, 2, 25, 8),
            range(0, 0, 100, 100),
        ];
        let tree = RangeIntervalTree::build(&ranges);
        assert_eq!(tree.len(), 4);

        let hits = tree.query(15, 3);
        assert_eq!(hits.len(), 4);
    }

    #[test]
    fn max_end_row_pruning_works() {
        let ranges: Vec<RangePos> = (0..100).map(|i| range(i, 0, i + 1, 5)).collect();
        let tree = RangeIntervalTree::build(&ranges);

        assert!(tree.query(200, 3).is_empty());

        let hits = tree.query(50, 3);
        assert_eq!(hits.len(), 2);
    }
}
