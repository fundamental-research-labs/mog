use domain_types::units::Pixels;

use super::AxisIndex;

impl AxisIndex {
    pub fn from_sparse(
        count: usize,
        default_size: Pixels,
        custom_dims: impl IntoIterator<Item = (usize, Pixels)>,
        hidden_indices: impl IntoIterator<Item = usize>,
    ) -> Self {
        let mut axis = Self::new(count, default_size);
        for (index, size) in custom_dims {
            axis.set_dimension(index, size);
        }
        for index in hidden_indices {
            axis.hide(index);
        }
        axis
    }

    /// Effective size: zero when hidden, otherwise the custom or default size.
    pub fn get_dimension(&self, index: usize) -> Pixels {
        if index >= self.count {
            self.default_size
        } else if self.hidden.contains(&index) {
            Pixels(0.0)
        } else {
            Pixels(
                self.custom
                    .get(&index)
                    .copied()
                    .unwrap_or(self.default_size.0),
            )
        }
    }

    pub fn set_dimension(&mut self, index: usize, size: Pixels) {
        if index >= self.count {
            return;
        }
        if (size.0 - self.default_size.0).abs() < f64::EPSILON {
            self.custom.remove(&index);
        } else {
            self.custom.insert(index, size.0);
        }
        self.prefixes.take();
    }

    pub fn hide(&mut self, index: usize) {
        if index < self.count && self.hidden.insert(index) {
            self.prefixes.take();
        }
    }

    pub fn unhide(&mut self, index: usize) {
        if self.hidden.remove(&index) {
            self.prefixes.take();
        }
    }

    pub fn is_hidden(&self, index: usize) -> bool {
        self.hidden.contains(&index)
    }
}
