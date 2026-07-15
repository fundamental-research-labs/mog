//! Extracted CF cache service functions.
//!
//! Handles re-evaluation of conditional formatting rules and cache management.
//! The original methods on `YrsComputeEngine` delegate to these free functions.

use std::collections::HashMap;

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::CFCacheEntry;
use crate::storage::engine::cf_cache::convert_cf_formats_to_rules;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::cf_store;
use cell_types::{CellId, SheetId};
use rustc_hash::{FxHashMap, FxHashSet};

/// After a recalculation pass, refresh the CF cache for every sheet that
/// both (a) has conditional formatting rules and (b) had at least one cell
/// change in the recalc result.
///
/// Returns, per sheet, the `(row, col)` pairs of cells whose CF result
/// changed but were **not** already in `recalc.changed_cells`. These are
/// "sibling" cells — e.g. the other member of a Duplicate-Values pair, or
/// the previous Top-N entry that got displaced — whose viewport entries
/// must be patched even though their cell value didn't change.
pub(in crate::storage::engine) fn refresh_cf_caches_after_recalc(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    theme_palette: &HashMap<String, String>,
    recalc: &RecalcResult,
) -> FxHashMap<SheetId, Vec<(u32, u32)>> {
    if stores.cf_cache.is_empty() {
        return FxHashMap::default();
    }

    // Collect unique sheet IDs from changed cells that have CF rules
    let mut affected_sheets: FxHashSet<SheetId> = FxHashSet::default();
    for change in &recalc.changed_cells {
        if let Ok(sid) = SheetId::from_uuid_str(&change.sheet_id)
            && stores.cf_cache.contains_key(&sid)
        {
            affected_sheets.insert(sid);
        }
    }

    // Also check projection changes (dynamic array spills)
    for proj in &recalc.projection_changes {
        if let Ok(sid) = SheetId::from_uuid_str(&proj.sheet_id)
            && stores.cf_cache.contains_key(&sid)
        {
            affected_sheets.insert(sid);
        }
    }

    if affected_sheets.is_empty() {
        return FxHashMap::default();
    }

    // Build a set of positions that are already covered by recalc.changed_cells
    // so we don't double-patch them.
    let mut already_changed: FxHashSet<(SheetId, u32, u32)> = FxHashSet::default();
    for change in &recalc.changed_cells {
        if let (Ok(sid), Some(pos)) = (SheetId::from_uuid_str(&change.sheet_id), &change.position) {
            already_changed.insert((sid, pos.row, pos.col));
        }
    }

    let mut cf_only_changes: FxHashMap<SheetId, Vec<(u32, u32)>> = FxHashMap::default();

    for sheet_id in &affected_sheets {
        // Snapshot the old CF results before the refresh so we can diff them.
        let old_results: FxHashMap<(u32, u32), crate::cf::types::CellCFResult> = stores
            .cf_cache
            .get(sheet_id)
            .map(|e| e.results.clone())
            .unwrap_or_default();

        refresh_cf_cache(stores, mirror, theme_palette, sheet_id);

        // Snapshot new results (clone to avoid borrow overlap).
        let new_results: FxHashMap<(u32, u32), crate::cf::types::CellCFResult> = stores
            .cf_cache
            .get(sheet_id)
            .map(|e| e.results.clone())
            .unwrap_or_default();

        let mut changed: Vec<(u32, u32)> = Vec::new();

        // Cells that were in old CF but their result changed or they left CF.
        for (&pos, old_result) in &old_results {
            if already_changed.contains(&(*sheet_id, pos.0, pos.1)) {
                continue;
            }
            match new_results.get(&pos) {
                Some(new_result) if new_result == old_result => {} // unchanged
                _ => changed.push(pos),                            // lost or changed
            }
        }

        // Cells that are newly in the CF results (gained CF coloring).
        for &pos in new_results.keys() {
            if already_changed.contains(&(*sheet_id, pos.0, pos.1)) {
                continue;
            }
            if !old_results.contains_key(&pos) {
                changed.push(pos);
            }
        }

        if !changed.is_empty() {
            cf_only_changes.insert(*sheet_id, changed);
        }
    }

    cf_only_changes
}

/// Re-evaluate all conditional formatting rules for a sheet and update the cache.
///
/// Pipeline: read CF formats from Yrs storage -> convert domain types to
/// compute-cf rules -> evaluate via `ComputeCore::eval_cf` -> store results
/// in `cf_cache` keyed by `(row, col)`.
pub(in crate::storage::engine) fn refresh_cf_cache(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    theme_palette: &HashMap<String, String>,
    sheet_id: &SheetId,
) {
    // 1. Read CF formats from Yrs storage
    let formats = cf_store::get_formats_for_sheet(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
    );

    // 2. Convert domain types to evaluation types.
    //    Pass a resolver closure that resolves CellId UUID strings to (row, col)
    //    positions via the CellMirror.
    let rules = convert_cf_formats_to_rules(
        &formats,
        |sheet_id_str, cell_id_str| {
            let sid = SheetId::from_uuid_str(sheet_id_str).ok()?;
            let cid = CellId::from_uuid_str(cell_id_str).ok()?;
            let sheet = mirror.get_sheet(&sid)?;
            let pos = sheet.position_of(&cid)?;
            Some((pos.row(), pos.col()))
        },
        Some(*sheet_id),
        theme_palette,
    );

    // 3. If no rules, remove cache entry and return
    if rules.is_empty() {
        stores.cf_cache.remove(sheet_id);
        return;
    }

    // 4. Evaluate CF rules
    let results = stores.compute.eval_cf(mirror, sheet_id, &rules);

    // 5. Convert Vec<CellCFResult> to HashMap keyed by (row, col)
    let mut result_map = FxHashMap::default();
    for result in results {
        result_map.insert((result.row, result.col), result);
    }

    // 6. Store in cache
    stores.cf_cache.insert(
        *sheet_id,
        CFCacheEntry {
            results: result_map,
            dirty: false,
        },
    );
}
