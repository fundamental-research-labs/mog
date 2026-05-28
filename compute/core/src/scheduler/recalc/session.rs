// ---------------------------------------------------------------------------
// Deadline abstraction — uses WasmSafeInstant which works on both native and
// WASM targets (delegates to js_sys::Date::now() on WASM).
// ---------------------------------------------------------------------------

use crate::time_compat::WasmSafeInstant;

pub(in super::super) type Deadline = WasmSafeInstant;

pub(in super::super) fn make_deadline(timeout: std::time::Duration) -> Deadline {
    WasmSafeInstant::now()
        .checked_add(timeout)
        .unwrap_or_else(|| WasmSafeInstant::now() + std::time::Duration::from_secs(365 * 24 * 3600))
}

pub(in super::super) fn past_deadline(deadline: &Deadline) -> bool {
    WasmSafeInstant::now() > *deadline
}

/// Clear all thread-local caches to avoid stale entries from previous recalc
/// sessions (e.g. if the user switches between demand-driven and topo
/// strategies, or runs multiple topo recalcs in sequence).
///
/// Caches backed by `thread_local!` live in the calling thread. The topo
/// evaluator runs formulas on rayon worker threads, which persist their
/// thread-locals across recalc calls. Clearing only the main thread leaves
/// stale entries on workers — the SUMIFS result cache keys by pointer
/// identity of the column slice, and mirror mutations reuse the same
/// column pointer, so a worker's cached result from a prior recalc
/// silently "hits" on a new recalc with different underlying data.
///
/// Under the `native` feature we broadcast the clear across the rayon
/// thread pool so every worker invalidates its thread-local.
pub(in super::super) fn clear_thread_local_caches() {
    clear_current_thread_caches();
    #[cfg(feature = "native")]
    rayon::broadcast(|_| clear_current_thread_caches());
}

#[inline]
fn clear_current_thread_caches() {
    compute_functions::helpers::sorted_cache::clear();
    compute_functions::helpers::frequency_cache::clear();
    compute_functions::helpers::bitmask_cache::clear();
    compute_functions::helpers::column_index::clear();
    compute_functions::helpers::sumifs_result_cache::clear();
    crate::eval::cache::subexpr_cache::clear();
    crate::mirror::clear_caches();
}
