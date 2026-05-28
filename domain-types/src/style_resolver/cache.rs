use std::collections::HashMap;

use crate::DocumentFormat;

use super::{input::StyleInput, xf::resolve_single_xf};

/// Memoization cache for resolved formats by style index.
pub struct FormatCache {
    cache: HashMap<u32, Option<DocumentFormat>>,
}

impl FormatCache {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
        }
    }

    /// Get or compute the resolved format for a style index.
    pub fn get(&mut self, style_idx: u32, input: &StyleInput) -> Option<&DocumentFormat> {
        self.cache
            .entry(style_idx)
            .or_insert_with(|| {
                input
                    .cell_xfs
                    .get(style_idx as usize)
                    .and_then(|xf| resolve_single_xf(xf, input))
            })
            .as_ref()
    }
}

impl Default for FormatCache {
    fn default() -> Self {
        Self::new()
    }
}
