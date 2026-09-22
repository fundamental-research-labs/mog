use crate::time_compat::ElapsedInstant;

pub(in super::super) type Deadline = ElapsedInstant;

pub(in super::super) fn make_deadline(timeout: std::time::Duration) -> Deadline {
    ElapsedInstant::now()
        .checked_add(timeout)
        .unwrap_or_else(|| ElapsedInstant::now() + std::time::Duration::from_secs(365 * 24 * 3600))
}

pub(in super::super) fn past_deadline(deadline: &Deadline) -> bool {
    ElapsedInstant::now() > *deadline
}

/// Clear all thread-local caches to avoid stale entries from previous recalc
/// sessions (e.g. if the user switches between demand-driven and topo
/// strategies, or runs multiple topo recalcs in sequence).
///
/// Caches backed by `thread_local!` live in the calling thread. The topo
/// evaluator runs formulas on rayon worker threads, which persist their
/// thread-locals across recalc calls. Clearing only the main thread leaves
/// stale entries on workers — the SUMIFS result cache keys by pointer
/// identity of the column slice, and cell_store mutations reuse the same
/// column pointer, so a worker's cached result from a prior recalc
/// silently "hits" on a new recalc with different underlying data.
///
/// The clear is broadcast across the rayon thread pool so every worker
/// invalidates its thread-local.
pub(in super::super) fn clear_thread_local_caches() {
    clear_current_thread_caches();
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
    crate::cells::clear_caches();
}
