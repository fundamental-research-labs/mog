//! Sheet-name normalization for mirror lookup maps.

use rustc_hash::FxHashMap;
use std::cell::RefCell;
use unicode_normalization::UnicodeNormalization;

// Thread-local cache for normalized sheet keys.
// Sheet names don't change during recalc, so caching avoids repeated
// NFC normalization + lowercasing of the same names.
//
// **Tier 2 (epoch-scoped)**: Sheet names are stable within a recalc epoch but
// may change between epochs (e.g. after sheet renames). This cache will be
// consolidated into `crate::eval::cache::epoch_cache::EpochCache` when the evaluator
// is refactored to thread an `EpochCache` reference through the call stack.
// Until then, the thread-local implementation is correct.
thread_local! {
    static NORMALIZED_SHEET_KEY_CACHE: RefCell<FxHashMap<String, String>> =
        RefCell::new(FxHashMap::default());
}

/// Normalize a sheet name for HashMap keying: NFC + lowercase.
///
/// NFC is the W3C standard and handles Hebrew, Arabic, Korean Jamo,
/// Vietnamese, Latin diacritics, and CJK compatibility characters.
/// This ensures that sheet names arriving from different XML sources
/// (workbook.xml vs formula text) with different Unicode encodings
/// (NFC vs NFD) resolve to the same HashMap key.
///
/// Results are cached in a thread-local map for the duration of a recalc.
pub(super) fn normalize_sheet_key(name: &str) -> String {
    NORMALIZED_SHEET_KEY_CACHE.with(|cache| {
        let cache_ref = cache.borrow();
        if let Some(cached) = cache_ref.get(name) {
            return cached.clone();
        }
        drop(cache_ref);
        let normalized = name.nfc().collect::<String>().to_lowercase();
        cache
            .borrow_mut()
            .insert(name.to_owned(), normalized.clone());
        normalized
    })
}

/// Clear all module-level caches.
///
/// Called at recalc entry to ensure stale data from a previous recalc
/// (e.g. after sheet renames) does not persist.
pub fn clear_caches() {
    NORMALIZED_SHEET_KEY_CACHE.with(|cache| cache.borrow_mut().clear());
}

/// Return the number of entries currently in the sheet name normalization cache.
///
/// Used by [`crate::eval::cache::epoch_cache::EpochCache::stats()`] for diagnostics.
pub fn sheet_name_cache_entry_count() -> usize {
    NORMALIZED_SHEET_KEY_CACHE.with(|cache| cache.borrow().len())
}
