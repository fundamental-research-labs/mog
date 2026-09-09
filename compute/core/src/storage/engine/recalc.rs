use value_types::ComputeError;

use crate::scheduler::ComputeCore;

use super::{ComputeEngine, construction};

impl ComputeEngine {
    pub(super) fn metadata_requires_recalc(&self) -> bool {
        self.mirror
            .cell_metadata_provider
            .as_ref()
            .is_some_and(|provider| provider.revision() != self.mirror.evaluated_metadata_revision)
    }

    pub(super) fn mark_metadata_evaluated(&mut self) {
        self.mirror.evaluated_metadata_revision = self
            .mirror
            .cell_metadata_provider
            .as_ref()
            .map_or(0, |provider| provider.revision());
    }

    /// Perform a full recalculation of all formula cells using the existing
    /// dependency graph and AST caches. Does NOT rebuild the ComputeCore.
    ///
    /// Use this for `wb.calculate()` and other cases where the graph structure
    /// hasn't changed. Use `structure_change()` when row/col structure changed.
    /// Use `rebuild_compute_core()` ONLY for engine initialization paths.
    ///
    /// Short-circuits to an empty result when no mutation has occurred since
    /// the last successful full recalc — idempotent `wb.calculate()` is O(1).
    pub fn recalculate(&mut self) -> Result<crate::snapshot::RecalcResult, ComputeError> {
        self.without_history(|engine| {
            // Audited 2026-04-22: no non-mutation invalidation sources for
            // init_cf_caches or materialize_all_pivots — safe to skip when
            // compute store is clean:
            //   - CF rule CRUD (add/update/delete/reorder rules, update ranges)
            //     calls refresh_cf_cache(sheet_id) directly at the mutation site;
            //     init_cf_caches in recalc is value-driven only, not rule-driven.
            //   - Pivot CRUD (pivot_create/update/delete) marks the store dirty
            //     explicitly so materialize_all_pivots still runs on next recalc.
            //   - set_culture marks dirty (locale affects date/number parsing).
            //   - Sheet CRUD and named-range CRUD mark dirty (may change resolution).
            if !engine.stores.compute.is_dirty()
                && !engine.metadata_requires_recalc()
                && !engine.stores.compute.has_volatile_cells()
            {
                return Ok(crate::snapshot::RecalcResult::empty());
            }
            engine.materialize_all_pivots();
            crate::storage::engine::cell_metadata::refresh(
                &engine.stores.storage,
                &mut engine.mirror,
                engine.stores.layout_metrics,
            );
            let result = engine.stores.compute.full_recalc(&mut engine.mirror)?;
            engine.init_cf_caches();
            engine.stores.compute.clear_dirty();
            engine.mark_metadata_evaluated();
            Ok(result)
        })
    }

    /// Recalculate with per-call iterative calculation overrides.
    ///
    /// `calculate()` is idempotent: after a successful recalc, a subsequent
    /// bare call with no intervening mutation returns an empty result in
    /// O(1). To drive convergence of a circular model, callers must opt in
    /// explicitly via `{ iterative: true, max_iterations, max_change }` —
    /// each explicit-override call runs a full recalc so repeated calls
    /// with the iterative option can step toward a fixed point.
    ///
    /// Short-circuits to an empty result when no mutation has occurred since
    /// the last successful full recalc AND the caller passed no iterative
    /// overrides.
    pub fn recalculate_with_options(
        &mut self,
        options: &snapshot_types::RecalcOptions,
    ) -> Result<crate::snapshot::RecalcResult, ComputeError> {
        self.without_history(|engine| {
            // Audited 2026-04-22: no non-mutation invalidation sources for
            // init_cf_caches or materialize_all_pivots — safe to skip when
            // compute store is clean. Same audit as `recalculate()` above.
            let has_explicit_overrides = options.iterative.is_some()
                || options.max_iterations.is_some()
                || options.max_change.is_some();
            if !engine.stores.compute.is_dirty()
                && !engine.metadata_requires_recalc()
                && !has_explicit_overrides
                && !engine.stores.compute.has_volatile_cells()
            {
                return Ok(crate::snapshot::RecalcResult::empty());
            }
            engine.materialize_all_pivots();
            crate::storage::engine::cell_metadata::refresh(
                &engine.stores.storage,
                &mut engine.mirror,
                engine.stores.layout_metrics,
            );
            let result = engine
                .stores
                .compute
                .full_recalc_with_options(&mut engine.mirror, options)?;
            engine.init_cf_caches();
            engine.stores.compute.clear_dirty();
            engine.mark_metadata_evaluated();
            Ok(result)
        })
    }

    /// Rebuild the `ComputeCore` from the engine's own internal state.
    pub fn rebuild_compute_core(&mut self) -> Result<crate::snapshot::RecalcResult, ComputeError> {
        self.without_history(|engine| {
            let snapshot = construction::build_workbook_snapshot(&engine.stores, &engine.mirror);
            let mut rebuilt_mirror = construction::build_finalized_mirror_from_snapshot(
                &engine.stores.storage,
                &snapshot,
                &engine.stores.grid_indexes,
                engine.stores.layout_metrics,
            )?;
            engine.stores.compute = ComputeCore::new();
            let recalc = engine
                .stores
                .compute
                .init_from_snapshot_with_prebuilt_mirror(&mut rebuilt_mirror, snapshot)?;
            engine
                .stores
                .compute
                .set_id_alloc(engine.stores.grid_id_alloc.clone());
            engine.mirror = rebuilt_mirror;
            engine.init_cf_caches();
            // `init_from_snapshot` already cleared the dirty bit after its
            // internal full recalc. Belt-and-braces — rebuild leaves the
            // workbook in a "just recalculated" state.
            engine.stores.compute.clear_dirty();
            engine.mark_metadata_evaluated();
            Ok(recalc)
        })
    }
}
