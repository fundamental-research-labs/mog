use domain_types::units::Pixels;

use super::AxisIndex;

impl AxisIndex {
    /// Build from sparse custom dimensions and hidden set.
    pub fn from_sparse(
        count: usize,
        default_size: Pixels,
        custom_dims: impl IntoIterator<Item = (usize, Pixels)>,
        hidden_indices: impl IntoIterator<Item = usize>,
    ) -> Self {
        let mut axis = Self::new(count, default_size);

        // Apply custom dimensions first
        for (idx, size) in custom_dims {
            if idx < count {
                axis.custom.insert(idx, size.0);
                let delta = size.0 - default_size.0;
                if delta != 0.0 {
                    axis.fenwick.update(idx, delta);
                }
            }
        }

        // Apply hidden state (overrides custom dimensions for effective size)
        for idx in hidden_indices {
            if idx < count {
                // If already custom, the delta was (custom - default).
                // We need the delta to be (0 - default) = -default.
                // So adjust by -(custom_or_default).
                let current_effective = if let Some(&custom) = axis.custom.get(&idx) {
                    custom
                } else {
                    default_size.0
                };
                // Current delta = current_effective - default.
                // We want delta = 0 - default = -default.
                // Adjustment = -default - (current_effective - default) = -current_effective.
                axis.fenwick.update(idx, -current_effective);
                axis.hidden.insert(idx);
            }
        }

        axis
    }

    /// Get the effective dimension of entry `i`.
    /// Returns 0 for hidden entries, custom size if set, default otherwise.
    pub fn get_dimension(&self, i: usize) -> Pixels {
        if i >= self.count {
            return self.default_size;
        }
        if self.hidden.contains(&i) {
            return Pixels(0.0);
        }
        Pixels(self.custom.get(&i).copied().unwrap_or(self.default_size.0))
    }

    /// Set the dimension of entry `i` to `size`.
    /// Pass `default_size` to reset to default (removes the custom entry).
    pub fn set_dimension(&mut self, i: usize, size: Pixels) {
        if i >= self.count {
            return;
        }
        let old_effective = self.effective_size(i);
        let is_hidden = self.hidden.contains(&i);

        // Update custom map
        if (size.0 - self.default_size.0).abs() < f64::EPSILON {
            self.custom.remove(&i);
        } else {
            self.custom.insert(i, size.0);
        }

        // New effective size: 0 if hidden, else the new size
        let new_effective = if is_hidden { 0.0 } else { size.0 };
        let delta_change = new_effective - old_effective;
        if delta_change.abs() > f64::EPSILON {
            self.fenwick.update(i, delta_change);
        }
    }

    /// Hide entry `i` (effective size becomes 0).
    pub fn hide(&mut self, i: usize) {
        if i >= self.count || self.hidden.contains(&i) {
            return;
        }
        let old_effective = self.effective_size(i);
        self.hidden.insert(i);
        // New effective = 0, so delta change = -old_effective
        // But we track delta = effective - default, so:
        // old_delta = old_effective - default
        // new_delta = 0 - default = -default
        // change = new_delta - old_delta = -old_effective
        if old_effective.abs() > f64::EPSILON {
            self.fenwick.update(i, -old_effective);
        }
    }

    /// Unhide entry `i` (effective size reverts to custom or default).
    pub fn unhide(&mut self, i: usize) {
        if i >= self.count || !self.hidden.contains(&i) {
            return;
        }
        self.hidden.remove(&i);
        let new_effective = self.custom.get(&i).copied().unwrap_or(self.default_size.0);
        // old effective was 0 (hidden), change = new_effective
        // delta was -default, now delta = new_effective - default
        // change = new_effective
        if new_effective.abs() > f64::EPSILON {
            self.fenwick.update(i, new_effective);
        }
    }

    /// Whether entry `i` is hidden.
    pub fn is_hidden(&self, i: usize) -> bool {
        self.hidden.contains(&i)
    }

    /// The effective size of entry i (accounting for hidden state).
    pub(super) fn effective_size(&self, i: usize) -> f64 {
        if self.hidden.contains(&i) {
            0.0
        } else {
            self.custom.get(&i).copied().unwrap_or(self.default_size.0)
        }
    }
}
