use super::*;

/// Stream load hydrates every sheet up front, so there is no remaining payload
/// to stage. Kept so `complete_deferred_hydration` stays a no-op success.
pub(in crate::storage::engine) fn stage_deferred_hydration(
    _engine: &ComputeEngine,
) -> Result<Option<DeferredHydrationCompletion>, ComputeError> {
    Ok(None)
}

pub(in crate::storage::engine) fn commit_deferred_hydration(
    engine: &mut ComputeEngine,
    completion: DeferredHydrationCompletion,
) {
    engine.stores = completion.stores;
    engine.cell_store = completion.cell_store;
    engine.settings = completion.settings;
    engine.import_report = completion.import_report;
    engine.viewport.clear();
    engine.init_cf_caches();
    normalize_named_range_refs(engine);
    sync_enable_calculation_flags(engine);
    engine.deferred_hydration = None;
}
