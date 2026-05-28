use cell_types::SheetId;
use compute_document::hex::{SmallHex, id_to_hex};
use domain_types::domain::named_range::DefinedName;

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook::named_ranges;

/// Refresh `KEY_FORMULA` sub-keys in Yrs cell maps for any formula-bearing
/// cell whose A1 form differs between Yrs (pre-shift) and the ComputeCore
/// cache (post-shift). Writes the authoritative shifted A1 string back to
/// Yrs so that yrs — not the compute cache — remains the source of truth.
///
/// The rest of each cell map (value, format, properties, KEY_FORMULA_TEMPLATE,
/// …) is left untouched.
///
/// **Why write instead of remove**: removing KEY_FORMULA created a parallel
/// journal where the compute cache held the post-shift formula but Yrs held
/// nothing. On undo, Yrs would roll back to the pre-shift formula correctly,
/// but any rebuild path that tries to re-anchor from `KEY_FORMULA` before the
/// rollback observed no formula at all. Writing the shifted formula keeps Yrs
/// as the single authoritative source and lets the standard
/// `rebuild_after_structural_observer_change` re-parse the correct string on
/// undo — no parallel journal, no out-of-band state.
///
/// Iteration is bounded by the formula-cell count of the affected sheet
/// (not total cells): we walk `mirror.get_sheet(sheet_id).cells_iter()`
/// filtered on `entry.formula.is_some()`.
///
/// `result.changed_cells` is intentionally **not** used to scope this —
/// it tracks cell *value* changes, and a formula whose refs shifted but
/// whose evaluated value didn't (e.g. `=A1+B1` → `=A2+B2` where the
/// operands are constants) would be missed.
///
/// Writes go through a single Yrs transaction tagged `ORIGIN_STRUCTURAL`
/// so undo groups the invalidation with the structural op itself. The
/// caller's observer-suppression window still applies (these writes are
/// initiated from within `apply_structure_change`).
pub(super) fn invalidate_stale_yrs_formulas(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) {
    use compute_document::schema::{KEY_CELLS, KEY_FORMULA};
    use compute_document::undo::ORIGIN_STRUCTURAL;
    use std::sync::Arc;
    use yrs::{Any, Map, Origin, Out, Transact};

    let Some(sheet_mirror) = mirror.get_sheet(sheet_id) else {
        return;
    };

    // Pass 1 — read: collect (cell_hex, shifted_formula) pairs for cells
    // where Yrs KEY_FORMULA disagrees with the compute cache. Skip cells that
    // have no formula in the mirror (shouldn't have KEY_FORMULA anyway) and
    // cells that match (no-op optimization — avoids churn on cells untouched
    // by the shift).
    //
    // KEY_FORMULA stores the formula body *without* the leading '=' (see
    // `services/cell_editing.rs` write path, which strips the '=' before
    // calling `write_cell_to_yrs`). The compute cache's `get_formula()`
    // returns the A1 string *with* the leading '=' (see `display.rs`
    // `render_identity_formula` which always pushes '=' first). Strip it on
    // both the read-comparison and the write side.
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let sheets_map = stores.storage.sheets();

    let updates: Vec<(SmallHex, String)> = {
        let txn = doc.transact();
        let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) else {
            return;
        };
        let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS) else {
            return;
        };

        let mut pending = Vec::new();
        for (cell_id, entry) in sheet_mirror.cells_iter() {
            if entry.formula.is_none() {
                continue;
            }
            let cell_hex = id_to_hex(cell_id.as_u128());

            let yrs_formula = match cells_map.get(&txn, &cell_hex) {
                Some(Out::YMap(cell_map)) => match cell_map.get(&txn, KEY_FORMULA) {
                    Some(Out::Any(Any::String(s))) => Some(s.to_string()),
                    _ => None,
                },
                _ => None,
            };

            // Authoritative post-shift A1 string from the compute cache.
            // Includes the leading '=' (render_identity_formula convention).
            let Some(compute_formula) = stores.compute.get_formula(cell_id) else {
                continue;
            };
            // KEY_FORMULA convention: no leading '='.
            let shifted_body = compute_formula.strip_prefix('=').unwrap_or(compute_formula);

            // If Yrs already matches the shifted form, nothing to do.
            if let Some(ref existing) = yrs_formula
                && existing.as_str() == shifted_body
            {
                continue;
            }

            pending.push((cell_hex, shifted_body.to_string()));
        }
        pending
    };

    if updates.is_empty() {
        return;
    }

    // Pass 2 — write: update KEY_FORMULA on each affected cell map with the
    // shifted formula body. Writing (rather than removing) keeps Yrs
    // authoritative so undo's rollback restores the pre-shift string
    // naturally, without leaving a window where no formula exists in Yrs.
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex)
        && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
    {
        for (cell_hex, shifted_body) in &updates {
            if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, cell_hex) {
                cell_map.insert(
                    &mut txn,
                    KEY_FORMULA,
                    Any::String(Arc::from(shifted_body.as_str())),
                );
            }
        }
    }
}

/// Refresh Yrs `DefinedName.refers_to` entries after a structural change.
///
/// The in-memory `VariableStore` holds `NamedRangeDef` with `IdentityFormula`
/// containing stable `CellId`s. Those CellIds still resolve correctly after
/// structural ops (only the mirror position mappings shift), so the JSON
/// serialization of the `IdentityFormula` does not actually change under
/// pure row/column shifts. We still re-serialize and upsert here to keep
/// this the single authoritative writeback point for named ranges after
/// a structural op — it also ensures any pre-W5 A1 strings still lingering
/// in Yrs (from documents authored before typed-boundary) are overwritten with
/// the canonical JSON form.
///
/// Typed formula boundary: picks JSON-serialized `IdentityFormula` as the single
/// on-disk format for `DefinedName.refers_to` in Yrs, eliminating the
/// prior A1-vs-JSON dual-decoder.
///
/// The caller must have the observer suppressed (structural ops already do
/// this) to prevent Yrs writes from triggering feedback loops.
pub(super) fn regenerate_named_range_yrs_refs(stores: &mut EngineStores, mirror: &CellMirror) {
    // Collect data we need from the mirror to avoid holding a borrow across
    // the mutable Yrs writes below.
    let entries: Vec<(formula_types::Scope, String, formula_types::IdentityFormula)> = mirror
        .variables
        .all_variables()
        .filter(|(_, _, def)| !def.refers_to.refs.is_empty())
        .map(|(scope, name, def)| (scope.clone(), name.clone(), def.refers_to.clone()))
        .collect();

    if entries.is_empty() {
        return;
    }

    // Read existing Yrs entries to match by name+scope for id preservation.
    let yrs_entries =
        named_ranges::get_all_named_ranges(stores.storage.doc(), stores.storage.workbook_map());

    for (scope, name, refers_to) in &entries {
        // Convert scope to the Yrs string representation.
        let scope_str = match scope {
            formula_types::Scope::Sheet(sid) => Some(sid.to_uuid_string()),
            formula_types::Scope::Workbook => None,
        };

        // Serialize the already-typed IdentityFormula to JSON. CellIds are
        // stable under structural ops — the same JSON bytes are typically
        // produced before and after — but we re-upsert unconditionally so
        // this function remains the sole writeback path after structural
        // changes.
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map
        // keys and no non-finite floats in IdentityFormula.
        let refers_to_json = serde_json::to_string(refers_to)
            .expect("IdentityFormula serialization should not fail");

        // Find the existing Yrs entry by name+scope to preserve its id.
        let existing = yrs_entries
            .iter()
            .find(|dn| dn.name.eq_ignore_ascii_case(name) && dn.scope == scope_str);

        let id = existing
            .map(|dn| dn.id.clone())
            .unwrap_or_else(|| stores.next_id_simple());

        let defined_name = DefinedName {
            id,
            name: name.clone(),
            refers_to: refers_to_json,
            raw_refers_to: existing.and_then(|dn| dn.raw_refers_to.clone()),
            scope: scope_str,
            comment: existing.and_then(|dn| dn.comment.clone()),
            custom_menu: existing.and_then(|dn| dn.custom_menu.clone()),
            description: existing.and_then(|dn| dn.description.clone()),
            help: existing.and_then(|dn| dn.help.clone()),
            status_bar: existing.and_then(|dn| dn.status_bar.clone()),
            visible: existing.map(|dn| dn.visible).unwrap_or(true),
            xlm: existing.map(|dn| dn.xlm).unwrap_or(false),
            function: existing.map(|dn| dn.function).unwrap_or(false),
            vb_procedure: existing.map(|dn| dn.vb_procedure).unwrap_or(false),
            publish_to_server: existing.map(|dn| dn.publish_to_server).unwrap_or(false),
            workbook_parameter: existing.map(|dn| dn.workbook_parameter).unwrap_or(false),
            xml_space_preserve: existing.map(|dn| dn.xml_space_preserve).unwrap_or(false),
            order: existing.and_then(|dn| dn.order),
            linked_range_id: existing.and_then(|dn| dn.linked_range_id),
        };

        named_ranges::upsert_named_range(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            &defined_name,
        );
    }
}
