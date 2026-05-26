//! Spatial index for range dependencies — enables efficient point-in-range queries.

use rustc_hash::{FxBuildHasher, FxHashMap};

use cell_types::{RangePos, SheetId};

use super::DependencyGraph;
use super::interval_tree::RangeIntervalTree;

impl DependencyGraph {
    /// Add a range to the spatial index.
    ///
    /// Updates the per-sheet side index and rebuilds the interval tree.
    ///
    /// **Cost:** O(R log R) where R = number of ranges on this sheet.
    pub(crate) fn add_to_range_index(&mut self, rect: &RangePos) {
        self.sheet_ranges
            .entry(rect.sheet())
            .or_default()
            .push(*rect);
        self.rebuild_range_index_for_sheet(rect.sheet());
    }

    /// Remove a range from the spatial index.
    ///
    /// Updates the per-sheet side index and rebuilds the interval tree, or
    /// removes it if empty.
    ///
    /// **Cost:** O(R log R) where R = number of ranges on this sheet.
    pub(crate) fn remove_from_range_index(&mut self, rect: &RangePos) {
        if let Some(vec) = self.sheet_ranges.get_mut(&rect.sheet()) {
            if let Some(pos) = vec.iter().position(|r| r == rect) {
                vec.swap_remove(pos);
            }
            if vec.is_empty() {
                self.sheet_ranges.remove(&rect.sheet());
            }
        }
        self.rebuild_range_index_for_sheet(rect.sheet());
    }

    /// Rebuild the spatial index for a single sheet using the `sheet_ranges`
    /// side index (avoids scanning all `range_deps` keys).
    ///
    /// **Cost:** O(R log R) where R = number of ranges on this sheet.
    fn rebuild_range_index_for_sheet(&mut self, sheet: SheetId) {
        match self.sheet_ranges.get(&sheet) {
            Some(rects) if !rects.is_empty() => {
                self.range_index
                    .insert(sheet, RangeIntervalTree::build(rects));
            }
            _ => {
                self.range_index.remove(&sheet);
            }
        }
    }

    /// Rebuild the spatial index from scratch (e.g., after bulk operations).
    ///
    /// **Cost:** O(S × R log R) where S = number of sheets, R = average ranges per sheet.
    pub(crate) fn rebuild_range_index(&mut self) {
        self.range_index.clear();
        self.sheets_with_range_deps.clear();
        self.range_count_per_sheet.clear();
        self.sheet_ranges.clear();
        // Pre-size by_sheet: number of unique sheets is bounded by range_deps entries.
        // Most workbooks have < 50 sheets, but using range_deps.len() / 4 as a
        // conservative estimate avoids rehashing for larger workbooks.
        let sheet_estimate = (self.range_deps.len() / 4).max(4);
        let mut by_sheet: FxHashMap<SheetId, Vec<RangePos>> =
            FxHashMap::with_capacity_and_hasher(sheet_estimate, FxBuildHasher);
        for rect in self.range_deps.keys() {
            by_sheet.entry(rect.sheet()).or_default().push(*rect);
        }
        for (sheet, rects) in by_sheet {
            self.range_count_per_sheet.insert(sheet, rects.len());
            self.sheets_with_range_deps.insert(sheet);
            self.range_index
                .insert(sheet, RangeIntervalTree::build(&rects));
            self.sheet_ranges.insert(sheet, rects);
        }
    }
}
