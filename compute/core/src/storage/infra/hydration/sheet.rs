use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use yrs::{Any, Array, ArrayPrelim, ArrayRef, Map, MapPrelim, MapRef, Out};

use domain_types::yrs_schema;
use domain_types::{DocumentFormat, SheetData};

use compute_document::hex::{SmallHex, id_to_hex};
use compute_document::schema::*;

use cell_types::{CellId, ColId, RowId, SheetId};
use value_types::ComputeError;

use super::AnchoredCellIdentity;
use super::IdAllocator;
use super::features::{
    hydrate_auto_filter, hydrate_cells, hydrate_cells_with_ids, hydrate_col_widths,
    hydrate_comments, hydrate_conditional_formats, hydrate_data_validations,
    hydrate_floating_objects, hydrate_hidden_rows_cols, hydrate_hyperlinks, hydrate_merges,
    hydrate_outline_groups, hydrate_row_heights, hydrate_sort_state, hydrate_sparklines,
    hydrate_x14_data_validations,
};
use super::styles::{
    ImportedRangeStyle, hydrate_authored_style_runs, hydrate_cell_styles, hydrate_col_styles,
    hydrate_imported_range_styles, hydrate_row_styles,
};
use super::view::{
    hydrate_frozen_pane, hydrate_hf_images, hydrate_page_breaks, hydrate_print_settings,
    hydrate_sheet_protection, hydrate_view_options,
};
use crate::import::parse_output_to_snapshot::anchor_collection::collect_identity_required_anchors;

fn mirror_pos_map_into_grid_index(
    txn: &mut yrs::TransactionMut,
    pos_to_id: &MapRef,
    id_to_pos: &MapRef,
    pos_map: &HashMap<String, String>,
    row_id_hexes: &[SmallHex],
    col_id_hexes: &[SmallHex],
    required_positions: &HashSet<(u32, u32)>,
) -> Result<(), ComputeError> {
    for (pos_key, cell_hex) in pos_map {
        let Some((row_str, col_str)) = pos_key.split_once(':') else {
            continue;
        };
        let Ok(row) = row_str.parse::<usize>() else {
            continue;
        };
        let Ok(col) = col_str.parse::<usize>() else {
            continue;
        };
        let (Some(rh), Some(ch)) = (row_id_hexes.get(row), col_id_hexes.get(col)) else {
            if required_positions.contains(&(row as u32, col as u32)) {
                return Err(ComputeError::Deserialize {
                    message: format!(
                        "metadata anchor identity at row {row} col {col} is missing row/col identity"
                    ),
                });
            }
            continue;
        };
        let yrs_pos_key = format!("{}:{}", rh, ch);
        pos_to_id.insert(
            txn,
            yrs_pos_key.as_str(),
            Any::String(Arc::from(cell_hex.as_str())),
        );
        id_to_pos.insert(
            txn,
            cell_hex.as_str(),
            Any::String(Arc::from(yrs_pos_key.as_str())),
        );
    }
    Ok(())
}

fn cell_keeps_import_identity(cell: &domain_types::CellData) -> bool {
    cell.formula.is_some()
        || !cell.value.is_null()
        || cell.style_id.is_some()
        || cell.cm
        || cell.vm.is_some()
        || cell.formula_result_type.is_some()
        || cell.has_empty_cached_value
        || cell.original_sst_index.is_some()
        || cell.original_value.is_some()
}

fn sheet_identity_extent(sheet: &SheetData) -> (u32, u32) {
    let mut rows = sheet.rows;
    let mut cols = sheet.cols;

    for cell in &sheet.cells {
        rows = rows.max(cell.row.saturating_add(1));
        cols = cols.max(cell.col.saturating_add(1));
    }

    for &(row, col) in collect_identity_required_anchors(sheet).keys() {
        rows = rows.max(row.saturating_add(1));
        cols = cols.max(col.saturating_add(1));
    }

    (rows, cols)
}

fn sheet_color_to_hex(color: &ooxml_types::styles::ColorDef) -> Option<String> {
    match color {
        ooxml_types::styles::ColorDef::Rgb { val, .. } => {
            let rgb = val.strip_prefix("FF").unwrap_or(val);
            Some(format!("#{rgb}"))
        }
        ooxml_types::styles::ColorDef::Indexed { .. }
        | ooxml_types::styles::ColorDef::Theme { .. }
        | ooxml_types::styles::ColorDef::Auto { .. } => None,
    }
}

fn hydrate_worksheet_semantic_containers(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    containers: &domain_types::WorksheetSemanticContainers,
) {
    if containers.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(containers) {
        meta_map.insert(
            txn,
            "worksheetSemanticContainers",
            Any::String(Arc::from(json.as_str())),
        );
    }
}

fn allocate_anchored_identities(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
) -> Vec<AnchoredCellIdentity> {
    let occupied: HashSet<(u32, u32)> = sheet
        .cells
        .iter()
        .filter(|cell| cell_keeps_import_identity(cell))
        .map(|cell| (cell.row, cell.col))
        .collect();
    let anchors = collect_identity_required_anchors(sheet);
    let mut positions: Vec<(u32, u32)> = anchors.keys().copied().collect();
    positions.sort_unstable();

    positions
        .into_iter()
        .filter(|pos| !occupied.contains(pos))
        .filter_map(|(row, col)| {
            let reasons = anchors.get(&(row, col))?.clone();
            Some(AnchoredCellIdentity {
                cell_id: allocator.alloc_cell_id(),
                row,
                col,
                reasons,
            })
        })
        .collect()
}

fn allocate_missing_anchored_identities(
    sheet: &SheetData,
    pos_map: &HashMap<String, String>,
    allocator: &mut impl IdAllocator,
) -> Vec<AnchoredCellIdentity> {
    let anchors = collect_identity_required_anchors(sheet);
    let mut positions: Vec<(u32, u32)> = anchors.keys().copied().collect();
    positions.sort_unstable();

    positions
        .into_iter()
        .filter(|(row, col)| !pos_map.contains_key(&format!("{}:{}", row, col)))
        .filter_map(|(row, col)| {
            let reasons = anchors.get(&(row, col))?.clone();
            Some(AnchoredCellIdentity {
                cell_id: allocator.alloc_cell_id(),
                row,
                col,
                reasons,
            })
        })
        .collect()
}

fn insert_missing_anchored_identities(
    pos_map: &mut HashMap<String, String>,
    identities: &[AnchoredCellIdentity],
) -> Vec<(CellId, u32, u32)> {
    let mut inserted = Vec::new();
    for identity in identities {
        debug_assert!(!identity.reasons.is_empty());
        let pos_key = format!("{}:{}", identity.row, identity.col);
        if pos_map.contains_key(&pos_key) {
            continue;
        }
        let cell_hex = id_to_hex(identity.cell_id.as_u128()).to_string();
        pos_map.insert(pos_key, cell_hex);
        inserted.push((identity.cell_id, identity.row, identity.col));
    }
    inserted
}

// ===========================================================================
// Pre-allocation (Phase: Range-before-Yrs)
// ===========================================================================

/// Pre-allocated IDs for a single sheet, computed before any Yrs writes.
///
/// This allows the Range classifier to run between ID allocation and Yrs
/// hydration, so that ranged cells can be skipped during per-cell Yrs writes.
pub(crate) struct SheetIdAllocation {
    pub sheet_id: SheetId,
    pub sheet_hex: SmallHex,
    pub row_ids: Vec<RowId>,
    pub row_id_hexes: Vec<SmallHex>,
    pub col_ids: Vec<ColId>,
    pub col_id_hexes: Vec<SmallHex>,
    pub cell_ids: Vec<CellId>,
    pub identity_only_cells: Vec<AnchoredCellIdentity>,
}

/// Allocate all IDs for a sheet without performing any Yrs writes.
///
/// Allocation order is deterministic: SheetId, then RowIds (one per row),
/// then ColIds (one per col), then CellIds (one per cell in `sheet.cells`).
/// This matches the allocation order in `hydrate_sheet` so that the same
/// allocator seed produces identical IDs.
pub(crate) fn allocate_sheet_ids(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
) -> SheetIdAllocation {
    // 1. SheetId
    let sheet_id = allocator.alloc_sheet_id();
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    let (identity_rows, identity_cols) = sheet_identity_extent(sheet);

    // 2. RowIds
    let mut row_ids = Vec::with_capacity(identity_rows as usize);
    let mut row_id_hexes = Vec::with_capacity(identity_rows as usize);
    for _ in 0..identity_rows {
        let rid = allocator.alloc_row_id();
        row_id_hexes.push(id_to_hex(rid.as_u128()));
        row_ids.push(rid);
    }

    // 3. ColIds
    let mut col_ids = Vec::with_capacity(identity_cols as usize);
    let mut col_id_hexes = Vec::with_capacity(identity_cols as usize);
    for _ in 0..identity_cols {
        let cid = allocator.alloc_col_id();
        col_id_hexes.push(id_to_hex(cid.as_u128()));
        col_ids.push(cid);
    }

    // 4. CellIds (one per cell in sheet.cells)
    let mut cell_ids = Vec::with_capacity(sheet.cells.len());
    for _ in &sheet.cells {
        cell_ids.push(allocator.alloc_cell_id());
    }

    let identity_only_cells = allocate_anchored_identities(sheet, allocator);

    SheetIdAllocation {
        sheet_id,
        sheet_hex,
        row_ids,
        row_id_hexes,
        col_ids,
        col_id_hexes,
        cell_ids,
        identity_only_cells,
    }
}

/// Like `allocate_sheet_ids` but uses a pre-assigned SheetId when provided.
/// Used by deferred hydration to maintain stable sheet IDs between fast
/// and full paths.
pub(crate) fn allocate_sheet_ids_with_sheet_id(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
    fixed_sheet_id: Option<SheetId>,
) -> SheetIdAllocation {
    let sheet_id = match fixed_sheet_id {
        Some(id) => {
            // Consume the allocator's SheetId slot to keep counter in sync
            let _ = allocator.alloc_sheet_id();
            id
        }
        None => allocator.alloc_sheet_id(),
    };
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    let (identity_rows, identity_cols) = sheet_identity_extent(sheet);

    let mut row_ids = Vec::with_capacity(identity_rows as usize);
    let mut row_id_hexes = Vec::with_capacity(identity_rows as usize);
    for _ in 0..identity_rows {
        let rid = allocator.alloc_row_id();
        row_id_hexes.push(id_to_hex(rid.as_u128()));
        row_ids.push(rid);
    }

    let mut col_ids = Vec::with_capacity(identity_cols as usize);
    let mut col_id_hexes = Vec::with_capacity(identity_cols as usize);
    for _ in 0..identity_cols {
        let cid = allocator.alloc_col_id();
        col_id_hexes.push(id_to_hex(cid.as_u128()));
        col_ids.push(cid);
    }

    let mut cell_ids = Vec::with_capacity(sheet.cells.len());
    for _ in &sheet.cells {
        cell_ids.push(allocator.alloc_cell_id());
    }

    let identity_only_cells = allocate_anchored_identities(sheet, allocator);

    SheetIdAllocation {
        sheet_id,
        sheet_hex,
        row_ids,
        row_id_hexes,
        col_ids,
        col_id_hexes,
        cell_ids,
        identity_only_cells,
    }
}

// ===========================================================================
// Per-sheet hydration
// ===========================================================================

/// Hydrate a single sheet from `SheetData` into the Yrs document.
#[allow(clippy::type_complexity)]
pub(crate) fn hydrate_sheet(
    txn: &mut yrs::TransactionMut,
    sheets_map: &MapRef,
    order_arr: &yrs::ArrayRef,
    sheet: &SheetData,
    style_palette: &[DocumentFormat],
    persons: &[domain_types::domain::comment::PersonInfo],
    allocator: &mut impl IdAllocator,
) -> Result<
    (
        SheetId,
        Vec<CellId>,
        Vec<(CellId, u32, u32)>,
        Vec<(CellId, u32, u32)>,
        Vec<RowId>,
        Vec<ColId>,
    ),
    ComputeError,
> {
    // 1. Allocate SheetId
    let sheet_id = allocator.alloc_sheet_id();
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    // Append sheet id to order array
    order_arr.push_back(txn, Any::String(Arc::from(sheet_hex.as_str())));

    // 2. Create per-sheet map
    let sheet_map_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let sheet_map: MapRef = sheets_map.insert(txn, &*sheet_hex, sheet_map_prelim);

    // 3. Meta map
    let meta_prelim = MapPrelim::from([
        (KEY_NAME, Any::String(Arc::from(sheet.name.as_str()))),
        (KEY_ROWS, Any::Number(sheet.rows as f64)),
        (KEY_COLS, Any::Number(sheet.cols as f64)),
    ]);
    sheet_map.insert(txn, KEY_PROPERTIES, meta_prelim);

    let meta_map: MapRef = match sheet_map.get(txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        // SAFETY: meta map was inserted via `insert_map_prelim` on the line above;
        // Yrs guarantees the key is present immediately after transactional insert.
        _ => unreachable!("meta map was just inserted"),
    };

    // Store sheet visibility (hidden/veryHidden state)
    match sheet.visibility {
        domain_types::SheetState::Hidden => {
            meta_map.insert(txn, "hidden", Any::Bool(true));
        }
        domain_types::SheetState::VeryHidden => {
            meta_map.insert(txn, "hidden", Any::Bool(true));
            meta_map.insert(txn, "veryHidden", Any::Bool(true));
        }
        domain_types::SheetState::Visible => {}
    }

    // Store original sheetId for round-trip fidelity
    if let Some(original_sheet_id) = sheet.sheet_id {
        meta_map.insert(
            txn,
            "originalSheetId",
            Any::Number(original_sheet_id as f64),
        );
    }

    // Store sheet uid (xr:uid) for round-trip fidelity
    if let Some(ref uid) = sheet.uid {
        meta_map.insert(txn, "sheetUid", Any::String(Arc::from(uid.as_str())));
    }
    if let Some(properties) = &sheet.sheet_properties {
        yrs_schema::sheet_properties::insert(txn, &meta_map, properties);
        if let Some(color) = properties.tab_color.as_ref().and_then(sheet_color_to_hex) {
            meta_map.insert(txn, "tabColor", Any::String(Arc::from(color.as_str())));
        }
    }

    // 4. Cells map
    let cells_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let cells_map: MapRef = sheet_map.insert(txn, KEY_CELLS, cells_prelim);

    // 5. Grid index (posToId / idToPos) — authoritative yrs-side identity
    // store post-R51. Populated after `hydrate_cells` below so that the
    // yrs doc carries position info for CRDT sync and for
    // `build_sheet_snapshot_from_yrs` bootstrap.
    let gi_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let gi_map: MapRef = sheet_map.insert(txn, KEY_GRID_INDEX, gi_prelim);
    let p2i_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let pos_to_id: MapRef = gi_map.insert(txn, "posToId", p2i_prelim);
    let i2p_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let id_to_pos: MapRef = gi_map.insert(txn, "idToPos", i2p_prelim);

    // 6. Row/Col order YArrays (eagerly populated with IDs for all rows/columns)
    //    Uses insert_range for O(n) bulk insertion instead of O(n²) push_back loop.
    let row_order: ArrayRef = sheet_map.insert(txn, KEY_ROW_ORDER, ArrayPrelim::default());
    let col_order: ArrayRef = sheet_map.insert(txn, KEY_COL_ORDER, ArrayPrelim::default());

    // Pre-allocate all RowIds, then bulk-insert into YArray
    let (identity_rows, identity_cols) = sheet_identity_extent(sheet);

    let mut row_ids: Vec<RowId> = Vec::with_capacity(identity_rows as usize);
    let mut row_id_hexes: Vec<SmallHex> = Vec::with_capacity(identity_rows as usize);
    for _r in 0..identity_rows {
        let rid = allocator.alloc_row_id();
        row_ids.push(rid);
        row_id_hexes.push(id_to_hex(rid.as_u128()));
    }
    row_order.insert_range(
        txn,
        0,
        row_id_hexes
            .iter()
            .map(|h| Any::String(Arc::from(h.as_str()))),
    );

    let mut col_ids: Vec<ColId> = Vec::with_capacity(identity_cols as usize);
    let mut col_id_hexes: Vec<SmallHex> = Vec::with_capacity(identity_cols as usize);
    for _c in 0..identity_cols {
        let cid = allocator.alloc_col_id();
        col_ids.push(cid);
        col_id_hexes.push(id_to_hex(cid.as_u128()));
    }
    col_order.insert_range(
        txn,
        0,
        col_id_hexes
            .iter()
            .map(|h| Any::String(Arc::from(h.as_str()))),
    );

    // Keep legacy maps for backward compat while newer readers migrate away.
    let row_reg_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, "rows", row_reg_prelim);
    let col_reg_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, "cols", col_reg_prelim);
    let row_idx_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, "rowIndex", row_idx_prelim);
    let col_idx_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, "colIndex", col_idx_prelim);

    // 7. Populate cells. `pos_map` is keyed "row:col" -> cell_hex.
    // Phantom entries (merges/comments/hyperlinks) are added below; we mirror
    // `pos_map` into `gridIndex/{posToId,idToPos}` at the very end of this
    // function so all phantom entries are captured.
    let (cell_ids, mut pos_map) = hydrate_cells(txn, &cells_map, &sheet.cells, allocator);

    // 8. Create remaining per-sheet sub-maps
    let properties_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_CELL_PROPERTIES, properties_prelim);

    let row_heights_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let row_heights_map: MapRef = sheet_map.insert(txn, KEY_ROW_HEIGHTS, row_heights_prelim);

    let col_widths_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let col_widths_map: MapRef = sheet_map.insert(txn, KEY_COL_WIDTHS, col_widths_prelim);

    let schemas_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_SCHEMAS, schemas_prelim);

    let pivots_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_PIVOT_TABLES, pivots_prelim);

    let merges_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let merges_map: MapRef = sheet_map.insert(txn, KEY_MERGES, merges_prelim);

    let manual_hidden_rows_map: MapRef = sheet_map.insert(
        txn,
        KEY_MANUAL_HIDDEN_ROWS,
        MapPrelim::from([] as [(&str, Any); 0]),
    );
    sheet_map.insert(
        txn,
        KEY_FILTER_HIDDEN_ROWS,
        MapPrelim::from([] as [(&str, Any); 0]),
    );

    let hidden_rows_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let hidden_rows_map: MapRef = sheet_map.insert(txn, KEY_HIDDEN_ROWS, hidden_rows_prelim);

    let hidden_cols_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let hidden_cols_map: MapRef = sheet_map.insert(txn, KEY_HIDDEN_COLS, hidden_cols_prelim);

    let row_formats_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let row_formats_map: MapRef = sheet_map.insert(txn, KEY_ROW_FORMATS, row_formats_prelim);

    let col_formats_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let col_formats_map: MapRef = sheet_map.insert(txn, KEY_COL_FORMATS, col_formats_prelim);

    let comments_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let comments_map: MapRef = sheet_map.insert(txn, KEY_COMMENTS, comments_prelim);

    let filters_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let filters_map: MapRef = sheet_map.insert(txn, KEY_FILTERS, filters_prelim);

    let sparklines_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let sparklines_map: MapRef = sheet_map.insert(txn, KEY_SPARKLINES, sparklines_prelim);

    let cf_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let cf_map: MapRef = sheet_map.insert(txn, KEY_CONDITIONAL_FORMAT, cf_prelim);

    // cfRules: per-sheet shared CF rule body store (Phase 5C).
    let cf_rules_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_CF_RULES, cf_rules_prelim);

    let bindings_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_BINDINGS, bindings_prelim);

    let grouping_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let grouping_map: MapRef = sheet_map.insert(txn, KEY_GROUPING, grouping_prelim);

    let sorting_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_SORTING, sorting_prelim);

    let floating_objects_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let floating_objects_map: MapRef =
        sheet_map.insert(txn, KEY_FLOATING_OBJECTS, floating_objects_prelim);

    let floating_groups_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_FLOATING_OBJECT_GROUPS, floating_groups_prelim);

    // Range sub-maps (ranges, rangePayloads, rangeFormats, rangeBindings) are
    // created by init_canonical_schema — no duplicate creation here to avoid
    // extra Yrs observer events during undo/redo.

    // =====================================================================
    // Populate domain data into Yrs maps (using yrs_schema modules)
    // =====================================================================

    // --- Merges (yrs_schema::merge) ---
    hydrate_merges(
        txn,
        &merges_map,
        &cells_map,
        &mut pos_map,
        &sheet.merges,
        allocator,
    );

    // --- Row heights and Col widths ---
    // Store in canonical OOXML units: row heights in points, column widths in
    // character-width units. The LayoutIndex converts to pixels on construction.
    let sheet_default_row_height_pt = sheet.dimensions.default_row_height.unwrap_or(15.0);
    let default_col_width_cw = sheet.dimensions.default_col_width.unwrap_or(8.43);

    hydrate_row_heights(
        txn,
        &row_heights_map,
        &row_id_hexes,
        &sheet.dimensions.row_heights,
        sheet_default_row_height_pt,
    );
    hydrate_col_widths(
        txn,
        &col_widths_map,
        &col_id_hexes,
        &sheet.dimensions.col_widths,
        default_col_width_cw,
    );

    // --- Default row height, col width, and row descent (into meta map) ---
    // Stored in canonical OOXML units (points / char-width).
    if (sheet_default_row_height_pt - 15.0).abs() > 0.01 {
        meta_map.insert(
            txn,
            "defaultRowHeight",
            Any::Number(sheet_default_row_height_pt),
        );
    }
    if sheet.dimensions.default_col_width.is_some() {
        meta_map.insert(txn, "defaultColWidth", Any::Number(default_col_width_cw));
    }
    if let Some(bcw) = sheet.dimensions.base_col_width {
        meta_map.insert(txn, "baseColWidth", Any::Number(bcw as f64));
    }
    if let Some(descent) = sheet.dimensions.default_row_descent {
        meta_map.insert(txn, "defaultRowDescent", Any::Number(descent));
    }
    if sheet.dimensions.custom_height {
        meta_map.insert(txn, "customHeight", Any::Bool(true));
    }
    if sheet.dimensions.zero_height {
        meta_map.insert(txn, "zeroHeight", Any::Bool(true));
    }
    if let Some(olr) = sheet.dimensions.outline_level_row {
        meta_map.insert(txn, "outlineLevelRow", Any::Number(olr as f64));
    }
    if let Some(olc) = sheet.dimensions.outline_level_col {
        meta_map.insert(txn, "outlineLevelCol", Any::Number(olc as f64));
    }

    // --- Column bestFit flags (into meta map as JSON array) ---
    let best_fit_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.best_fit)
        .map(|c| c.col)
        .collect();
    if !best_fit_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&best_fit_cols)
    {
        meta_map.insert(txn, "colBestFit", Any::String(Arc::from(json)));
    }

    // --- Column customWidth flags (into meta map as JSON array) ---
    let custom_width_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.custom_width)
        .map(|c| c.col)
        .collect();
    if !custom_width_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_width_cols)
    {
        meta_map.insert(txn, "colCustomWidth", Any::String(Arc::from(json)));
    }

    // --- Column collapsed flags (into meta map as JSON array) ---
    let collapsed_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.collapsed)
        .map(|c| c.col)
        .collect();
    if !collapsed_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&collapsed_cols)
    {
        meta_map.insert(txn, "colCollapsed", Any::String(Arc::from(json)));
    }

    // --- Trailing column ranges (for round-trip fidelity) ---
    // Ranges like <col max="16384"> that extend beyond the data region.
    if !sheet.dimensions.trailing_col_ranges.is_empty()
        && let Ok(json) = serde_json::to_string(&sheet.dimensions.trailing_col_ranges)
    {
        meta_map.insert(txn, "trailingColRanges", Any::String(Arc::from(json)));
    }

    // --- Row customHeight flags (into meta map as JSON array) ---
    let custom_height_rows: Vec<u32> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| r.custom_height)
        .map(|r| r.row)
        .collect();
    if !custom_height_rows.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_height_rows)
    {
        meta_map.insert(txn, "rowCustomHeight", Any::String(Arc::from(json)));
    }

    // --- Row customFormat flags (into meta map as JSON array) ---
    let custom_format_rows: Vec<u32> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| r.custom_format)
        .map(|r| r.row)
        .collect();
    if !custom_format_rows.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_format_rows)
    {
        meta_map.insert(txn, "rowCustomFormat", Any::String(Arc::from(json)));
    }

    // --- Per-row descent values (into meta map as JSON object) ---
    // Rows with a non-default descent need explicit storage for round-trip fidelity.
    let row_descents: Vec<(u32, f64)> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter_map(|r| r.descent.map(|d| (r.row, d)))
        .collect();
    if !row_descents.is_empty()
        && let Ok(json) = serde_json::to_string(&row_descents)
    {
        meta_map.insert(txn, "rowDescents", Any::String(Arc::from(json)));
    }

    let row_metadata: Vec<&domain_types::RowDimension> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| {
            r.explicit_hidden
                || r.outline_level.is_some()
                || r.explicit_outline_level_zero
                || r.collapsed.is_some()
                || r.thick_top
                || r.thick_bot
                || !r.xml_hints.is_empty()
        })
        .collect();
    if !row_metadata.is_empty() {
        let row_outline_levels: Vec<(u32, u8)> = row_metadata
            .iter()
            .filter_map(|r| r.outline_level.map(|level| (r.row, level)))
            .collect();
        if !row_outline_levels.is_empty()
            && let Ok(json) = serde_json::to_string(&row_outline_levels)
        {
            meta_map.insert(txn, "rowOutlineLevels", Any::String(Arc::from(json)));
        }
        let row_explicit_hidden: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.explicit_hidden)
            .map(|r| r.row)
            .collect();
        if !row_explicit_hidden.is_empty()
            && let Ok(json) = serde_json::to_string(&row_explicit_hidden)
        {
            meta_map.insert(txn, "rowExplicitHidden", Any::String(Arc::from(json)));
        }
        let row_explicit_outline_zero: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.explicit_outline_level_zero)
            .map(|r| r.row)
            .collect();
        if !row_explicit_outline_zero.is_empty()
            && let Ok(json) = serde_json::to_string(&row_explicit_outline_zero)
        {
            meta_map.insert(
                txn,
                "rowExplicitOutlineLevelZero",
                Any::String(Arc::from(json)),
            );
        }
        let row_collapsed: Vec<(u32, bool)> = row_metadata
            .iter()
            .filter_map(|r| r.collapsed.map(|collapsed| (r.row, collapsed)))
            .collect();
        if !row_collapsed.is_empty()
            && let Ok(json) = serde_json::to_string(&row_collapsed)
        {
            meta_map.insert(txn, "rowCollapsed", Any::String(Arc::from(json)));
        }
        let row_thick_top: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.thick_top)
            .map(|r| r.row)
            .collect();
        if !row_thick_top.is_empty()
            && let Ok(json) = serde_json::to_string(&row_thick_top)
        {
            meta_map.insert(txn, "rowThickTop", Any::String(Arc::from(json)));
        }
        let row_thick_bot: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.thick_bot)
            .map(|r| r.row)
            .collect();
        if !row_thick_bot.is_empty()
            && let Ok(json) = serde_json::to_string(&row_thick_bot)
        {
            meta_map.insert(txn, "rowThickBot", Any::String(Arc::from(json)));
        }
        let row_spans: Vec<(u32, String)> = row_metadata
            .iter()
            .filter_map(|r| {
                r.xml_hints
                    .spans
                    .as_ref()
                    .map(|spans| (r.row, spans.clone()))
            })
            .collect();
        if !row_spans.is_empty()
            && let Ok(json) = serde_json::to_string(&row_spans)
        {
            meta_map.insert(txn, "rowSpans", Any::String(Arc::from(json)));
        }
        let bare_empty_rows: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.xml_hints.bare_empty)
            .map(|r| r.row)
            .collect();
        if !bare_empty_rows.is_empty()
            && let Ok(json) = serde_json::to_string(&bare_empty_rows)
        {
            meta_map.insert(txn, "bareEmptyRows", Any::String(Arc::from(json)));
        }
    }

    // --- Hidden rows/cols (from dimension data) ---
    hydrate_hidden_rows_cols(
        txn,
        &hidden_rows_map,
        &manual_hidden_rows_map,
        &hidden_cols_map,
        &row_id_hexes,
        &sheet.dimensions.row_heights,
        &sheet.dimensions.col_widths,
    );

    // --- Hyperlinks (yrs_schema::hyperlink) ---
    hydrate_hyperlinks(
        txn,
        &mut pos_map,
        &cells_map,
        &meta_map,
        &sheet.hyperlinks,
        allocator,
    );

    let anchored_identities = allocate_missing_anchored_identities(sheet, &pos_map, allocator);
    let identity_only_cells =
        insert_missing_anchored_identities(&mut pos_map, &anchored_identities);

    if !sheet.legacy_comment_authors.is_empty()
        && let Ok(json) = serde_json::to_string(&sheet.legacy_comment_authors)
    {
        sheet_map.insert(txn, "legacyCommentAuthors", Any::String(Arc::from(json)));
    }

    // --- Comments (yrs_schema::comment) ---
    // Resolve A1 cell_refs to stable CellId hex strings via the authoritative
    // import position map. Empty comment-only targets are identity-only entries
    // in gridIndex, not placeholder cells under KEY_CELLS.
    hydrate_comments(txn, &comments_map, &pos_map, &sheet.comments, persons);

    // --- Sparklines (yrs_schema::sparkline) ---
    hydrate_sparklines(
        txn,
        &sparklines_map,
        &sheet.sparklines,
        &sheet.sparkline_groups,
    );

    // --- Conditional formatting (yrs_schema::conditional_format) ---
    hydrate_conditional_formats(txn, &cf_map, &sheet.conditional_formats);

    // --- Data validations (yrs_schema::validation) ---
    hydrate_data_validations(
        txn,
        sheets_map,
        &sheet_id,
        &meta_map,
        &sheet.data_validations,
        sheet.data_validations_disable_prompts,
        sheet.data_validations_x_window,
        sheet.data_validations_y_window,
        sheet.data_validations_declared_count,
    );
    hydrate_x14_data_validations(
        txn,
        sheets_map,
        &sheet_id,
        &meta_map,
        &sheet.x14_data_validations,
        sheet.x14_data_validations_disable_prompts,
        sheet.x14_data_validations_x_window,
        sheet.x14_data_validations_y_window,
        sheet.x14_data_validations_declared_count,
    );

    // --- Filters (typed AutoFilter at properties/autoFilter + runtime FilterState) ---
    hydrate_auto_filter(txn, &meta_map, &filters_map, &pos_map, &sheet.auto_filter);

    // --- Standalone worksheet sort state (typed OOXML metadata only) ---
    hydrate_sort_state(txn, &meta_map, &sheet.sort_state);
    hydrate_worksheet_semantic_containers(txn, &meta_map, &sheet.worksheet_semantic_containers);

    // --- Outline groups (domain grouping config) ---
    hydrate_outline_groups(
        txn,
        &grouping_map,
        &sheet.outline_groups,
        sheet
            .sheet_properties
            .as_ref()
            .and_then(|properties| properties.outline_pr.as_ref())
            .or(sheet.outline_properties.as_ref()),
        &sheet_hex,
    );

    // --- Floating objects (yrs_schema::floating_object) ---
    // Convert charts to FloatingObjects and merge them with parser-produced floating objects.
    let chart_fos: Vec<domain_types::domain::floating_object::FloatingObject> = sheet
        .charts
        .iter()
        .enumerate()
        .map(|(i, chart)| chart.to_floating_object(&sheet_hex, i))
        .collect();

    let mut all_floating_objects = sheet.floating_objects.clone();
    all_floating_objects.extend(chart_fos);
    hydrate_floating_objects(txn, &floating_objects_map, &sheet_id, &all_floating_objects);

    // --- Row/Col style overrides ---
    hydrate_row_styles(
        txn,
        &row_formats_map,
        &row_id_hexes,
        &sheet.row_styles,
        style_palette,
    );
    hydrate_col_styles(
        txn,
        &col_formats_map,
        &col_id_hexes,
        &sheet.col_styles,
        style_palette,
    );
    hydrate_authored_style_runs(txn, &sheet_map, &sheet.authored_style_runs, style_palette);

    // --- Cell-level style overrides ---
    hydrate_cell_styles(
        txn,
        &pos_map,
        &sheet_map,
        &sheet.cells,
        &std::collections::HashSet::new(),
    );

    // NOTE: Slicers are no longer stored as JSON blobs in floatingObjects.
    // They are hydrated at workbook level as StoredSlicer entries in the
    // KEY_SLICERS map. See hydrate_workbook_slicers().

    // =====================================================================
    // Populate meta-level domain data
    // =====================================================================

    hydrate_frozen_pane(txn, &meta_map, &sheet.frozen_pane);
    hydrate_view_options(txn, &meta_map, &sheet.view);
    hydrate_sheet_protection(txn, &meta_map, &sheet.protection);
    hydrate_print_settings(txn, &meta_map, &sheet.print_settings);
    hydrate_hf_images(txn, &meta_map, &sheet.hf_images);
    hydrate_page_breaks(txn, &meta_map, &sheet.page_breaks);

    // Store extra sheet views (workbookViewId >= 1) as JSON for round-trip fidelity
    yrs_schema::helpers::write_json_vec(
        &meta_map,
        txn,
        "extraSheetViews",
        &sheet.extra_sheet_views,
    );

    // --- Sheet UID (xr:uid on <worksheet> root) ---
    if let Some(ref uid) = sheet.uid {
        meta_map.insert(txn, "sheetUid", Any::String(Arc::from(uid.as_str())));
    }
    if let Some(properties) = &sheet.sheet_properties {
        yrs_schema::sheet_properties::insert(txn, &meta_map, properties);
        if let Some(color) = properties.tab_color.as_ref().and_then(sheet_color_to_hex) {
            meta_map.insert(txn, "tabColor", Any::String(Arc::from(color.as_str())));
        }
    }

    // Collect physical phantom cells — entries in pos_map that weren't in the
    // original data cell set and are not metadata-only identities.
    let data_cell_hexes: HashSet<SmallHex> = cell_ids
        .iter()
        .map(|cid| id_to_hex(cid.as_u128()))
        .collect();
    let identity_only_hexes: HashSet<SmallHex> = identity_only_cells
        .iter()
        .map(|(cid, _, _)| id_to_hex(cid.as_u128()))
        .collect();
    let phantom_cells: Vec<(CellId, u32, u32)> = pos_map
        .iter()
        .filter(|(_pos_key, cell_hex)| !data_cell_hexes.contains(cell_hex.as_str()))
        .filter(|(_pos_key, cell_hex)| !identity_only_hexes.contains(cell_hex.as_str()))
        .filter_map(|(pos_key, cell_hex)| {
            let (row_str, col_str) = pos_key.split_once(':')?;
            let row: u32 = row_str.parse().ok()?;
            let col: u32 = col_str.parse().ok()?;
            let raw_id = compute_document::hex::hex_to_id(cell_hex)?;
            Some((CellId::from_raw(raw_id), row, col))
        })
        .collect();

    // Mirror the final `pos_map` (data cells + physical phantoms +
    // identity-only anchors) into the yrs-side
    // `gridIndex/{posToId,idToPos}` sub-maps — the authoritative yrs-side
    // identity store post-R51. Enables `build_sheet_snapshot_from_yrs` to
    // bootstrap positions without a pre-existing in-memory `GridIndex`.
    //
    // Key format: "rowHex:colHex" (not "row:col"). Row/col hexes are stable
    // across structural ops; position indices are derived via
    // rowOrder/colOrder at read time (matching pre-R51 cellPos semantics).
    let required_identity_positions: HashSet<(u32, u32)> = identity_only_cells
        .iter()
        .map(|(_, row, col)| (*row, *col))
        .collect();
    mirror_pos_map_into_grid_index(
        txn,
        &pos_to_id,
        &id_to_pos,
        &pos_map,
        &row_id_hexes,
        &col_id_hexes,
        &required_identity_positions,
    )?;

    Ok((
        sheet_id,
        cell_ids,
        phantom_cells,
        identity_only_cells,
        row_ids,
        col_ids,
    ))
}

// ===========================================================================
// Per-sheet hydration with pre-allocated IDs (Range-before-Yrs pipeline)
// ===========================================================================

/// Hydrate a single sheet using **pre-allocated** IDs, skipping ranged cells.
///
/// This is the Range-before-Yrs variant of `hydrate_sheet`. It takes a
/// `SheetIdAllocation` (produced by `allocate_sheet_ids`) and a set of
/// `ranged_positions` (cells that the classifier promoted to Ranges).
///
/// Ranged cells are NOT written to the Yrs cells map — they are stored as
/// compact Range payloads instead. All other behaviour is identical to
/// `hydrate_sheet`.
#[allow(clippy::type_complexity)]
pub(crate) fn hydrate_sheet_with_allocation(
    txn: &mut yrs::TransactionMut,
    sheets_map: &MapRef,
    order_arr: &yrs::ArrayRef,
    sheet: &SheetData,
    style_palette: &[DocumentFormat],
    persons: &[domain_types::domain::comment::PersonInfo],
    alloc: &SheetIdAllocation,
    ranged_positions: &std::collections::HashSet<(u32, u32)>,
    range_style_positions: &std::collections::HashSet<(u32, u32)>,
    imported_range_styles: &[ImportedRangeStyle],
    allocator: &mut impl IdAllocator,
) -> Result<(Vec<(CellId, u32, u32)>, Vec<(CellId, u32, u32)>), ComputeError> {
    let sheet_hex = &alloc.sheet_hex;
    let row_id_hexes = &alloc.row_id_hexes;
    let col_id_hexes = &alloc.col_id_hexes;

    // Append sheet id to order array
    order_arr.push_back(txn, Any::String(Arc::from(sheet_hex.as_str())));

    // Create per-sheet map
    let sheet_map_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let sheet_map: MapRef = sheets_map.insert(txn, &**sheet_hex, sheet_map_prelim);

    // Meta map
    let meta_prelim = MapPrelim::from([
        (KEY_NAME, Any::String(Arc::from(sheet.name.as_str()))),
        (KEY_ROWS, Any::Number(sheet.rows as f64)),
        (KEY_COLS, Any::Number(sheet.cols as f64)),
    ]);
    sheet_map.insert(txn, KEY_PROPERTIES, meta_prelim);

    let meta_map: MapRef = match sheet_map.get(txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => unreachable!("meta map was just inserted"),
    };

    // Sheet visibility
    match sheet.visibility {
        domain_types::SheetState::Hidden => {
            meta_map.insert(txn, "hidden", Any::Bool(true));
        }
        domain_types::SheetState::VeryHidden => {
            meta_map.insert(txn, "hidden", Any::Bool(true));
            meta_map.insert(txn, "veryHidden", Any::Bool(true));
        }
        domain_types::SheetState::Visible => {}
    }

    if let Some(original_sheet_id) = sheet.sheet_id {
        meta_map.insert(
            txn,
            "originalSheetId",
            Any::Number(original_sheet_id as f64),
        );
    }
    if let Some(ref uid) = sheet.uid {
        meta_map.insert(txn, "sheetUid", Any::String(Arc::from(uid.as_str())));
    }

    // Cells map
    let cells_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let cells_map: MapRef = sheet_map.insert(txn, KEY_CELLS, cells_prelim);

    // Grid index
    let gi_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let gi_map: MapRef = sheet_map.insert(txn, KEY_GRID_INDEX, gi_prelim);
    let p2i_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let pos_to_id: MapRef = gi_map.insert(txn, "posToId", p2i_prelim);
    let i2p_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let id_to_pos: MapRef = gi_map.insert(txn, "idToPos", i2p_prelim);

    // Row/Col order YArrays — bulk insert from pre-allocated IDs
    let row_order: ArrayRef = sheet_map.insert(txn, KEY_ROW_ORDER, ArrayPrelim::default());
    let col_order: ArrayRef = sheet_map.insert(txn, KEY_COL_ORDER, ArrayPrelim::default());

    row_order.insert_range(
        txn,
        0,
        row_id_hexes
            .iter()
            .map(|h| Any::String(Arc::from(h.as_str()))),
    );
    col_order.insert_range(
        txn,
        0,
        col_id_hexes
            .iter()
            .map(|h| Any::String(Arc::from(h.as_str()))),
    );

    // Legacy maps (backward compat)
    let row_reg_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, "rows", row_reg_prelim);
    let col_reg_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, "cols", col_reg_prelim);
    let row_idx_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, "rowIndex", row_idx_prelim);
    let col_idx_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, "colIndex", col_idx_prelim);

    // Populate cells — skipping ranged positions
    let mut pos_map = hydrate_cells_with_ids(
        txn,
        &cells_map,
        &sheet.cells,
        &alloc.cell_ids,
        ranged_positions,
        range_style_positions,
    );

    // Create remaining per-sheet sub-maps
    let properties_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_CELL_PROPERTIES, properties_prelim);

    let row_heights_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let row_heights_map: MapRef = sheet_map.insert(txn, KEY_ROW_HEIGHTS, row_heights_prelim);

    let col_widths_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let col_widths_map: MapRef = sheet_map.insert(txn, KEY_COL_WIDTHS, col_widths_prelim);

    let schemas_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_SCHEMAS, schemas_prelim);

    let pivots_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_PIVOT_TABLES, pivots_prelim);

    let merges_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let merges_map: MapRef = sheet_map.insert(txn, KEY_MERGES, merges_prelim);

    let manual_hidden_rows_map: MapRef = sheet_map.insert(
        txn,
        KEY_MANUAL_HIDDEN_ROWS,
        MapPrelim::from([] as [(&str, Any); 0]),
    );
    sheet_map.insert(
        txn,
        KEY_FILTER_HIDDEN_ROWS,
        MapPrelim::from([] as [(&str, Any); 0]),
    );

    let hidden_rows_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let hidden_rows_map: MapRef = sheet_map.insert(txn, KEY_HIDDEN_ROWS, hidden_rows_prelim);

    let hidden_cols_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let hidden_cols_map: MapRef = sheet_map.insert(txn, KEY_HIDDEN_COLS, hidden_cols_prelim);

    let row_formats_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let row_formats_map: MapRef = sheet_map.insert(txn, KEY_ROW_FORMATS, row_formats_prelim);

    let col_formats_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let col_formats_map: MapRef = sheet_map.insert(txn, KEY_COL_FORMATS, col_formats_prelim);

    let comments_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let comments_map: MapRef = sheet_map.insert(txn, KEY_COMMENTS, comments_prelim);

    let filters_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let filters_map: MapRef = sheet_map.insert(txn, KEY_FILTERS, filters_prelim);

    let sparklines_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let sparklines_map: MapRef = sheet_map.insert(txn, KEY_SPARKLINES, sparklines_prelim);

    let cf_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let cf_map: MapRef = sheet_map.insert(txn, KEY_CONDITIONAL_FORMAT, cf_prelim);

    let cf_rules_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_CF_RULES, cf_rules_prelim);

    let bindings_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_BINDINGS, bindings_prelim);

    let grouping_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let grouping_map: MapRef = sheet_map.insert(txn, KEY_GROUPING, grouping_prelim);

    let sorting_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_SORTING, sorting_prelim);

    let floating_objects_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let floating_objects_map: MapRef =
        sheet_map.insert(txn, KEY_FLOATING_OBJECTS, floating_objects_prelim);

    let floating_groups_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    sheet_map.insert(txn, KEY_FLOATING_OBJECT_GROUPS, floating_groups_prelim);

    // =====================================================================
    // Domain data (identical to hydrate_sheet)
    // =====================================================================

    hydrate_merges(
        txn,
        &merges_map,
        &cells_map,
        &mut pos_map,
        &sheet.merges,
        allocator,
    );

    let sheet_default_row_height_pt = sheet.dimensions.default_row_height.unwrap_or(15.0);
    let default_col_width_cw = sheet.dimensions.default_col_width.unwrap_or(8.43);

    hydrate_row_heights(
        txn,
        &row_heights_map,
        row_id_hexes,
        &sheet.dimensions.row_heights,
        sheet_default_row_height_pt,
    );
    hydrate_col_widths(
        txn,
        &col_widths_map,
        col_id_hexes,
        &sheet.dimensions.col_widths,
        default_col_width_cw,
    );

    // Default row/col dimensions (meta map)
    if (sheet_default_row_height_pt - 15.0).abs() > 0.01 {
        meta_map.insert(
            txn,
            "defaultRowHeight",
            Any::Number(sheet_default_row_height_pt),
        );
    }
    if sheet.dimensions.default_col_width.is_some() {
        meta_map.insert(txn, "defaultColWidth", Any::Number(default_col_width_cw));
    }
    if let Some(bcw) = sheet.dimensions.base_col_width {
        meta_map.insert(txn, "baseColWidth", Any::Number(bcw as f64));
    }
    if let Some(descent) = sheet.dimensions.default_row_descent {
        meta_map.insert(txn, "defaultRowDescent", Any::Number(descent));
    }
    if sheet.dimensions.custom_height {
        meta_map.insert(txn, "customHeight", Any::Bool(true));
    }
    if sheet.dimensions.zero_height {
        meta_map.insert(txn, "zeroHeight", Any::Bool(true));
    }
    if let Some(olr) = sheet.dimensions.outline_level_row {
        meta_map.insert(txn, "outlineLevelRow", Any::Number(olr as f64));
    }
    if let Some(olc) = sheet.dimensions.outline_level_col {
        meta_map.insert(txn, "outlineLevelCol", Any::Number(olc as f64));
    }

    // Column bestFit/customWidth/collapsed flags
    let best_fit_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.best_fit)
        .map(|c| c.col)
        .collect();
    if !best_fit_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&best_fit_cols)
    {
        meta_map.insert(txn, "colBestFit", Any::String(Arc::from(json)));
    }
    let custom_width_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.custom_width)
        .map(|c| c.col)
        .collect();
    if !custom_width_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_width_cols)
    {
        meta_map.insert(txn, "colCustomWidth", Any::String(Arc::from(json)));
    }
    let collapsed_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.collapsed)
        .map(|c| c.col)
        .collect();
    if !collapsed_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&collapsed_cols)
    {
        meta_map.insert(txn, "colCollapsed", Any::String(Arc::from(json)));
    }
    if !sheet.dimensions.trailing_col_ranges.is_empty()
        && let Ok(json) = serde_json::to_string(&sheet.dimensions.trailing_col_ranges)
    {
        meta_map.insert(txn, "trailingColRanges", Any::String(Arc::from(json)));
    }

    // Row customHeight/customFormat/descent flags
    let custom_height_rows: Vec<u32> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| r.custom_height)
        .map(|r| r.row)
        .collect();
    if !custom_height_rows.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_height_rows)
    {
        meta_map.insert(txn, "rowCustomHeight", Any::String(Arc::from(json)));
    }
    let custom_format_rows: Vec<u32> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| r.custom_format)
        .map(|r| r.row)
        .collect();
    if !custom_format_rows.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_format_rows)
    {
        meta_map.insert(txn, "rowCustomFormat", Any::String(Arc::from(json)));
    }
    let row_descents: Vec<(u32, f64)> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter_map(|r| r.descent.map(|d| (r.row, d)))
        .collect();
    if !row_descents.is_empty()
        && let Ok(json) = serde_json::to_string(&row_descents)
    {
        meta_map.insert(txn, "rowDescents", Any::String(Arc::from(json)));
    }

    let row_metadata: Vec<&domain_types::RowDimension> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| {
            r.explicit_hidden
                || r.outline_level.is_some()
                || r.explicit_outline_level_zero
                || r.collapsed.is_some()
                || r.thick_top
                || r.thick_bot
                || !r.xml_hints.is_empty()
        })
        .collect();
    if !row_metadata.is_empty() {
        let row_outline_levels: Vec<(u32, u8)> = row_metadata
            .iter()
            .filter_map(|r| r.outline_level.map(|level| (r.row, level)))
            .collect();
        if !row_outline_levels.is_empty()
            && let Ok(json) = serde_json::to_string(&row_outline_levels)
        {
            meta_map.insert(txn, "rowOutlineLevels", Any::String(Arc::from(json)));
        }
        let row_explicit_hidden: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.explicit_hidden)
            .map(|r| r.row)
            .collect();
        if !row_explicit_hidden.is_empty()
            && let Ok(json) = serde_json::to_string(&row_explicit_hidden)
        {
            meta_map.insert(txn, "rowExplicitHidden", Any::String(Arc::from(json)));
        }
        let row_explicit_outline_zero: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.explicit_outline_level_zero)
            .map(|r| r.row)
            .collect();
        if !row_explicit_outline_zero.is_empty()
            && let Ok(json) = serde_json::to_string(&row_explicit_outline_zero)
        {
            meta_map.insert(
                txn,
                "rowExplicitOutlineLevelZero",
                Any::String(Arc::from(json)),
            );
        }
        let row_collapsed: Vec<(u32, bool)> = row_metadata
            .iter()
            .filter_map(|r| r.collapsed.map(|collapsed| (r.row, collapsed)))
            .collect();
        if !row_collapsed.is_empty()
            && let Ok(json) = serde_json::to_string(&row_collapsed)
        {
            meta_map.insert(txn, "rowCollapsed", Any::String(Arc::from(json)));
        }
        let row_thick_top: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.thick_top)
            .map(|r| r.row)
            .collect();
        if !row_thick_top.is_empty()
            && let Ok(json) = serde_json::to_string(&row_thick_top)
        {
            meta_map.insert(txn, "rowThickTop", Any::String(Arc::from(json)));
        }
        let row_thick_bot: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.thick_bot)
            .map(|r| r.row)
            .collect();
        if !row_thick_bot.is_empty()
            && let Ok(json) = serde_json::to_string(&row_thick_bot)
        {
            meta_map.insert(txn, "rowThickBot", Any::String(Arc::from(json)));
        }
        let row_spans: Vec<(u32, String)> = row_metadata
            .iter()
            .filter_map(|r| {
                r.xml_hints
                    .spans
                    .as_ref()
                    .map(|spans| (r.row, spans.clone()))
            })
            .collect();
        if !row_spans.is_empty()
            && let Ok(json) = serde_json::to_string(&row_spans)
        {
            meta_map.insert(txn, "rowSpans", Any::String(Arc::from(json)));
        }
        let bare_empty_rows: Vec<u32> = row_metadata
            .iter()
            .filter(|r| r.xml_hints.bare_empty)
            .map(|r| r.row)
            .collect();
        if !bare_empty_rows.is_empty()
            && let Ok(json) = serde_json::to_string(&bare_empty_rows)
        {
            meta_map.insert(txn, "bareEmptyRows", Any::String(Arc::from(json)));
        }
    }

    hydrate_hidden_rows_cols(
        txn,
        &hidden_rows_map,
        &manual_hidden_rows_map,
        &hidden_cols_map,
        row_id_hexes,
        &sheet.dimensions.row_heights,
        &sheet.dimensions.col_widths,
    );
    hydrate_hyperlinks(
        txn,
        &mut pos_map,
        &cells_map,
        &meta_map,
        &sheet.hyperlinks,
        allocator,
    );
    let identity_only_cells =
        insert_missing_anchored_identities(&mut pos_map, &alloc.identity_only_cells);
    if !sheet.legacy_comment_authors.is_empty()
        && let Ok(json) = serde_json::to_string(&sheet.legacy_comment_authors)
    {
        sheet_map.insert(txn, "legacyCommentAuthors", Any::String(Arc::from(json)));
    }
    hydrate_comments(txn, &comments_map, &pos_map, &sheet.comments, persons);
    hydrate_sparklines(
        txn,
        &sparklines_map,
        &sheet.sparklines,
        &sheet.sparkline_groups,
    );
    hydrate_conditional_formats(txn, &cf_map, &sheet.conditional_formats);
    hydrate_data_validations(
        txn,
        sheets_map,
        &alloc.sheet_id,
        &meta_map,
        &sheet.data_validations,
        sheet.data_validations_disable_prompts,
        sheet.data_validations_x_window,
        sheet.data_validations_y_window,
        sheet.data_validations_declared_count,
    );
    hydrate_x14_data_validations(
        txn,
        sheets_map,
        &alloc.sheet_id,
        &meta_map,
        &sheet.x14_data_validations,
        sheet.x14_data_validations_disable_prompts,
        sheet.x14_data_validations_x_window,
        sheet.x14_data_validations_y_window,
        sheet.x14_data_validations_declared_count,
    );
    hydrate_auto_filter(txn, &meta_map, &filters_map, &pos_map, &sheet.auto_filter);
    hydrate_sort_state(txn, &meta_map, &sheet.sort_state);
    hydrate_worksheet_semantic_containers(txn, &meta_map, &sheet.worksheet_semantic_containers);
    hydrate_outline_groups(
        txn,
        &grouping_map,
        &sheet.outline_groups,
        sheet
            .sheet_properties
            .as_ref()
            .and_then(|properties| properties.outline_pr.as_ref())
            .or(sheet.outline_properties.as_ref()),
        sheet_hex,
    );
    let chart_fos: Vec<domain_types::domain::floating_object::FloatingObject> = sheet
        .charts
        .iter()
        .enumerate()
        .map(|(i, chart)| chart.to_floating_object(sheet_hex, i))
        .collect();
    let mut all_floating_objects = sheet.floating_objects.clone();
    all_floating_objects.extend(chart_fos);
    hydrate_floating_objects(
        txn,
        &floating_objects_map,
        &alloc.sheet_id,
        &all_floating_objects,
    );
    hydrate_row_styles(
        txn,
        &row_formats_map,
        row_id_hexes,
        &sheet.row_styles,
        style_palette,
    );
    hydrate_col_styles(
        txn,
        &col_formats_map,
        col_id_hexes,
        &sheet.col_styles,
        style_palette,
    );
    hydrate_authored_style_runs(txn, &sheet_map, &sheet.authored_style_runs, style_palette);
    hydrate_imported_range_styles(txn, &sheet_map, imported_range_styles, style_palette);
    hydrate_cell_styles(
        txn,
        &pos_map,
        &sheet_map,
        &sheet.cells,
        range_style_positions,
    );

    hydrate_frozen_pane(txn, &meta_map, &sheet.frozen_pane);
    hydrate_view_options(txn, &meta_map, &sheet.view);
    hydrate_sheet_protection(txn, &meta_map, &sheet.protection);
    hydrate_print_settings(txn, &meta_map, &sheet.print_settings);
    hydrate_hf_images(txn, &meta_map, &sheet.hf_images);
    hydrate_page_breaks(txn, &meta_map, &sheet.page_breaks);
    yrs_schema::helpers::write_json_vec(
        &meta_map,
        txn,
        "extraSheetViews",
        &sheet.extra_sheet_views,
    );
    if let Some(ref uid) = sheet.uid {
        meta_map.insert(txn, "sheetUid", Any::String(Arc::from(uid.as_str())));
    }

    // Physical phantom cells.
    let data_cell_hexes: HashSet<SmallHex> = alloc
        .cell_ids
        .iter()
        .map(|cid| id_to_hex(cid.as_u128()))
        .collect();
    let identity_only_hexes: HashSet<SmallHex> = identity_only_cells
        .iter()
        .map(|(cid, _, _)| id_to_hex(cid.as_u128()))
        .collect();
    let phantom_cells: Vec<(CellId, u32, u32)> = pos_map
        .iter()
        .filter(|(_pos_key, cell_hex)| !data_cell_hexes.contains(cell_hex.as_str()))
        .filter(|(_pos_key, cell_hex)| !identity_only_hexes.contains(cell_hex.as_str()))
        .filter_map(|(pos_key, cell_hex)| {
            let (row_str, col_str) = pos_key.split_once(':')?;
            let row: u32 = row_str.parse().ok()?;
            let col: u32 = col_str.parse().ok()?;
            let raw_id = compute_document::hex::hex_to_id(cell_hex)?;
            Some((CellId::from_raw(raw_id), row, col))
        })
        .collect();

    let required_identity_positions: HashSet<(u32, u32)> = identity_only_cells
        .iter()
        .map(|(_, row, col)| (*row, *col))
        .collect();
    mirror_pos_map_into_grid_index(
        txn,
        &pos_to_id,
        &id_to_pos,
        &pos_map,
        row_id_hexes,
        col_id_hexes,
        &required_identity_positions,
    )?;

    Ok((phantom_cells, identity_only_cells))
}
