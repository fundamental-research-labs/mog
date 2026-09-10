use crate::cells::CellStore;
use crate::snapshot::{
    ChangeKind, MutationResult, NamedRangeChange, RecalcResult, WorkbookSettingsChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook;

use super::sheet_hydration::build_sheet_hydration_changes;

// build_mutation_result_for_hydration
// ---------------------------------------------------------------------------

/// Build a [`MutationResult`] that represents a freshly hydrated workbook
/// (XLSX / CSV import). After native hydration and index construction, this helper walks
/// the post-hydration engine state and emits per-domain "Set" / "Created"
/// changes so the kernel TS event pipeline (`MutationResultHandler.applyAndNotify`)
/// can populate the TS-side projections (drawings, tables, comments,
/// filters, sparklines, named ranges, conditional formats, pivots, grouping)
/// exactly as it does for live mutations.
///
/// Kernel cell_store direct-state bridge: also emits the cell store-backed direct-state
/// families — sheet identity (name/order/visibility/tab-color/frozen panes),
/// per-sheet settings, page breaks, print area/titles/settings, split config,
/// scroll position, and workbook settings — so the first-paint
/// `MutationResult` is sufficient to fully populate the kernel TS cell_store
/// without a separate hydration RPC.
///
/// **What is NOT emitted:**
///
/// - `propertyChanges` / `dimensionChanges` / `visibilityChanges` /
///   `mergeChanges` / `structureChanges` — bulk per-cell/row/col changes
///   are too expensive to enumerate and the viewport buffer is the
///   correct mechanism for cell/format reads after hydration.
/// - `sortingChanges` — sorting is an action, not a stored entity.
pub(in crate::storage::engine) fn build_mutation_result_for_hydration(
    stores: &EngineStores,
    cell_store: &CellStore,
    recalc: RecalcResult,
) -> MutationResult {
    let mut result = MutationResult::from_recalc(recalc);

    let sheet_ids = stores.storage.sheet_order();
    for sid in &sheet_ids {
        build_sheet_hydration_changes(stores, cell_store, sid, None, &mut result);
    }

    // ----- Named ranges (workbook-scoped enumeration) -----
    let named_ranges =
        crate::storage::engine::services::queries::get_named_ranges_by_scope(stores, None);
    for nr in named_ranges {
        result.named_range_changes.push(NamedRangeChange {
            name: nr.name,
            kind: ChangeKind::Set,
        });
    }

    // ----- Workbook-level settings (full snapshot) -----
    //
    // Single emit; `changed_keys` enumerates every camelCase top-level
    // field on the snapshot so the kernel cell_store knows the entire
    // payload was "changed from nothing" on hydration. The cell store
    // replaces its full workbook-settings payload from `settings`.
    let workbook_settings = workbook::settings::get_settings(&stores.storage.metadata);
    let workbook_settings_value =
        serde_json::to_value(&workbook_settings).expect("WorkbookSettings must serialize to JSON");
    let changed_keys = match &workbook_settings_value {
        serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    result
        .workbook_settings_changes
        .push(WorkbookSettingsChange {
            kind: ChangeKind::Set,
            changed_keys,
            settings: workbook_settings_value,
        });

    result
}
