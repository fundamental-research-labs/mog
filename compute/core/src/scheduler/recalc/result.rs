use std::collections::HashMap;

use super::*;

impl ComputeCore {
    /// Find which sheet a cell belongs to (O(1) via reverse index).
    pub(in super::super) fn find_sheet_for_cell(
        &self,
        mirror: &CellMirror,
        cell_id: &CellId,
    ) -> Option<SheetId> {
        mirror.sheet_for_cell(cell_id)
    }

    /// Create a CellChange for IPC serialization.
    pub(in super::super) fn make_cell_change(
        &self,
        mirror: &CellMirror,
        cell_id: &CellId,
        value: &CellValue,
    ) -> Option<(SheetId, CellChange)> {
        let sheet_id = self.find_sheet_for_cell(mirror, cell_id)?;
        // Resolve position from mirror; `None` when unavailable.
        let position = mirror
            .resolve_position(cell_id)
            .map(|pos| snapshot_types::CellPosition {
                row: pos.row(),
                col: pos.col(),
            });
        Some((
            sheet_id,
            CellChange {
                cell_id: cell_id.to_uuid_string(),
                sheet_id: sheet_id.to_uuid_string(),
                position,
                value: value.clone(),
                display_text: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ))
    }

    /// Initialize recalc metrics with dependency graph stats.
    pub(super) fn init_recalc_metrics(&self) -> RecalcMetrics {
        let mut metrics = RecalcMetrics::default();
        let stats = self.graph.dep_edge_stats();
        metrics.total_dep_edges = stats.total_edges;
        metrics.max_deps_per_cell = stats.max_deps_per_cell;
        metrics
    }

    /// Track HashMap capacity grows and insert counts (Task 1.5f).
    pub(super) fn track_capacity_metrics(
        &self,
        metrics: &mut RecalcMetrics,
        ast_cap_before: usize,
    ) {
        let ast_cap_after = self.ast_cache.capacity();
        if ast_cap_after > ast_cap_before {
            let mut cap = ast_cap_before.max(1);
            while cap < ast_cap_after {
                metrics.hashmap_capacity_grows += 1;
                cap *= 2;
            }
        }
        metrics.hashmap_inserts = self.ast_cache.len() as u64;
    }

    /// Surface existing CacheCounters from WorkbookCache into metrics (Task 1.5d).
    #[allow(unused_variables)]
    pub(super) fn collect_cache_metrics(&self, metrics: &mut RecalcMetrics) {
        #[cfg(feature = "native")]
        {
            let cache_snap = self.workbook_cache.stats_snapshot();
            metrics.cache_hits = cache_snap.sorted.hits
                + cache_snap.frequency_count.hits
                + cache_snap.frequency_sum.hits
                + cache_snap.bitmask.hits
                + cache_snap.lookup.hits;
            metrics.cache_misses = cache_snap.sorted.misses
                + cache_snap.frequency_count.misses
                + cache_snap.frequency_sum.misses
                + cache_snap.bitmask.misses
                + cache_snap.lookup.misses;
            metrics.cache_rebuilds = cache_snap.sorted.rebuilds
                + cache_snap.frequency_count.rebuilds
                + cache_snap.frequency_sum.rebuilds
                + cache_snap.bitmask.rebuilds
                + cache_snap.lookup.rebuilds;
            metrics.cache_evictions = cache_snap.sorted.evictions
                + cache_snap.frequency_count.evictions
                + cache_snap.frequency_sum.evictions
                + cache_snap.bitmask.evictions
                + cache_snap.lookup.evictions;
        }
    }

    /// Build the final RecalcResult from accumulated changes and metrics.
    pub(super) fn build_recalc_result(
        changed_cells: Vec<CellChange>,
        projection_changes: Vec<ProjectionChange>,
        errors: Vec<CellErrorInfo>,
        metrics: RecalcMetrics,
    ) -> RecalcResult {
        RecalcResult {
            changed_cells,
            projection_changes,
            errors,
            validation_annotations: Vec::new(),
            policy_preserved_parse_outcomes: Vec::new(),
            policy_preserved_parse_summary: None,
            metrics,
            old_values: HashMap::new(),
        }
    }
}
