use domain_types::units::Pixels;

use super::AxisIndex;

impl AxisIndex {
    fn delta_prefixes(&self) -> &[(usize, f64)] {
        self.prefixes.get_or_init(|| {
            let mut deltas = self.custom.clone();
            for &index in &self.hidden {
                deltas.insert(index, 0.0);
            }
            let mut total = 0.0;
            deltas
                .into_iter()
                .filter_map(|(index, size)| {
                    let delta = size - self.default_size.0;
                    if delta == 0.0 {
                        return None;
                    }
                    total += delta;
                    Some((index, total))
                })
                .collect()
        })
    }

    /// Top/left edge, extrapolating default dimensions beyond the axis extent.
    pub fn get_position(&self, index: usize) -> Pixels {
        let prefixes = self.delta_prefixes();
        let end = prefixes.partition_point(|&(position, _)| position < index);
        let delta = end.checked_sub(1).map_or(0.0, |last| prefixes[last].1);
        Pixels(index as f64 * self.default_size.0 + delta)
    }

    /// Find the containing visible entry, clamped to the axis extent.
    /// Zero-sized entries are skipped at their shared pixel boundary.
    pub fn get_index_at(&self, px: Pixels) -> usize {
        if self.count == 0 || px.0 < 0.0 {
            return 0;
        }
        let (mut low, mut high) = (0, self.count);
        while low < high {
            let middle = low + (high - low) / 2;
            if self.get_position(middle + 1).0 <= px.0 {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        low.min(self.count - 1)
    }
}
