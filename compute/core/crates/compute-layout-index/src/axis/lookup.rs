use domain_types::units::Pixels;

use super::AxisIndex;

impl AxisIndex {
    /// Pixel position of the top/left edge of entry `i`.
    ///
    /// `position(i) = i * default_size + sum(delta[0..i])`
    /// where delta[j] = effective_size[j] - default_size.
    ///
    /// For i=0, position is 0. For i>0, we sum deltas for 0..i-1.
    pub fn get_position(&self, i: usize) -> Pixels {
        if i == 0 {
            return Pixels(0.0);
        }
        if self.count == 0 {
            return self.default_size * i as f64;
        }
        if i > self.count {
            // Extrapolate: position at count + defaults beyond
            let pos_at_count = self.get_position_internal(self.count);
            return Pixels(pos_at_count + (i - self.count) as f64 * self.default_size.0);
        }
        Pixels(self.get_position_internal(i))
    }

    /// Internal position calculation for i in 1..=count.
    fn get_position_internal(&self, i: usize) -> f64 {
        debug_assert!(i >= 1 && i <= self.count);
        // position(i) = i * default + prefix_sum(0..i-1)
        i as f64 * self.default_size.0 + self.fenwick.prefix_sum(i - 1)
    }

    /// Find the index at a given pixel position (inverse of `get_position`).
    ///
    /// Returns the index `i` such that `get_position(i) <= px < get_position(i+1)`,
    /// i.e., the entry that contains pixel position `px`.
    ///
    /// Uses Fenwick descent on the adjusted position:
    ///   `total_position(i) = i * default + delta_prefix(i)`
    /// We search for i such that this <= px.
    pub fn get_index_at(&self, px: Pixels) -> usize {
        if self.count == 0 || px.0 < 0.0 {
            return 0;
        }

        // Binary search approach: we need to find the largest i where
        //   i * default_size + fenwick.prefix_sum(i - 1) <= px
        //
        // This is equivalent to finding i where the cumulative position <= px.
        // We use a manual Fenwick descent that accounts for the linear term.
        let mut pos: usize = 0; // 1-based position in Fenwick tree
        let mut remaining = px.0;
        let n = self.count;

        // Find highest power of 2 <= n
        if n == 0 {
            return 0;
        }
        let mut bit = 1usize << (usize::BITS - 1 - n.leading_zeros());

        while bit > 0 {
            let next = pos + bit;
            if next <= n {
                // The interval [pos+1..next] has `bit` entries, contributing:
                //   bit * default_size (linear part) + fenwick.tree[next] (delta part)
                let interval_cost = bit as f64 * self.default_size.0 + self.fenwick_tree_val(next);
                if interval_cost <= remaining {
                    pos = next;
                    remaining -= interval_cost;
                }
            }
            bit >>= 1;
        }

        // pos is now 1-based: it represents the number of complete entries
        // that fit before `px`. The entry *containing* px is at index `pos`.
        // But we need to handle the case where pos == 0 (px is in the first entry).
        pos.min(self.count - 1)
    }

    /// Direct access to the Fenwick tree's internal array (1-based).
    /// Used by `get_index_at` for the descent algorithm.
    fn fenwick_tree_val(&self, pos_1based: usize) -> f64 {
        // Access the tree value at the given 1-based position.
        // This is the sum of deltas in the interval ending at this position.
        // We need access to the raw tree array for the descent.
        self.fenwick.raw_tree_val(pos_1based)
    }
}
