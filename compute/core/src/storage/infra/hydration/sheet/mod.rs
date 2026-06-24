use std::collections::HashSet;
use std::sync::Arc;

use yrs::{Any, Array, ArrayPrelim, ArrayRef, Map, MapPrelim, MapRef, Out};

use domain_types::{DocumentFormat, SheetData};

use compute_document::hex::{SmallHex, id_to_hex};
use compute_document::schema::*;

use cell_types::{CellId, ColId, RowId, SheetId};
use value_types::ComputeError;

mod allocation;
mod dimensions;
mod domain;
mod grid_index;
mod identity;
mod view_meta;

pub(crate) use allocation::{
    allocate_sheet_ids, allocate_sheet_ids_with_previous_allocation,
    allocate_sheet_ids_with_sheet_id,
};
pub(crate) use identity::SheetIdAllocation;

use super::IdAllocator;
use super::features::{
    FloatingObjectHydrationMaps, hydrate_auto_filter, hydrate_cells, hydrate_cells_with_ids,
    hydrate_comments, hydrate_conditional_formats, hydrate_data_validations,
    hydrate_floating_objects, hydrate_hyperlinks, hydrate_merges, hydrate_outline_groups,
    hydrate_sort_state, hydrate_sparklines, hydrate_x14_data_validations,
};
use super::styles::{
    ImportedRangeStyle, hydrate_authored_style_runs, hydrate_cell_styles, hydrate_col_style_ranges,
    hydrate_col_styles, hydrate_imported_range_styles, hydrate_row_styles,
};
use dimensions::{DimensionMaps, hydrate_dimensions};
use domain::{hydrate_worksheet_import_xml_metadata, hydrate_worksheet_semantic_containers};
use grid_index::{collect_physical_phantom_cells, mirror_pos_map_into_grid_index};
use identity::{
    allocate_missing_anchored_identities, insert_missing_anchored_identities, sheet_identity_extent,
};
use view_meta::{hydrate_sheet_view_metadata, insert_sheet_properties_metadata};

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
    theme: Option<&domain_types::ThemeData>,
    indexed_colors: Option<&ooxml_types::styles::ColorsDef>,
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
        insert_sheet_properties_metadata(txn, &meta_map, properties, theme, indexed_colors);
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
    sheet_map.insert(
        txn,
        KEY_COL_FORMAT_RANGES,
        MapPrelim::from([] as [(&str, Any); 0]),
    );

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
    let floating_object_order: ArrayRef =
        sheet_map.insert(txn, KEY_FLOATING_OBJECT_ORDER, ArrayPrelim::default());

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

    hydrate_dimensions(
        txn,
        DimensionMaps {
            meta_map: &meta_map,
            row_heights_map: &row_heights_map,
            col_widths_map: &col_widths_map,
            hidden_rows_map: &hidden_rows_map,
            manual_hidden_rows_map: &manual_hidden_rows_map,
            hidden_cols_map: &hidden_cols_map,
        },
        &row_id_hexes,
        &col_id_hexes,
        sheet,
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
        meta_map.insert(txn, "legacyCommentAuthors", Any::String(Arc::from(json)));
    }
    if let Some(comment_package) = &sheet.comment_package
        && !comment_package.is_empty()
        && let Ok(json) = serde_json::to_string(comment_package)
    {
        meta_map.insert(txn, "commentPackage", Any::String(Arc::from(json)));
    }
    if let Some(drawing_package) = &sheet.drawing_package
        && let Ok(json) = serde_json::to_string(drawing_package)
    {
        meta_map.insert(txn, "drawingPackage", Any::String(Arc::from(json)));
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

    // --- Data validations ---
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
    hydrate_worksheet_import_xml_metadata(txn, &meta_map, sheet);

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
    hydrate_floating_objects(
        txn,
        FloatingObjectHydrationMaps {
            floating_objects: &floating_objects_map,
            floating_object_order: &floating_object_order,
            cells: &cells_map,
        },
        &mut pos_map,
        &sheet_id,
        &all_floating_objects,
        allocator,
    );

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
    hydrate_col_style_ranges(txn, &sheet_map, &sheet.col_style_ranges, style_palette);
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

    hydrate_sheet_view_metadata(txn, &meta_map, sheet, true, theme, indexed_colors);

    // Collect physical phantom cells — entries in pos_map that weren't in the
    // original data cell set and are not metadata-only identities.
    let phantom_cells = collect_physical_phantom_cells(&pos_map, &cell_ids, &identity_only_cells);

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
    theme: Option<&domain_types::ThemeData>,
    indexed_colors: Option<&ooxml_types::styles::ColorsDef>,
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
    if let Some(properties) = &sheet.sheet_properties {
        insert_sheet_properties_metadata(txn, &meta_map, properties, theme, indexed_colors);
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
    sheet_map.insert(
        txn,
        KEY_COL_FORMAT_RANGES,
        MapPrelim::from([] as [(&str, Any); 0]),
    );

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
    let floating_object_order: ArrayRef =
        sheet_map.insert(txn, KEY_FLOATING_OBJECT_ORDER, ArrayPrelim::default());

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

    hydrate_dimensions(
        txn,
        DimensionMaps {
            meta_map: &meta_map,
            row_heights_map: &row_heights_map,
            col_widths_map: &col_widths_map,
            hidden_rows_map: &hidden_rows_map,
            manual_hidden_rows_map: &manual_hidden_rows_map,
            hidden_cols_map: &hidden_cols_map,
        },
        row_id_hexes,
        col_id_hexes,
        sheet,
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
        meta_map.insert(txn, "legacyCommentAuthors", Any::String(Arc::from(json)));
    }
    if let Some(comment_package) = &sheet.comment_package
        && !comment_package.is_empty()
        && let Ok(json) = serde_json::to_string(comment_package)
    {
        meta_map.insert(txn, "commentPackage", Any::String(Arc::from(json)));
    }
    if let Some(drawing_package) = &sheet.drawing_package
        && let Ok(json) = serde_json::to_string(drawing_package)
    {
        meta_map.insert(txn, "drawingPackage", Any::String(Arc::from(json)));
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
    hydrate_worksheet_import_xml_metadata(txn, &meta_map, sheet);
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
        FloatingObjectHydrationMaps {
            floating_objects: &floating_objects_map,
            floating_object_order: &floating_object_order,
            cells: &cells_map,
        },
        &mut pos_map,
        &alloc.sheet_id,
        &all_floating_objects,
        allocator,
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
    hydrate_col_style_ranges(txn, &sheet_map, &sheet.col_style_ranges, style_palette);
    hydrate_authored_style_runs(txn, &sheet_map, &sheet.authored_style_runs, style_palette);
    hydrate_imported_range_styles(txn, &sheet_map, imported_range_styles, style_palette);
    hydrate_cell_styles(
        txn,
        &pos_map,
        &sheet_map,
        &sheet.cells,
        range_style_positions,
    );

    hydrate_sheet_view_metadata(txn, &meta_map, sheet, false, theme, indexed_colors);

    // Physical phantom cells.
    let phantom_cells =
        collect_physical_phantom_cells(&pos_map, &alloc.cell_ids, &identity_only_cells);

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
