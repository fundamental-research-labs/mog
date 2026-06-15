use std::collections::BTreeSet;
use std::sync::Arc;

use yrs::{Any, Array, Map, MapPrelim, MapRef};

use domain_types::yrs_schema;
use domain_types::{CellData, ColDimension, ImportedCellProjectionRole, MergeRegion, RowDimension};

use compute_document::hex::{SmallHex, id_to_hex};

use cell_types::CellId;

use compute_document::cell_serde::{
    build_cell_prelim, write_array_ref_to_yrs, write_rich_string_to_yrs,
};

use super::IdAllocator;
use super::form_controls::normalize_form_control_references_for_hydration;
use super::helpers::{PositionMap, get_or_create_cell_id_for_pos};
use crate::import::parse_output_to_snapshot::hyperlink_lowering::{
    HyperlinkAnchor, classify_hyperlink_anchor,
};
use crate::storage::sheet::schemas;
use domain_types::domain::hyperlink::HyperlinkTargetKind;
use formula_types::CellRef;

mod comments;
pub(super) use comments::hydrate_comments;

// ===========================================================================
// Cell hydration
// ===========================================================================

/// Hydrate cells into the Yrs cells map.
///
/// For each cell in `ParseOutput`:
/// 1. Allocate a CellId via the IdAllocator
/// 2. Write cell data using `build_cell_prelim()` (the gold standard)
///
/// Returns `(cell_ids, pos_map)` where `pos_map` is an in-memory position index
/// (`(row, col)` -> cell_hex) used by downstream hydration functions (merges, comments,
/// hyperlinks, styles, filters) and mirrored by the caller into the canonical
/// Yrs `gridIndex/{posToId,idToPos}` store before the import transaction commits.
pub(super) fn hydrate_cells(
    txn: &mut yrs::TransactionMut,
    cells_map: &MapRef,
    cells: &[CellData],
    allocator: &mut impl IdAllocator,
) -> (Vec<CellId>, PositionMap) {
    let mut allocated_ids = Vec::with_capacity(cells.len());
    let mut pos_map = PositionMap::with_capacity(cells.len());
    for cell in cells {
        let cell_id = allocator.alloc_cell_id();
        allocated_ids.push(cell_id);
        if cell.projection_role == ImportedCellProjectionRole::DynamicArraySpillTarget {
            continue;
        }
        let cell_hex = id_to_hex(cell_id.as_u128());

        // Build cell prelim using the gold standard cell_serde path.
        // ParseOutput cells have no identity formulas (those are a collab-layer concern),
        // so we pass None for the identity_formula parameter.
        let cell_prelim = build_cell_prelim(
            &cell.value,
            cell.formula.as_deref(),
            None, // No identity formulas in ParseOutput
        );
        let cell_map: MapRef = cells_map.insert(txn, &*cell_hex, cell_prelim);
        if let Some(array_ref) = cell.array_ref.as_deref() {
            write_array_ref_to_yrs(&cell_map, txn, array_ref);
        }
        if let Some(rich_string) = cell.rich_string.as_ref() {
            write_rich_string_to_yrs(&cell_map, txn, rich_string);
        }
        if let Some(cell_formula) = cell.cell_formula.as_ref() {
            write_formula_metadata_to_yrs(&cell_map, txn, cell_formula);
        }

        // Track position → cell_hex in memory for downstream hydration lookups
        pos_map.insert((cell.row, cell.col), cell_hex.to_string());
    }
    (allocated_ids, pos_map)
}

/// Hydrate cells into the Yrs cells map using **pre-allocated** CellIds.
///
/// Like `hydrate_cells`, but:
/// - Uses the provided `cell_ids` slice instead of allocating new ones.
/// - Skips writing cells whose `(row, col)` is in `ranged_positions` (these
///   cells will be stored as compact Range payloads instead of per-cell Yrs entries).
/// - Pure ranged values do not enter `pos_map`; the caller mirrors `pos_map`
///   into durable `gridIndex`, and Range-resident values must stay virtual.
///   Ranged formulas and styled cells still receive explicit identity until
///   the corresponding formula/style range metadata paths are compact.
pub(super) fn hydrate_cells_with_ids(
    txn: &mut yrs::TransactionMut,
    cells_map: &MapRef,
    cells: &[CellData],
    cell_ids: &[CellId],
    ranged_positions: &std::collections::HashSet<(u32, u32)>,
    range_style_positions: &std::collections::HashSet<(u32, u32)>,
) -> PositionMap {
    let mut pos_map = PositionMap::with_capacity(cells.len() / 2);
    for (i, cell) in cells.iter().enumerate() {
        if cell.projection_role == ImportedCellProjectionRole::DynamicArraySpillTarget {
            continue;
        }
        let is_empty = cell.formula.is_none() && cell.value.is_null() && cell.rich_string.is_none();
        let style_is_range_backed = range_style_positions.contains(&(cell.row, cell.col));
        let has_cell_properties = (cell.style_id.is_some() && !style_is_range_backed)
            || cell.cell_metadata_index.is_some()
            || cell.vm.is_some()
            || cell.formula_result_type.is_some()
            || cell.has_empty_cached_value
            || !cell.formula_cache_provenance.is_absent_or_unknown()
            || cell.original_sst_index.is_some()
            || cell.original_value.is_some()
            || cell.rich_string.is_some();

        // Skip truly empty cells (no value, no formula, no persisted properties).
        // Cells with properties must stay in pos_map so hydrate_cell_styles can
        // attach their compact CellProperties entry.
        if is_empty && !has_cell_properties {
            continue;
        }

        let is_ranged = ranged_positions.contains(&(cell.row, cell.col));
        let requires_explicit_identity =
            !is_ranged || cell.formula.is_some() || has_cell_properties;
        if !requires_explicit_identity {
            continue;
        }

        let cell_hex = id_to_hex(cell_ids[i].as_u128());

        pos_map.insert((cell.row, cell.col), cell_hex.to_string());

        // Empty styled cells don't need a Yrs cell entry — only the
        // pos_map slot (for style hydration). Skip the Yrs write.
        if is_empty && cell.original_value.is_none() {
            continue;
        }

        if is_ranged {
            continue;
        }

        let cell_prelim = build_cell_prelim(&cell.value, cell.formula.as_deref(), None);
        let cell_map: MapRef = cells_map.insert(txn, &*cell_hex, cell_prelim);
        if let Some(array_ref) = cell.array_ref.as_deref() {
            write_array_ref_to_yrs(&cell_map, txn, array_ref);
        }
        if let Some(rich_string) = cell.rich_string.as_ref() {
            write_rich_string_to_yrs(&cell_map, txn, rich_string);
        }
        if let Some(cell_formula) = cell.cell_formula.as_ref() {
            write_formula_metadata_to_yrs(&cell_map, txn, cell_formula);
        }
    }
    pos_map
}

fn write_formula_metadata_to_yrs(
    cell_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    formula: &ooxml_types::worksheet::CellFormula,
) {
    let json = serde_json::to_string(formula)
        .expect("ooxml cell formula metadata should be JSON-serializable");
    cell_map.insert(
        txn,
        compute_document::schema::KEY_FORMULA_METADATA,
        Any::String(Arc::from(json)),
    );
}

// ===========================================================================
// Merge hydration (StoredMerge JSON format)
// ===========================================================================

/// Hydrate merged cell ranges as JSON `StoredMerge` entries.
///
/// Each merge is stored as a JSON string keyed by the top-left cell's hex ID.
/// Both top-left and bottom-right corners get CellIds allocated so that the
/// merge carries full identity information from import time.
pub(super) fn hydrate_merges(
    txn: &mut yrs::TransactionMut,
    merges_map: &MapRef,
    cells_map: &MapRef,
    pos_map: &mut PositionMap,
    merges: &[MergeRegion],
    allocator: &mut impl IdAllocator,
) {
    use crate::storage::sheet::merges::StoredMerge;

    for (i, merge) in merges.iter().enumerate() {
        // Get or create CellId for top-left corner (used as the merge key)
        let tl_hex = get_or_create_cell_id_for_pos(
            cells_map,
            pos_map,
            txn,
            merge.start_row,
            merge.start_col,
            allocator,
        );

        // Get or create CellId for bottom-right corner
        let br_hex = get_or_create_cell_id_for_pos(
            cells_map,
            pos_map,
            txn,
            merge.end_row,
            merge.end_col,
            allocator,
        );

        // Write StoredMerge as JSON string, preserving original file order
        // and resolved positions so export doesn't need idToPos.
        let stored = StoredMerge {
            top_left_id: tl_hex.clone(),
            bottom_right_id: br_hex,
            ord: Some(i as u32),
            sr: merge.start_row,
            sc: merge.start_col,
            er: merge.end_row,
            ec: merge.end_col,
        };
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let json =
            serde_json::to_string(&stored).expect("StoredMerge serialization should not fail");
        merges_map.insert(txn, &*tl_hex, Any::String(Arc::from(json.as_str())));
    }
}

// ===========================================================================
// Row/Col dimension hydration
// ===========================================================================

/// Hydrate row heights into the Yrs rowHeights map.
///
/// Row heights are keyed by RowId (stable identity). We allocate RowIds
/// for each row that has a custom height via the IdAllocator.
///
/// Values are stored in **points** (canonical OOXML units). The LayoutIndex
/// converts to pixels on construction.
pub(super) fn hydrate_row_heights(
    txn: &mut yrs::TransactionMut,
    row_heights_map: &MapRef,
    row_id_hexes: &[SmallHex],
    row_heights: &[RowDimension],
    default_row_height_pt: f64,
) {
    for rh in row_heights {
        // Only store when the row has a real height — skip descent-only stubs
        // (height=0, not custom, not hidden) which exist only to carry
        // per-row x14ac:dyDescent data.
        let has_real_height = rh.custom_height || rh.hidden || rh.height > 0.0;
        let differs_from_default = (rh.height - default_row_height_pt).abs() > 0.01;
        if has_real_height
            && (rh.custom_height || differs_from_default)
            && let Some(row_id) = row_id_hexes.get(rh.row as usize)
        {
            row_heights_map.insert(txn, row_id.as_str(), Any::Number(rh.height));
        }
    }
}

/// Hydrate column widths into the Yrs colWidths map.
///
/// Column widths are keyed by ColId (stable identity). We allocate ColIds
/// for each column that has a custom width via the IdAllocator.
///
/// Values are stored in **character-width units** (canonical OOXML units).
/// The LayoutIndex converts to pixels on construction.
pub(super) fn hydrate_col_widths(
    txn: &mut yrs::TransactionMut,
    col_widths_map: &MapRef,
    col_id_hexes: &[SmallHex],
    col_widths: &[ColDimension],
    default_col_width_cw: f64,
) {
    for cw in col_widths {
        if (cw.custom_width || (cw.width - default_col_width_cw).abs() > 0.01)
            && let Some(col_id) = col_id_hexes.get(cw.col as usize)
        {
            col_widths_map.insert(txn, col_id.as_str(), Any::Number(cw.width));
        }
    }
}

/// Hydrate hidden rows and columns from dimension data.
///
/// Hidden rows/cols use the row/col index (as string) as key with `Any::Bool(true)`.
pub(super) fn hydrate_hidden_rows_cols(
    txn: &mut yrs::TransactionMut,
    hidden_rows_map: &MapRef,
    manual_hidden_rows_map: &MapRef,
    hidden_cols_map: &MapRef,
    row_id_hexes: &[SmallHex],
    row_heights: &[RowDimension],
    col_widths: &[ColDimension],
    defer_hidden_row_ownership: bool,
    structural_hidden_rows: &BTreeSet<u32>,
) {
    for rh in row_heights {
        if rh.hidden {
            let structurally_hidden = structural_hidden_rows.contains(&rh.row);
            if !structurally_hidden {
                let key = rh.row.to_string();
                hidden_rows_map.insert(txn, &*key, Any::Bool(true));
            }
            if !defer_hidden_row_ownership
                && !structurally_hidden
                && let Some(row_id) = row_id_hexes.get(rh.row as usize)
            {
                manual_hidden_rows_map.insert(txn, row_id.as_str(), Any::Bool(true));
            }
        }
    }
    for cw in col_widths {
        if cw.hidden {
            let key = cw.col.to_string();
            hidden_cols_map.insert(txn, &*key, Any::Bool(true));
        }
    }
}

// ===========================================================================
// Hyperlink hydration (using yrs_schema::hyperlink)
// ===========================================================================

/// Hydrate hyperlinks onto cells using the cell-level "h" field.
///
/// ParseOutput hyperlinks use the domain `Hyperlink` type with a `cell_ref`
/// in A1 notation. We resolve each to a grid position and write the URL
/// to the cell map's "h" field (matching existing read path).
///
/// Hyperlinks can anchor to empty cells (no `<c>` in `<sheetData>`). Like
/// `hydrate_merges`, we synthesize a phantom cell via
/// `get_or_create_cell_id_for_pos` so the URL survives round-trip. The
/// phantom-cell grid-index mirror at the end of `hydrate_sheet` picks up
/// these new positions automatically.
pub(super) fn hydrate_hyperlinks(
    txn: &mut yrs::TransactionMut,
    pos_map: &mut PositionMap,
    cells_map: &MapRef,
    meta_map: &MapRef,
    hyperlinks: &[domain_types::domain::hyperlink::Hyperlink],
    allocator: &mut impl IdAllocator,
) {
    // Range hyperlinks that can't be stored on a cell (because the top-left cell
    // already has a different hyperlink) are serialized as JSON in the meta map.
    let mut extra_range_hyperlinks: Vec<serde_json::Value> = Vec::new();

    for (order_idx, link) in hyperlinks.iter().enumerate() {
        // Classify the hyperlink anchor (ref=) into a typed
        // `HyperlinkAnchor { Cell | Range }`. The narrow enum replaces the
        // prior `parse_a1_ref` shadow-parse + `link.cell_ref.contains(':')`
        // substring check — see `import::parse_output_to_snapshot::hyperlink_lowering`.
        let anchor = match classify_hyperlink_anchor(&link.cell_ref) {
            Some(a) => a,
            None => continue,
        };
        let is_range_anchor = anchor.is_range();
        let (row, col) = match anchor_top_left(&anchor) {
            Some(pos) => pos,
            None => continue,
        };

        // Determine URL: prefer target, fall back to inline location.
        // If neither exists but the hyperlink has a uid, store empty string so
        // the uid-only marker survives the round-trip.
        let url = match (&link.target, &link.location) {
            (Some(t), _) if !t.is_empty() => t.clone(),
            (_, Some(loc)) if !loc.is_empty() => loc.clone(),
            _ if link.uid.is_some() => String::new(),
            _ => continue,
        };

        // Resolve cell_id, creating a phantom cell if the position has no
        // data cell. Matches the pattern in `hydrate_merges`
        // so hyperlinks anchored to empty cells survive XLSX round-trip.
        let cell_hex = get_or_create_cell_id_for_pos(cells_map, pos_map, txn, row, col, allocator);

        // Set "h" field on the cell map, plus optional location/display/tooltip.
        if let Some(yrs::Out::YMap(cell_map)) = cells_map.get(txn, &cell_hex) {
            // If the cell already has a hyperlink and this is a range hyperlink,
            // store it separately to avoid overwriting the single-cell hyperlink.
            if cell_map.get(txn, "h").is_some() && is_range_anchor {
                let mut entry = serde_json::json!({
                    "ref": link.cell_ref,
                    "order": order_idx,
                });
                if let Some(loc) = &link.location {
                    entry["location"] = serde_json::json!(loc);
                }
                if let Some(display) = &link.display {
                    entry["display"] = serde_json::json!(display);
                }
                if let Some(tooltip) = &link.tooltip {
                    entry["tooltip"] = serde_json::json!(tooltip);
                }
                if let Some(target) = &link.target {
                    entry["target"] = serde_json::json!(target);
                }
                if let Some(uid) = &link.uid {
                    entry["uid"] = serde_json::json!(uid);
                }
                if let Some(target_kind) = hyperlink_target_kind(link) {
                    entry["targetKind"] = serde_json::json!(hyperlink_target_kind_str(target_kind));
                }
                if let Some(target_mode) = &link.target_mode {
                    entry["targetMode"] = serde_json::json!(target_mode);
                }
                extra_range_hyperlinks.push(entry);
                continue;
            }
            cell_map.insert(txn, "h", Any::String(Arc::from(url.as_str())));
            if let Some(loc) = &link.location
                && !loc.is_empty()
            {
                cell_map.insert(txn, "hl", Any::String(Arc::from(loc.as_str())));
            }
            if let Some(display) = &link.display
                && !display.is_empty()
            {
                cell_map.insert(txn, "hd", Any::String(Arc::from(display.as_str())));
            }
            if let Some(tooltip) = &link.tooltip
                && !tooltip.is_empty()
            {
                cell_map.insert(txn, "ht", Any::String(Arc::from(tooltip.as_str())));
            }
            if let Some(uid) = &link.uid
                && !uid.is_empty()
            {
                cell_map.insert(txn, "hu", Any::String(Arc::from(uid.as_str())));
            }
            if let Some(target_kind) = hyperlink_target_kind(link) {
                cell_map.insert(
                    txn,
                    "hk",
                    Any::String(Arc::from(hyperlink_target_kind_str(target_kind))),
                );
            }
            if let Some(target_mode) = &link.target_mode
                && !target_mode.is_empty()
            {
                cell_map.insert(txn, "hm", Any::String(Arc::from(target_mode.as_str())));
            }
            // Store original cell_ref for range hyperlinks (e.g., "A1:B2")
            // so the export can reconstruct the original range ref. The
            // typed `HyperlinkAnchor::Range` branch is the discriminator —
            // substring-matching on `:` would misfire on
            // `'A:B'!C1` style sheet-qualified cells that contain a colon
            // in the sheet name.
            if is_range_anchor {
                cell_map.insert(txn, "hr", Any::String(Arc::from(link.cell_ref.as_str())));
            }
            // Store original order index for round-trip fidelity
            cell_map.insert(txn, "ho", Any::Number(order_idx as f64));
        }
    }

    // Store extra range hyperlinks in the sheet meta for roundtrip fidelity
    yrs_schema::helpers::write_json_vec(meta_map, txn, "rangeHyperlinks", &extra_range_hyperlinks);
}

fn hyperlink_target_kind(
    link: &domain_types::domain::hyperlink::Hyperlink,
) -> Option<HyperlinkTargetKind> {
    link.target_kind.or_else(|| {
        if link.target.is_some() {
            Some(HyperlinkTargetKind::Relationship)
        } else if link.location.is_some() {
            Some(HyperlinkTargetKind::InlineLocation)
        } else {
            None
        }
    })
}

fn hyperlink_target_kind_str(kind: HyperlinkTargetKind) -> &'static str {
    match kind {
        HyperlinkTargetKind::InlineLocation => "inlineLocation",
        HyperlinkTargetKind::Relationship => "relationship",
    }
}

/// Extract the top-left `(row, col)` position from a typed [`HyperlinkAnchor`].
///
/// Both variants carry [`formula_types::CellRef::Positional`] at
/// classification time (we parsed with no resolver), so the match arms
/// always hit the positional case in practice. `Resolved` is included for
/// exhaustiveness; it would only appear if callers construct an anchor by
/// hand from a resolved `CellRef`, which no import path does.
fn anchor_top_left(anchor: &HyperlinkAnchor) -> Option<(u32, u32)> {
    match anchor {
        HyperlinkAnchor::Cell(node) => match node.reference {
            CellRef::Positional { row, col, .. } => Some((row, col)),
            CellRef::Resolved(_) => None,
        },
        HyperlinkAnchor::Range(range) => match range.start {
            CellRef::Positional { row, col, .. } => Some((row, col)),
            CellRef::Resolved(_) => None,
        },
    }
}

// ===========================================================================
// Sparkline hydration (using yrs_schema::sparkline)
// ===========================================================================

/// Hydrate sparklines using structured Y.Map entries via `yrs_schema::sparkline`.
///
/// Writes three kinds of entries into the sparklines Y.Map:
/// - `{sparkline.id}` → Y.Map of sparkline fields (the sparkline itself)
/// - `idx:{row},{col}` → sparkline ID string (cell index for O(1) lookup)
/// - `group:{group.id}` → Y.Map of group fields (sparkline group)
pub(super) fn hydrate_sparklines(
    txn: &mut yrs::TransactionMut,
    sparklines_map: &MapRef,
    sparklines: &[domain_types::domain::sparkline::Sparkline],
    sparkline_groups: &[domain_types::domain::sparkline::SparklineGroup],
) {
    // Hydrate individual sparklines
    for sparkline in sparklines.iter() {
        let entries = yrs_schema::sparkline::to_yrs_prelim(sparkline);
        let sparkline_prelim: MapPrelim = entries.into_iter().collect();
        sparklines_map.insert(txn, &*sparkline.id, sparkline_prelim);

        // Write cell index for O(1) lookup by position
        let idx_key = format!("idx:{},{}", sparkline.cell.row, sparkline.cell.col);
        sparklines_map.insert(
            txn,
            &*idx_key,
            yrs::Any::String(std::sync::Arc::from(sparkline.id.as_str())),
        );
    }

    // Hydrate sparkline groups
    for group in sparkline_groups.iter() {
        let group_key = format!("group:{}", group.id);
        let entries = yrs_schema::sparkline::group_to_yrs_prelim(group);
        let group_prelim: MapPrelim = entries.into_iter().collect();
        sparklines_map.insert(txn, &*group_key, group_prelim);
    }
}

// ===========================================================================
// Conditional formatting hydration (using yrs_schema::conditional_format)
// ===========================================================================

/// Hydrate conditional formatting rules using structured Y.Map + Y.Array
/// via `yrs_schema::conditional_format`.
///
/// Each ConditionalFormat becomes a Y.Map with top-level fields (ranges, pivot)
/// as native keys and rules stored as a Y.Array of Y.Maps.
pub(super) fn hydrate_conditional_formats(
    txn: &mut yrs::TransactionMut,
    cf_map: &MapRef,
    conditional_formats: &[domain_types::domain::conditional_format::ConditionalFormat],
) {
    use domain_types::yrs_schema::conditional_format as cf_yrs;

    for cf in conditional_formats.iter() {
        // Use the CF's own ID as the Y.Map key so that mutation lookups
        // (which use `cf_map.get(txn, rule_id)`) find the correct entry.
        // Previously this used `cf-{index}` which broke XLSX-parsed rules
        // whose IDs are `cf-parse-{n}` — list/get worked (they iterate
        // values) but update/delete failed with "CF rule not found".
        let key = &cf.id;

        // Write top-level CF fields
        let entries = cf_yrs::cf_to_yrs_prelim(cf);
        let cf_prelim: MapPrelim = entries.into_iter().collect();
        let cf_entry: MapRef = cf_map.insert(txn, key.as_str(), cf_prelim);

        // Write rules as a Y.Array of Y.Maps
        let rules_arr = cf_entry.insert(txn, "rules", yrs::ArrayPrelim::default());
        for rule in &cf.rules {
            let rule_entries = cf_yrs::rule_to_yrs_prelim(rule);
            let rule_prelim: MapPrelim = rule_entries.into_iter().collect();
            rules_arr.push_back(txn, rule_prelim);
        }
    }
}

// ===========================================================================
// Data validation hydration
// ===========================================================================

/// Hydrate data validations into the canonical range-backed validation store.
pub(super) fn hydrate_data_validations(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &cell_types::SheetId,
    meta_map: &MapRef,
    data_validations: &[domain_types::domain::validation::ValidationSpec],
    disable_prompts: bool,
    x_window: Option<u32>,
    y_window: Option<u32>,
    declared_count: Option<u32>,
) {
    if data_validations.is_empty()
        && !disable_prompts
        && x_window.is_none()
        && y_window.is_none()
        && declared_count.is_none()
    {
        return;
    }

    if !data_validations.is_empty() {
        schemas::write_imported_validation_specs(txn, sheets_root, sheet_id, data_validations, "");
    }

    // Store container-level disablePrompts flag for round-trip fidelity
    if disable_prompts {
        meta_map.insert(txn, "dvDisablePrompts", true);
    }
    // Store container-level xWindow/yWindow for round-trip fidelity
    if let Some(x) = x_window {
        meta_map.insert(txn, "dvXWindow", x as i64);
    }
    if let Some(y) = y_window {
        meta_map.insert(txn, "dvYWindow", y as i64);
    }
    // File-format container metadata; runtime validation edits clear this key.
    if let Some(count) = declared_count {
        meta_map.insert(txn, "dvDeclaredCount", count as i64);
    }
}

pub(super) fn hydrate_x14_data_validations(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &cell_types::SheetId,
    meta_map: &MapRef,
    data_validations: &[domain_types::domain::validation::ValidationSpec],
    disable_prompts: bool,
    x_window: Option<u32>,
    y_window: Option<u32>,
    declared_count: Option<u32>,
) {
    if data_validations.is_empty()
        && !disable_prompts
        && x_window.is_none()
        && y_window.is_none()
        && declared_count.is_none()
    {
        return;
    }

    if !data_validations.is_empty() {
        schemas::write_imported_validation_specs(
            txn,
            sheets_root,
            sheet_id,
            data_validations,
            "x14-",
        );
    }

    let _ = (
        meta_map,
        disable_prompts,
        x_window,
        y_window,
        declared_count,
    );
}

// ===========================================================================
// Filter hydration (AutoFilter → FilterState conversion + typed AutoFilter store)
// ===========================================================================

/// Hydrate auto filter by:
///
/// 1. Writing the lossless typed `AutoFilter` under
///    `properties/autoFilter` (the canonical XLSX-round-trip shape).
/// 2. Converting to a runtime `FilterState` and writing it to the
///    `filters` sub-map — this is the UI/runtime view, NOT a duplicate
///    of (1). The two shapes coexist intentionally: AutoFilter is the
///    XLSX-on-disk form, FilterState is runtime state with cell-id
///    resolution; the lossy conversion between them would silently drop
///    CT_AutoFilter fields (calendarType, filterVal, Dynamic ISO values,
///    Color dxfId, Icon, hidden/show button attrs) on export.
pub(super) fn hydrate_auto_filter(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    filters_map: &MapRef,
    pos_map: &PositionMap,
    auto_filter: &Option<domain_types::domain::filter::AutoFilter>,
) {
    use domain_types::domain::filter::auto_filter_to_filter_state;

    let Some(af) = auto_filter else { return };

    // (1) Lossless typed AutoFilter under properties/autoFilter.
    let af_prelim: MapPrelim = yrs_schema::auto_filter::to_yrs_prelim(af)
        .into_iter()
        .collect();
    meta_map.insert(txn, "autoFilter", af_prelim);

    // (2) Runtime FilterState (drives UI filter evaluation). Lossy vs (1).
    let cell_id_resolver =
        |row: u32, col: u32| -> Option<String> { pos_map.get(&(row, col)).cloned() };
    if let Some(filter_state) = auto_filter_to_filter_state(af, &cell_id_resolver) {
        crate::storage::sheet::filters::write_filter_state_to_ymap(filters_map, txn, &filter_state);
    }
}

/// Hydrate the standalone worksheet-level `<sortState>` into the sheet
/// properties map. This preserves the typed OOXML edge object only; it does not
/// synthesize runtime filter sorting state.
pub(super) fn hydrate_sort_state(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    sort_state: &Option<domain_types::domain::filter::SortState>,
) {
    let Some(sort_state) = sort_state else {
        return;
    };

    let sort_prelim: MapPrelim = yrs_schema::sort_state::to_yrs_prelim(sort_state)
        .into_iter()
        .collect();
    meta_map.insert(txn, yrs_schema::sort_state::PROPERTY_KEY, sort_prelim);
}

// ===========================================================================
// Outline group hydration (via domain grouping config)
// ===========================================================================

/// Hydrate outline groups into the grouping Y.Map using the structured
/// `SheetGroupingConfig` format.
///
/// Converts legacy `OutlineGroup` slices (from XLSX parse) into a full
/// `SheetGroupingConfig` (including outline properties like
/// summaryRowsBelow / summaryColumnsRight) and writes it via
/// `config_to_yrs_map`, which is the canonical storage format used by
/// the grouping CRUD module.
pub(super) fn hydrate_outline_groups(
    txn: &mut yrs::TransactionMut,
    grouping_map: &MapRef,
    outline_groups: &[domain_types::domain::outline::OutlineGroup],
    outline_properties: Option<&ooxml_types::worksheet::OutlineProperties>,
    sheet_id: &str,
) {
    let config = domain_types::domain::grouping::outline_groups_to_grouping_config(
        outline_groups,
        sheet_id,
        outline_properties,
    );
    crate::storage::sheet::grouping::config_to_yrs_map(grouping_map, txn, &config);
}

// ===========================================================================
// Floating object hydration (using yrs_schema::floating_object)
// ===========================================================================

/// Hydrate floating objects using structured Y.Map entries via
/// `yrs_schema::floating_object`.
pub(super) struct FloatingObjectHydrationMaps<'a> {
    pub(super) floating_objects: &'a MapRef,
    pub(super) floating_object_order: &'a yrs::ArrayRef,
    pub(super) cells: &'a MapRef,
}

pub(super) fn hydrate_floating_objects(
    txn: &mut yrs::TransactionMut,
    maps: FloatingObjectHydrationMaps<'_>,
    pos_map: &mut PositionMap,
    sheet_id: &cell_types::SheetId,
    objects: &[domain_types::domain::floating_object::FloatingObject],
    allocator: &mut impl IdAllocator,
) {
    for obj in objects.iter() {
        let mut obj = obj.clone();
        obj.common.sheet_id = sheet_id.to_uuid_string();
        obj.common.id = sheet_unique_floating_object_id(&obj.common.id, sheet_id);
        normalize_form_control_references_for_hydration(
            &mut obj, maps.cells, pos_map, txn, allocator,
        );
        let anchor = &obj.common.anchor;
        let anchor_hex = get_or_create_cell_id_for_pos(
            maps.cells,
            pos_map,
            txn,
            anchor.anchor_row,
            anchor.anchor_col,
            allocator,
        );
        obj.common.anchor_cell_id.get_or_insert(anchor_hex);
        if let (Some(end_row), Some(end_col)) = (anchor.end_row, anchor.end_col) {
            let to_anchor_hex = get_or_create_cell_id_for_pos(
                maps.cells, pos_map, txn, end_row, end_col, allocator,
            );
            obj.common.to_anchor_cell_id.get_or_insert(to_anchor_hex);
        }
        // Use the object's own ID as the Y.Map key so that get-by-ID lookups
        // (which use `map.get(txn, object_id)`) find the correct entry.
        // Previously this used `fobj-{index}` which only accidentally matched
        // pictures/shapes (whose IDs are also `fobj-{index}`) but broke charts,
        // form controls, connectors, and OLE objects. Parser-local object IDs
        // are sheet-qualified here so document-wide caches never collide across
        // sheets.
        let key = &obj.common.id;
        let entries = yrs_schema::floating_object::to_yrs_prelim(&obj);
        let obj_prelim: MapPrelim = entries.into_iter().collect();
        maps.floating_objects.insert(txn, key.as_str(), obj_prelim);
        maps.floating_object_order
            .push_back(txn, Any::String(Arc::from(key.as_str())));
    }
}

fn sheet_unique_floating_object_id(id: &str, sheet_id: &cell_types::SheetId) -> String {
    if is_parser_local_floating_object_id(id) {
        format!("{}-{}", id, sheet_id.to_uuid_string())
    } else {
        id.to_string()
    }
}

fn is_parser_local_floating_object_id(id: &str) -> bool {
    let suffix = if let Some(rest) = id.strip_prefix("fobj-fc-") {
        rest
    } else if let Some(rest) = id.strip_prefix("fobj-ole-") {
        rest
    } else if let Some(rest) = id.strip_prefix("fobj-conn-") {
        rest
    } else if let Some(rest) = id.strip_prefix("chart-import-") {
        rest
    } else if let Some(rest) = id.strip_prefix("fobj-") {
        rest
    } else {
        return false;
    };
    !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit())
}

// NOTE: The old `hydrate_slicers` function (which stored JSON blobs in
// per-sheet floatingObjects) has been removed.  Slicers are now hydrated
// at workbook level by `hydrate_workbook_slicers`, which converts the old
// ParseOutput transport types to `StoredSlicer` and writes them to the
// workbook `KEY_SLICERS` Y.Map.

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellValue;
    use yrs::{Doc, Map, Transact};

    fn cell(row: u32, col: u32, value: CellValue) -> CellData {
        CellData {
            row,
            col,
            value,
            ..CellData::default()
        }
    }

    #[test]
    fn ranged_value_cells_stay_out_of_pos_map_and_yrs_cells() {
        let doc = Doc::new();
        let cells_map = doc.get_or_insert_map("cells");
        let mut txn = doc.transact_mut();
        let cells = vec![cell(0, 0, CellValue::from(1.0))];
        let cell_ids = vec![CellId::from_raw(1)];
        let ranged_positions = std::collections::HashSet::from([(0, 0)]);

        let range_style_positions = std::collections::HashSet::new();
        let pos_map = hydrate_cells_with_ids(
            &mut txn,
            &cells_map,
            &cells,
            &cell_ids,
            &ranged_positions,
            &range_style_positions,
        );

        assert!(pos_map.is_empty());
        assert_eq!(cells_map.len(&txn), 0);
    }

    #[test]
    fn ranged_styled_cells_keep_explicit_identity_for_style_hydration() {
        let doc = Doc::new();
        let cells_map = doc.get_or_insert_map("cells");
        let mut txn = doc.transact_mut();
        let mut styled = cell(4, 2, CellValue::from(9.0));
        styled.style_id = Some(7);
        let cells = vec![styled];
        let cell_ids = vec![CellId::from_raw(0xA)];
        let ranged_positions = std::collections::HashSet::from([(4, 2)]);

        let range_style_positions = std::collections::HashSet::new();
        let pos_map = hydrate_cells_with_ids(
            &mut txn,
            &cells_map,
            &cells,
            &cell_ids,
            &ranged_positions,
            &range_style_positions,
        );

        assert_eq!(pos_map.get(&(4, 2)), Some(&id_to_hex(0xA).to_string()));
        assert_eq!(cells_map.len(&txn), 0);
    }

    #[test]
    fn parser_local_floating_object_ids_are_sheet_unique() {
        let sheet_id = cell_types::SheetId::from_raw(0x12);

        assert_eq!(
            sheet_unique_floating_object_id("fobj-0", &sheet_id),
            format!("fobj-0-{}", sheet_id.to_uuid_string())
        );
        assert_eq!(
            sheet_unique_floating_object_id("fobj-fc-4", &sheet_id),
            format!("fobj-fc-4-{}", sheet_id.to_uuid_string())
        );
        assert_eq!(
            sheet_unique_floating_object_id("chart-import-0", &sheet_id),
            format!("chart-import-0-{}", sheet_id.to_uuid_string())
        );
    }

    #[test]
    fn globally_unique_floating_object_ids_are_preserved() {
        let sheet_id = cell_types::SheetId::from_raw(0x12);

        assert_eq!(
            sheet_unique_floating_object_id("fobj-1780000000000-a", &sheet_id),
            "fobj-1780000000000-a"
        );
        assert_eq!(
            sheet_unique_floating_object_id("chart-import-alpha", &sheet_id),
            "chart-import-alpha"
        );
    }
}
