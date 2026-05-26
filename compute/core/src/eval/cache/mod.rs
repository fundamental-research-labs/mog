//! Multi-tier evaluation cache hierarchy.
//!
//! ## Tier 0 — Lookup index (persistent, cross-epoch)
//! Sorted column snapshots for O(log n) search — survives across recalc epochs.
//! See [`workbook_cache`].
//!
//! ## Tier 1 — Workbook cache (persistent, cross-epoch)
//! Frequency maps, bitmask caches, sorted column caches.
//! See [`workbook_cache`].
//!
//! ## Tier 2 — Epoch cache (ephemeral, per-recalc)
//! Cleared at the start of each recalc epoch.
//! See [`epoch_cache`].
//!
//! ## Tier 3 — Range store (ephemeral, per-level)
//! Materialized range data, pre-computed per topo level.
//! See [`range_store`].
//!
//! ## Tier 4 — Subexpression cache (thread-local, per-epoch)
//! Deduplicates identical AST subtree evaluations within a thread.
//! See [`subexpr_cache`].
//!
//! ## Tier 5 — Lambda cache (ephemeral, per-evaluation)
//! Constant-folds parameters across lambda iteration.
//! See [`lambda_cache`].

pub(crate) mod database_cache;
// Staged subsystem: epoch-scoped subexpression + pre-recalc snapshot cache.
#[allow(dead_code)]
pub(crate) mod epoch_cache;
pub(crate) mod lambda_cache;
pub(crate) mod range_store;
pub(crate) mod range_version;
pub(crate) mod subexpr_cache;
pub(crate) mod versioned_entry;
pub(crate) mod workbook_cache;
