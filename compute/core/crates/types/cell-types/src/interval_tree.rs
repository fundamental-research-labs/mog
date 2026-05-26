//! Generic augmented interval tree for efficient 2D rectangle containment/overlap queries.
//!
//! Provides [`IntervalTree<R>`] for answering "which rectangles contain point (row, col)?"
//! in O(log R + K) time, where R is the number of rectangles and K is the number of matches.
//!
//! The tree is built from a sorted array of rectangles using a balanced binary tree stored
//! in a flat [`Vec`] with explicit child indices. Each node is augmented with `max_end_row` —
//! the maximum `end_row` across the entire subtree — enabling efficient pruning.

use crate::position::{RangePos, SheetRange};

/// A 2D rectangle with inclusive row/column bounds.
///
/// Implement this trait for any type that represents a rectangular region
/// on a grid. The interval tree uses these accessors for containment and
/// overlap queries.
pub trait RectLike: Copy {
    /// Inclusive start row of the rectangle.
    fn start_row(&self) -> u32;
    /// Inclusive end row of the rectangle.
    fn end_row(&self) -> u32;
    /// Inclusive start column of the rectangle.
    fn start_col(&self) -> u32;
    /// Inclusive end column of the rectangle.
    fn end_col(&self) -> u32;

    /// Check if the point (row, col) is inside this rectangle (inclusive bounds).
    fn contains_point(&self, row: u32, col: u32) -> bool {
        row >= self.start_row()
            && row <= self.end_row()
            && col >= self.start_col()
            && col <= self.end_col()
    }
}

impl RectLike for RangePos {
    #[inline]
    fn start_row(&self) -> u32 {
        RangePos::start_row(self)
    }
    #[inline]
    fn end_row(&self) -> u32 {
        RangePos::end_row(self)
    }
    #[inline]
    fn start_col(&self) -> u32 {
        RangePos::start_col(self)
    }
    #[inline]
    fn end_col(&self) -> u32 {
        RangePos::end_col(self)
    }
}

impl RectLike for SheetRange {
    #[inline]
    fn start_row(&self) -> u32 {
        SheetRange::start_row(self)
    }
    #[inline]
    fn end_row(&self) -> u32 {
        SheetRange::end_row(self)
    }
    #[inline]
    fn start_col(&self) -> u32 {
        SheetRange::start_col(self)
    }
    #[inline]
    fn end_col(&self) -> u32 {
        SheetRange::end_col(self)
    }
}

/// Augmented interval tree for efficient 2D rectangle queries.
///
/// Answers "which rectangles contain point (row, col)?" in O(log R + K) time,
/// where R is the number of rectangles and K is the number of matches.
///
/// Built from a sorted array of rectangles using a balanced binary tree layout
/// stored in a flat [`Vec`] with explicit child indices. Each node is augmented
/// with `max_end_row` = max(`end_row`) of its subtree, enabling efficient
/// pruning during queries.
#[derive(Debug, Clone)]
pub struct IntervalTree<R: RectLike> {
    nodes: Vec<IntervalNode<R>>,
    root: Option<usize>,
}

#[derive(Debug, Clone)]
struct IntervalNode<R: RectLike> {
    rect: R,
    max_end_row: u32,
    left: Option<usize>,
    right: Option<usize>,
}

impl<R: RectLike> IntervalTree<R> {
    /// Create an empty tree.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            nodes: Vec::new(),
            root: None,
        }
    }

    /// Build a balanced interval tree from a set of rectangles.
    ///
    /// Sorts by `(start_row, start_col)` and iteratively picks the middle
    /// element to produce a balanced BST. Computes `max_end_row` bottom-up.
    ///
    /// **Cost:** O(R log R) where R = number of rectangles.
    #[must_use]
    pub fn build(rects: &[R]) -> Self {
        if rects.is_empty() {
            return Self::new();
        }

        let mut sorted: Vec<R> = rects.to_vec();
        sorted.sort_unstable_by(|a, b| {
            a.start_row()
                .cmp(&b.start_row())
                .then(a.start_col().cmp(&b.start_col()))
        });

        let mut nodes = Vec::with_capacity(sorted.len());
        let root = Self::build_balanced_iterative(&sorted, &mut nodes);

        Self { nodes, root }
    }

    /// Iteratively build a balanced BST from a sorted slice.
    fn build_balanced_iterative(sorted: &[R], nodes: &mut Vec<IntervalNode<R>>) -> Option<usize> {
        if sorted.is_empty() {
            return None;
        }

        let mut stack: Vec<(usize, usize, usize, bool)> = Vec::new();
        stack.push((0, sorted.len(), usize::MAX, false));

        let mut root_idx = None;

        while let Some((start, end, parent, is_left)) = stack.pop() {
            if start >= end {
                continue;
            }

            let mid = start + (end - start) / 2;
            let idx = nodes.len();

            nodes.push(IntervalNode {
                rect: sorted[mid],
                max_end_row: sorted[mid].end_row(),
                left: None,
                right: None,
            });

            if parent == usize::MAX {
                root_idx = Some(idx);
            } else if is_left {
                nodes[parent].left = Some(idx);
            } else {
                nodes[parent].right = Some(idx);
            }

            if mid + 1 < end {
                stack.push((mid + 1, end, idx, false));
            }
            if start < mid {
                stack.push((start, mid, idx, true));
            }
        }

        // Bottom-up pass: fix max_end_row.
        for i in (0..nodes.len()).rev() {
            let mut max_end = nodes[i].rect.end_row();
            if let Some(l) = nodes[i].left {
                max_end = max_end.max(nodes[l].max_end_row);
            }
            if let Some(r) = nodes[i].right {
                max_end = max_end.max(nodes[r].max_end_row);
            }
            nodes[i].max_end_row = max_end;
        }

        root_idx
    }

    /// Find all rectangles containing the point (row, col).
    ///
    /// Uses augmented interval tree pruning:
    /// - If the subtree's `max_end_row < row`, skip the entire subtree.
    /// - If the node's `start_row > row`, only check the left subtree.
    ///
    /// **Cost:** O(log R + K) where R = number of rectangles, K = number of matches.
    #[must_use]
    pub fn query(&self, row: u32, col: u32) -> Vec<&R> {
        let mut results = Vec::new();
        let Some(root) = self.root else {
            return results;
        };

        let mut stack = vec![root];

        while let Some(idx) = stack.pop() {
            let node = &self.nodes[idx];

            if node.max_end_row < row {
                continue;
            }

            if node.rect.start_row() > row {
                if let Some(left) = node.left {
                    stack.push(left);
                }
                continue;
            }

            if node.rect.contains_point(row, col) {
                results.push(&node.rect);
            }

            if let Some(right) = node.right {
                stack.push(right);
            }
            if let Some(left) = node.left {
                stack.push(left);
            }
        }

        results
    }

    /// Find all rectangles that overlap the query rectangle
    /// `[query_start_row..=query_end_row, query_start_col..=query_end_col]`.
    ///
    /// **Cost:** O(log R + K) where R = number of rectangles, K = number of matches.
    #[must_use]
    pub fn query_range(
        &self,
        query_start_row: u32,
        query_start_col: u32,
        query_end_row: u32,
        query_end_col: u32,
    ) -> Vec<&R> {
        let mut results = Vec::new();
        let Some(root) = self.root else {
            return results;
        };

        let mut stack = vec![root];

        while let Some(idx) = stack.pop() {
            let node = &self.nodes[idx];

            if node.max_end_row < query_start_row {
                continue;
            }

            if node.rect.start_row() > query_end_row {
                if let Some(left) = node.left {
                    stack.push(left);
                }
                continue;
            }

            if node.rect.end_row() >= query_start_row
                && node.rect.start_col() <= query_end_col
                && node.rect.end_col() >= query_start_col
            {
                results.push(&node.rect);
            }

            if let Some(right) = node.right {
                stack.push(right);
            }
            if let Some(left) = node.left {
                stack.push(left);
            }
        }

        results
    }

    /// Returns `true` if the tree contains no rectangles.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Returns the number of rectangles in the tree.
    #[must_use]
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Returns an iterator over references to all rectangles in the tree.
    pub fn iter(&self) -> impl Iterator<Item = &R> {
        self.nodes.iter().map(|n| &n.rect)
    }

    /// Insert a rectangle and rebuild the tree.
    ///
    /// Collects all existing rectangles plus the new one and rebuilds from
    /// scratch. O(R log R) where R is the new total count. Acceptable for
    /// infrequent mutations (Range create/replace during hydration).
    pub fn insert(&mut self, rect: R) {
        let mut all: Vec<R> = self.nodes.iter().map(|n| n.rect).collect();
        all.push(rect);
        *self = Self::build(&all);
    }

    /// Remove all rectangles matching a predicate and rebuild the tree.
    pub fn remove<F: Fn(&R) -> bool>(&mut self, predicate: F) {
        let remaining: Vec<R> = self
            .nodes
            .iter()
            .map(|n| n.rect)
            .filter(|r| !predicate(r))
            .collect();
        *self = Self::build(&remaining);
    }
}

impl<R: RectLike> Default for IntervalTree<R> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::SheetId;

    fn range(sr: u32, sc: u32, er: u32, ec: u32) -> RangePos {
        RangePos::new(SheetId::from_raw(1), sr, sc, er, ec)
    }

    #[test]
    fn empty_tree() {
        let tree = IntervalTree::<RangePos>::new();
        assert!(tree.is_empty());
        assert_eq!(tree.len(), 0);
        assert!(tree.query(0, 0).is_empty());
    }

    #[test]
    fn build_empty() {
        let tree = IntervalTree::build(&[] as &[RangePos]);
        assert!(tree.is_empty());
    }

    #[test]
    fn single_range_hit() {
        let r = range(2, 3, 8, 6);
        let tree = IntervalTree::build(&[r]);
        assert_eq!(tree.len(), 1);
        let hits = tree.query(5, 4);
        assert_eq!(hits.len(), 1);
        assert_eq!(*hits[0], r);
    }

    #[test]
    fn single_range_miss() {
        let r = range(2, 3, 8, 6);
        let tree = IntervalTree::build(&[r]);
        assert!(tree.query(1, 4).is_empty());
        assert!(tree.query(9, 4).is_empty());
        assert!(tree.query(5, 2).is_empty());
        assert!(tree.query(5, 7).is_empty());
    }

    #[test]
    fn multiple_overlapping() {
        let ranges = vec![range(0, 0, 10, 10), range(3, 3, 7, 7), range(5, 0, 15, 5)];
        let tree = IntervalTree::build(&ranges);
        assert_eq!(tree.query(5, 4).len(), 3);
        assert_eq!(tree.query(1, 1).len(), 1);
        assert!(tree.query(12, 8).is_empty());
    }

    #[test]
    fn query_range_overlap() {
        let ranges = vec![range(0, 0, 10, 10), range(20, 0, 30, 10)];
        let tree = IntervalTree::build(&ranges);
        let hits = tree.query_range(5, 5, 25, 5);
        assert_eq!(hits.len(), 2);
        let hits = tree.query_range(15, 0, 18, 10);
        assert!(hits.is_empty());
    }

    #[test]
    fn sheet_range_works() {
        let sr = SheetRange::new(0, 0, 10, 10);
        let tree = IntervalTree::build(&[sr]);
        assert_eq!(tree.query(5, 5).len(), 1);
        assert!(tree.query(11, 5).is_empty());
    }

    #[test]
    fn default_is_empty() {
        let tree = IntervalTree::<RangePos>::default();
        assert!(tree.is_empty());
    }

    #[test]
    fn iter_all_rects() {
        let ranges = vec![range(0, 0, 5, 5), range(10, 0, 15, 5), range(20, 0, 25, 5)];
        let tree = IntervalTree::build(&ranges);
        let mut collected: Vec<RangePos> = tree.iter().copied().collect();
        collected.sort_by_key(RangePos::start_row);
        assert_eq!(collected.len(), 3);
        assert_eq!(collected[0].start_row(), 0);
        assert_eq!(collected[1].start_row(), 10);
        assert_eq!(collected[2].start_row(), 20);
    }

    #[test]
    fn stress_1000_non_overlapping() {
        let ranges: Vec<RangePos> = (0..1000).map(|i| range(i * 10, 0, i * 10 + 5, 5)).collect();
        let tree = IntervalTree::build(&ranges);
        assert_eq!(tree.len(), 1000);
        for i in 0..1000u32 {
            let hits = tree.query(i * 10 + 2, 3);
            assert_eq!(hits.len(), 1);
        }
        assert!(tree.query(7, 3).is_empty());
    }
}
