//! Fenwick tree (Binary Indexed Tree) over `f64` deltas.
//!
//! Supports:
//! - `prefix_sum(i)` — cumulative delta sum for indices 0..=i, O(log n)
//! - `update(i, delta)` — add `delta` to position `i`, O(log n)
//! - `find_index(target)` — Fenwick descent to find the largest index whose
//!   prefix sum ≤ target, O(log n). Used for inverse pixel→row queries.
//!
//! The tree is 1-indexed internally; public API is 0-indexed.

/// A Fenwick tree storing `f64` prefix sums.
///
/// Capacity is fixed at construction. Indices are 0-based externally,
/// 1-based internally (standard BIT convention).
#[derive(Debug, Clone)]
pub struct FenwickTree {
    tree: Vec<f64>,
    n: usize,
}

impl FenwickTree {
    /// Create a Fenwick tree with `n` elements, all zero.
    pub fn new(n: usize) -> Self {
        Self {
            tree: vec![0.0; n + 1], // 1-indexed
            n,
        }
    }

    /// Number of elements.
    pub fn len(&self) -> usize {
        self.n
    }

    /// Whether the tree is empty.
    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// Add `delta` to element at index `i` (0-based).
    ///
    /// # Panics
    /// Panics if `i >= n`.
    pub fn update(&mut self, i: usize, delta: f64) {
        assert!(i < self.n, "index {i} out of bounds (n={})", self.n);
        let mut pos = i + 1; // convert to 1-based
        while pos <= self.n {
            self.tree[pos] += delta;
            pos += pos & pos.wrapping_neg(); // pos += lowbit(pos)
        }
    }

    /// Sum of elements at indices 0..=i (inclusive), O(log n).
    ///
    /// # Panics
    /// Panics if `i >= n`.
    pub fn prefix_sum(&self, i: usize) -> f64 {
        assert!(i < self.n, "index {i} out of bounds (n={})", self.n);
        let mut sum = 0.0;
        let mut pos = i + 1; // 1-based
        while pos > 0 {
            sum += self.tree[pos];
            pos -= pos & pos.wrapping_neg(); // pos -= lowbit(pos)
        }
        sum
    }

    /// Direct access to the internal tree array at a 1-based position.
    /// Used by `AxisIndex::get_index_at` for the Fenwick descent algorithm.
    pub(crate) fn raw_tree_val(&self, pos_1based: usize) -> f64 {
        self.tree[pos_1based]
    }

    /// Find the largest index `i` such that `prefix_sum(i) <= target`.
    ///
    /// Returns `None` if even the first element exceeds `target`
    /// (i.e., the delta at index 0 alone is > target).
    ///
    /// This uses the Fenwick descent algorithm — O(log n), no binary search needed.
    ///
    /// **Important**: This assumes all individual deltas are ≥ 0 (prefix sums are
    /// non-decreasing). For our use case, deltas can be negative (hidden rows have
    /// delta = -DEFAULT_HEIGHT), so callers must use the adjusted formula:
    ///   `adjusted_target = target - index * default_size`
    /// and search on the delta-only Fenwick tree. `AxisIndex` handles this correctly.
    #[allow(dead_code)]
    pub(crate) fn find_index(&self, target: f64) -> Option<usize> {
        if self.n == 0 {
            return None;
        }
        let mut pos: usize = 0;
        let mut remaining = target;
        // Find the highest power of 2 ≤ n
        let mut bit = 1usize << (usize::BITS - 1 - self.n.leading_zeros());
        while bit > 0 {
            let next = pos + bit;
            if next <= self.n && self.tree[next] <= remaining {
                pos = next;
                remaining -= self.tree[next];
            }
            bit >>= 1;
        }
        // pos is now 1-based result; convert to 0-based
        if pos == 0 {
            // Even the first element's prefix sum > target
            None
        } else {
            Some(pos - 1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_tree() {
        let t = FenwickTree::new(0);
        assert!(t.is_empty());
        assert_eq!(t.len(), 0);
    }

    #[test]
    fn single_element() {
        let mut t = FenwickTree::new(1);
        t.update(0, 5.0);
        assert_eq!(t.prefix_sum(0), 5.0);
        assert_eq!(t.find_index(5.0), Some(0));
        assert_eq!(t.find_index(4.9), None);
        assert_eq!(t.find_index(100.0), Some(0));
    }

    #[test]
    fn prefix_sums_accumulate() {
        let mut t = FenwickTree::new(5);
        // deltas: [10, 20, 30, 40, 50]
        t.update(0, 10.0);
        t.update(1, 20.0);
        t.update(2, 30.0);
        t.update(3, 40.0);
        t.update(4, 50.0);
        assert_eq!(t.prefix_sum(0), 10.0);
        assert_eq!(t.prefix_sum(1), 30.0);
        assert_eq!(t.prefix_sum(2), 60.0);
        assert_eq!(t.prefix_sum(3), 100.0);
        assert_eq!(t.prefix_sum(4), 150.0);
    }

    #[test]
    fn update_additive() {
        let mut t = FenwickTree::new(3);
        t.update(1, 10.0);
        t.update(1, 5.0);
        assert_eq!(t.prefix_sum(1), 15.0);
    }

    #[test]
    fn find_index_basic() {
        let mut t = FenwickTree::new(5);
        // deltas: [10, 10, 10, 10, 10]
        for i in 0..5 {
            t.update(i, 10.0);
        }
        // prefix sums: [10, 20, 30, 40, 50]
        assert_eq!(t.find_index(0.0), None); // nothing ≤ 0
        assert_eq!(t.find_index(9.9), None);
        assert_eq!(t.find_index(10.0), Some(0));
        assert_eq!(t.find_index(15.0), Some(0));
        assert_eq!(t.find_index(20.0), Some(1));
        assert_eq!(t.find_index(50.0), Some(4));
        assert_eq!(t.find_index(100.0), Some(4));
    }

    #[test]
    fn find_index_with_zeros() {
        let mut t = FenwickTree::new(5);
        // deltas: [0, 10, 0, 10, 0]
        t.update(1, 10.0);
        t.update(3, 10.0);
        // prefix sums: [0, 10, 10, 20, 20]
        assert_eq!(t.find_index(0.0), Some(0)); // 0 ≤ 0
        assert_eq!(t.find_index(9.9), Some(0));
        assert_eq!(t.find_index(10.0), Some(2)); // largest i with prefix ≤ 10
        assert_eq!(t.find_index(20.0), Some(4));
    }

    #[test]
    fn negative_deltas() {
        let mut t = FenwickTree::new(3);
        // deltas: [10, -5, 10]
        t.update(0, 10.0);
        t.update(1, -5.0);
        t.update(2, 10.0);
        // prefix sums: [10, 5, 15]
        assert_eq!(t.prefix_sum(0), 10.0);
        assert_eq!(t.prefix_sum(1), 5.0);
        assert_eq!(t.prefix_sum(2), 15.0);
        // Note: find_index is unreliable with negative deltas (non-monotonic)
        // AxisIndex handles this by adjusting for the linear component
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn update_out_of_bounds() {
        let mut t = FenwickTree::new(3);
        t.update(3, 1.0);
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn prefix_sum_out_of_bounds() {
        let t = FenwickTree::new(3);
        t.prefix_sum(3);
    }

    #[test]
    fn large_tree() {
        let n = 10_000;
        let mut t = FenwickTree::new(n);
        for i in 0..n {
            t.update(i, 1.0);
        }
        assert_eq!(t.prefix_sum(0), 1.0);
        assert_eq!(t.prefix_sum(999), 1000.0);
        assert_eq!(t.prefix_sum(n - 1), n as f64);
        assert_eq!(t.find_index(500.0), Some(499));
    }

    // ---- First-principles tests ----

    /// Helper: brute-force prefix sum from a plain array.
    fn brute_prefix_sum(arr: &[f64], i: usize) -> f64 {
        arr[..=i].iter().sum()
    }

    /// Simple deterministic PRNG (xorshift32) to avoid importing rand.
    struct SimpleRng(u32);
    impl SimpleRng {
        fn new(seed: u32) -> Self {
            Self(seed)
        }
        fn next_u32(&mut self) -> u32 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            self.0 = x;
            x
        }
        /// Returns a f64 in [0, max).
        fn next_f64(&mut self, max: f64) -> f64 {
            (self.next_u32() as f64 / u32::MAX as f64) * max
        }
    }

    // ---- 1. Prefix sum correctness against brute-force reference ----

    #[test]
    fn fp_prefix_sum_matches_brute_force() {
        let n = 64;
        let mut t = FenwickTree::new(n);
        let mut reference = vec![0.0; n];
        let deltas: Vec<f64> = (0..n).map(|i| (i as f64) * 1.7 + 0.3).collect();

        for (i, &d) in deltas.iter().enumerate() {
            t.update(i, d);
            reference[i] += d;
        }

        for i in 0..n {
            let expected = brute_prefix_sum(&reference, i);
            let actual = t.prefix_sum(i);
            assert!(
                (actual - expected).abs() < 1e-9,
                "prefix_sum({i}) mismatch: expected {expected}, got {actual}"
            );
        }
    }

    #[test]
    fn fp_prefix_sum_after_multiple_updates_to_same_index() {
        let n = 16;
        let mut t = FenwickTree::new(n);
        let mut reference = vec![0.0; n];

        // Apply multiple updates to various indices
        let updates: &[(usize, f64)] = &[
            (3, 10.0),
            (3, 5.0),
            (3, -2.0),
            (7, 100.0),
            (0, 1.0),
            (15, 50.0),
            (7, -30.0),
        ];
        for &(idx, delta) in updates {
            t.update(idx, delta);
            reference[idx] += delta;
        }

        for i in 0..n {
            let expected = brute_prefix_sum(&reference, i);
            let actual = t.prefix_sum(i);
            assert!(
                (actual - expected).abs() < 1e-9,
                "prefix_sum({i}) mismatch: expected {expected}, got {actual}"
            );
        }
    }

    // ---- 2. Update commutativity ----

    #[test]
    fn fp_update_order_does_not_matter() {
        let n = 32;
        let updates: Vec<(usize, f64)> = vec![
            (0, 5.0),
            (3, 10.0),
            (7, 2.5),
            (15, 100.0),
            (31, 7.7),
            (3, -3.0),
            (20, 42.0),
        ];

        // Forward order
        let mut t1 = FenwickTree::new(n);
        for &(i, d) in &updates {
            t1.update(i, d);
        }

        // Reverse order
        let mut t2 = FenwickTree::new(n);
        for &(i, d) in updates.iter().rev() {
            t2.update(i, d);
        }

        for i in 0..n {
            assert!(
                (t1.prefix_sum(i) - t2.prefix_sum(i)).abs() < 1e-9,
                "Commutativity violated at index {i}"
            );
        }
    }

    #[test]
    fn fp_update_splitting() {
        // update(i, a+b) == update(i, a) + update(i, b)
        let n = 10;
        let mut t_combined = FenwickTree::new(n);
        let mut t_split = FenwickTree::new(n);

        t_combined.update(5, 13.0);
        t_split.update(5, 7.0);
        t_split.update(5, 6.0);

        for i in 0..n {
            assert!(
                (t_combined.prefix_sum(i) - t_split.prefix_sum(i)).abs() < 1e-9,
                "Splitting violated at index {i}"
            );
        }
    }

    // ---- 3. Prefix sum telescoping (range sums) ----

    #[test]
    fn fp_prefix_sum_telescoping() {
        let n = 50;
        let mut t = FenwickTree::new(n);
        let mut reference = vec![0.0; n];

        // Fill with pseudo-random values
        let mut rng = SimpleRng::new(12345);
        for i in 0..n {
            let d = rng.next_f64(100.0);
            t.update(i, d);
            reference[i] = d;
        }

        // Check range sum [i..=j] == prefix_sum(j) - prefix_sum(i-1)
        let ranges: &[(usize, usize)] = &[
            (0, 0),
            (0, 49),
            (10, 20),
            (25, 25),
            (1, 48),
            (0, 1),
            (48, 49),
        ];
        for &(i, j) in ranges {
            let range_sum_brute: f64 = reference[i..=j].iter().sum();
            let range_sum_fenwick = if i == 0 {
                t.prefix_sum(j)
            } else {
                t.prefix_sum(j) - t.prefix_sum(i - 1)
            };
            assert!(
                (range_sum_fenwick - range_sum_brute).abs() < 1e-9,
                "Telescoping failed for range [{i}..={j}]: expected {range_sum_brute}, got {range_sum_fenwick}"
            );
        }
    }

    // ---- 4. find_index correctness properties (non-negative deltas) ----

    #[test]
    fn fp_find_index_properties() {
        let n = 100;
        let mut t = FenwickTree::new(n);
        let mut rng = SimpleRng::new(99999);

        // Only non-negative deltas so find_index invariants hold
        for i in 0..n {
            let d = rng.next_f64(10.0) + 0.1; // strictly positive
            t.update(i, d);
        }

        let total = t.prefix_sum(n - 1);

        // Test many target values
        let targets: Vec<f64> = (0..200)
            .map(|k| (k as f64 / 200.0) * (total + 10.0))
            .collect();

        for target in targets {
            let result = t.find_index(target);
            match result {
                Some(i) => {
                    // Property: prefix_sum(i) <= target
                    assert!(
                        t.prefix_sum(i) <= target + 1e-9,
                        "find_index({target}) = Some({i}) but prefix_sum({i}) = {} > target",
                        t.prefix_sum(i)
                    );
                    // Property: if i < n-1, prefix_sum(i+1) > target
                    if i < n - 1 {
                        assert!(
                            t.prefix_sum(i + 1) > target - 1e-9,
                            "find_index({target}) = Some({i}) but prefix_sum({}) = {} <= target",
                            i + 1,
                            t.prefix_sum(i + 1)
                        );
                    }
                }
                None => {
                    // Property: prefix_sum(0) > target
                    assert!(
                        t.prefix_sum(0) > target - 1e-9,
                        "find_index({target}) = None but prefix_sum(0) = {} <= target",
                        t.prefix_sum(0)
                    );
                }
            }
        }
    }

    #[test]
    fn fp_find_index_exact_boundaries() {
        let n = 10;
        let mut t = FenwickTree::new(n);
        // deltas: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
        for i in 0..n {
            t.update(i, 5.0);
        }
        // prefix sums: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]

        // At exact boundaries, find_index should return that index
        for i in 0..n {
            let ps = t.prefix_sum(i);
            let result = t.find_index(ps);
            assert_eq!(
                result,
                Some(i),
                "find_index at exact prefix_sum({i}) = {ps} should return Some({i}), got {result:?}"
            );
        }
    }

    // ---- 5. find_index edge cases ----

    #[test]
    fn fp_find_index_all_zeros() {
        let n = 20;
        let t = FenwickTree::new(n);
        // All prefix sums are 0. find_index(target) for target >= 0 should return Some(n-1)
        // because prefix_sum(n-1) = 0 <= target for any target >= 0
        assert_eq!(t.find_index(0.0), Some(n - 1));
        assert_eq!(t.find_index(100.0), Some(n - 1));
        assert_eq!(t.find_index(0.001), Some(n - 1));
    }

    #[test]
    fn fp_find_index_negative_target() {
        let mut t = FenwickTree::new(5);
        for i in 0..5 {
            t.update(i, 1.0);
        }
        // All prefix sums are positive, target < 0 => None
        assert_eq!(t.find_index(-1.0), None);
        assert_eq!(t.find_index(-0.001), None);
    }

    #[test]
    fn fp_find_index_large_target() {
        let n = 50;
        let mut t = FenwickTree::new(n);
        for i in 0..n {
            t.update(i, 3.0);
        }
        // total = 150, target = 1_000_000 >> total => should return Some(n-1)
        assert_eq!(t.find_index(1_000_000.0), Some(n - 1));
    }

    #[test]
    fn fp_find_index_empty_tree() {
        let t = FenwickTree::new(0);
        assert_eq!(t.find_index(0.0), None);
        assert_eq!(t.find_index(100.0), None);
    }

    // ---- 6. Boundary conditions ----

    #[test]
    fn fp_boundary_size_1() {
        let mut t = FenwickTree::new(1);
        assert_eq!(t.prefix_sum(0), 0.0);

        t.update(0, 42.0);
        assert_eq!(t.prefix_sum(0), 42.0);

        t.update(0, -10.0);
        assert_eq!(t.prefix_sum(0), 32.0);
    }

    #[test]
    fn fp_boundary_size_2() {
        let mut t = FenwickTree::new(2);
        t.update(0, 3.0);
        t.update(1, 7.0);
        assert_eq!(t.prefix_sum(0), 3.0);
        assert_eq!(t.prefix_sum(1), 10.0);

        // find_index
        assert_eq!(t.find_index(2.9), None);
        assert_eq!(t.find_index(3.0), Some(0));
        assert_eq!(t.find_index(9.9), Some(0));
        assert_eq!(t.find_index(10.0), Some(1));
        assert_eq!(t.find_index(100.0), Some(1));
    }

    #[test]
    fn fp_prefix_sum_0_equals_delta_at_0() {
        let n = 20;
        let mut t = FenwickTree::new(n);
        // Update many indices, but prefix_sum(0) should only reflect index 0
        t.update(5, 100.0);
        t.update(10, 200.0);
        t.update(0, 7.5);
        t.update(19, 999.0);
        assert!((t.prefix_sum(0) - 7.5).abs() < 1e-9);
    }

    #[test]
    fn fp_prefix_sum_last_equals_total() {
        let n = 30;
        let mut t = FenwickTree::new(n);
        let mut total = 0.0;
        let mut rng = SimpleRng::new(77777);
        for i in 0..n {
            let d = rng.next_f64(50.0) - 20.0; // can be negative
            t.update(i, d);
            total += d;
        }
        assert!(
            (t.prefix_sum(n - 1) - total).abs() < 1e-9,
            "prefix_sum(n-1) = {} should equal total = {}",
            t.prefix_sum(n - 1),
            total
        );
    }

    // ---- 7. Stress test: random updates, full verification ----

    #[test]
    fn fp_stress_random_updates() {
        let n = 200;
        let mut t = FenwickTree::new(n);
        let mut reference = vec![0.0; n];
        let mut rng = SimpleRng::new(314159);

        // Apply 500 random updates
        for _ in 0..500 {
            let idx = (rng.next_u32() as usize) % n;
            let delta = rng.next_f64(100.0) - 50.0; // range [-50, 50)
            t.update(idx, delta);
            reference[idx] += delta;
        }

        // Verify every prefix sum
        for i in 0..n {
            let expected = brute_prefix_sum(&reference, i);
            let actual = t.prefix_sum(i);
            assert!(
                (actual - expected).abs() < 1e-6,
                "Stress test: prefix_sum({i}) mismatch: expected {expected}, got {actual}"
            );
        }
    }

    #[test]
    fn fp_stress_nonneg_find_index_properties() {
        // Stress test find_index with non-negative deltas:
        // verify invariants hold for every possible integer target.
        let n = 128;
        let mut t = FenwickTree::new(n);
        let mut rng = SimpleRng::new(271828);

        for i in 0..n {
            t.update(i, rng.next_f64(5.0) + 0.01);
        }

        let total = t.prefix_sum(n - 1);
        // Check targets from -1 to total+1 in steps of ~0.5
        let mut target = -1.0;
        while target <= total + 1.0 {
            let result = t.find_index(target);
            match result {
                Some(i) => {
                    assert!(
                        t.prefix_sum(i) <= target + 1e-9,
                        "target={target}, i={i}, ps={}",
                        t.prefix_sum(i)
                    );
                    if i < n - 1 {
                        assert!(
                            t.prefix_sum(i + 1) > target - 1e-9,
                            "target={target}, i={i}, next_ps={}",
                            t.prefix_sum(i + 1)
                        );
                    }
                }
                None => {
                    if n > 0 {
                        assert!(
                            t.prefix_sum(0) > target - 1e-9,
                            "target={target}, ps0={}",
                            t.prefix_sum(0)
                        );
                    }
                }
            }
            target += 0.47;
        }
    }

    // ---- Power-of-two and non-power-of-two sizes ----

    #[test]
    fn fp_various_tree_sizes() {
        // Fenwick trees can have subtle bugs at power-of-two boundaries.
        // Test sizes around powers of two.
        for &n in &[
            1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129,
        ] {
            let mut t = FenwickTree::new(n);
            let mut reference = vec![0.0; n];
            for i in 0..n {
                let d = (i as f64) * 1.1 + 0.5;
                t.update(i, d);
                reference[i] = d;
            }
            for i in 0..n {
                let expected = brute_prefix_sum(&reference, i);
                let actual = t.prefix_sum(i);
                assert!(
                    (actual - expected).abs() < 1e-9,
                    "Size {n}, index {i}: expected {expected}, got {actual}"
                );
            }
        }
    }
}
