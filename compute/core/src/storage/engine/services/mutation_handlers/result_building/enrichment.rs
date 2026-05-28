use cell_types::{CellId, SheetId, SheetPos};
use value_types::CellValue;

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{comments, hyperlinks, sparklines};
use compute_document::hex::hex_to_id;
use compute_wire::flags as render_flags;

// ---------------------------------------------------------------------------
// enrich_display_text
// ---------------------------------------------------------------------------

/// Populate `display_text` on each `CellChange` using the canonical
/// `format_value_at_cell` method.
pub(in crate::storage::engine) fn enrich_display_text(
    _stores: &EngineStores,
    _mirror: &CellMirror,
    _settings: &EngineSettings,
    result: &mut RecalcResult,
    format_value_fn: &dyn Fn(&CellValue, &SheetId, u32, u32) -> String,
) {
    for change in &mut result.changed_cells {
        let Some(pos) = change.position.clone() else {
            continue;
        };
        let sheet_id = match SheetId::from_uuid_str(&change.sheet_id) {
            Ok(id) => id,
            Err(_) => continue,
        };
        let text = format_value_fn(&change.value, &sheet_id, pos.row, pos.col);
        change.display_text = Some(text);
    }
}

// ---------------------------------------------------------------------------
// enrich_metadata_flags
// ---------------------------------------------------------------------------

/// Populate `extra_flags` on each `CellChange` with metadata flags
/// (HAS_FORMULA, HAS_COMMENT, HAS_SPARKLINE, HAS_HYPERLINK).
pub(in crate::storage::engine) fn enrich_metadata_flags(
    stores: &EngineStores,
    mirror: &CellMirror,
    recalc: &mut RecalcResult,
) {
    let mut comment_cache: std::collections::HashMap<SheetId, std::collections::HashSet<u128>> =
        std::collections::HashMap::new();

    for change in &mut recalc.changed_cells {
        let Some(pos) = change.position.clone() else {
            continue;
        };

        let sheet_id = match SheetId::from_uuid_str(&change.sheet_id) {
            Ok(id) => id,
            Err(_) => continue,
        };
        let cell_id = match CellId::from_uuid_str(&change.cell_id) {
            Ok(id) => id,
            Err(_) => continue,
        };

        // --- HAS_FORMULA ---
        // Check three sources:
        // 1. Compute store has a formula for this cell's CellId (anchor cells).
        // 2. Mirror has a formula for the cell at this position (legacy CellId path).
        // 3. Projection registry: CSE members own the legacy array formula.
        //    Dynamic-array spill members are associated projected values, not
        //    formula owners, and are marked through IS_SPILL_MEMBER patches.
        let has_formula = stores.compute.get_formula(&cell_id).is_some()
            || mirror
                .get_sheet(&sheet_id)
                .and_then(|sheet| {
                    sheet
                        .cell_id_at(SheetPos::new(pos.row, pos.col))
                        .and_then(|cid| sheet.get_cell(&cid))
                })
                .is_some_and(|entry| entry.formula.is_some())
            || mirror
                .projection_registry
                .resolve(&sheet_id, pos.row, pos.col)
                .is_some_and(|(anchor_id, _, _)| mirror.is_cse_anchor(&anchor_id));

        if has_formula {
            change.extra_flags |= render_flags::HAS_FORMULA;
        }

        // --- HAS_COMMENT ---
        let comment_ids = comment_cache.entry(sheet_id).or_insert_with(|| {
            let cell_id_hexes = comments::get_cell_ids_with_comments(
                stores.storage.doc(),
                stores.storage.sheets(),
                &sheet_id,
            );
            cell_id_hexes
                .iter()
                .filter_map(|hex| hex_to_id(hex))
                .collect()
        });
        if comment_ids.contains(&cell_id.as_u128()) {
            change.extra_flags |= render_flags::HAS_COMMENT;
        }

        // --- HAS_SPARKLINE ---
        if sparklines::has_sparkline(
            stores.storage.doc(),
            &stores.storage.sheets_ref(),
            &sheet_id,
            pos.row,
            pos.col,
        ) {
            change.extra_flags |= render_flags::HAS_SPARKLINE;
        }

        // --- HAS_HYPERLINK ---
        if let Some(grid) = stores.grid_indexes.get(&sheet_id)
            && hyperlinks::get_hyperlink(
                stores.storage.doc(),
                stores.storage.sheets(),
                &sheet_id,
                grid,
                pos.row,
                pos.col,
            )
            .is_some()
        {
            change.extra_flags |= render_flags::HAS_HYPERLINK;
        }
    }
}
