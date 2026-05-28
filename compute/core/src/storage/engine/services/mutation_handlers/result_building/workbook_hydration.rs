use crate::mirror::CellMirror;
use crate::snapshot::{
    ChangeKind, MutationResult, NamedRangeChange, RecalcResult, WorkbookSettingsChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook;

use super::sheet_hydration::build_sheet_hydration_changes;

// build_mutation_result_for_hydration
// ---------------------------------------------------------------------------

/// Build a [`MutationResult`] that represents a freshly hydrated workbook
/// (XLSX / CSV import). Hydration writes directly to Yrs storage and
/// rebuilds engine indexes, bypassing the live observer. This helper walks
/// the post-hydration engine state and emits per-domain "Set" / "Created"
/// changes so the kernel TS event pipeline (`MutationResultHandler.applyAndNotify`)
/// can populate the TS-side projections (drawings, tables, comments,
/// filters, sparklines, named ranges, conditional formats, pivots, grouping)
/// exactly as it does for live mutations.
///
/// Kernel mirror direct-state bridge: also emits the mirror-backed direct-state
/// families — sheet identity (name/order/visibility/tab-color/frozen panes),
/// per-sheet settings, page breaks, print area/titles/settings, split config,
/// scroll position, and workbook settings — so the first-paint
/// `MutationResult` is sufficient to fully populate the kernel TS mirror
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
    mirror: &CellMirror,
    recalc: RecalcResult,
) -> MutationResult {
    let mut result = MutationResult::from_recalc(recalc);

    let sheet_ids = stores.storage.sheet_order();
    for sid in &sheet_ids {
        build_sheet_hydration_changes(stores, mirror, sid, None, &mut result);
    }
    let doc = stores.storage.doc();

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
    // field on the snapshot so the kernel mirror knows the entire
    // payload was "changed from nothing" on hydration. The mirror
    // replaces its full workbook-settings payload from `settings`.
    let workbook_settings = workbook::settings::get_settings(doc, stores.storage.workbook_map());
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
