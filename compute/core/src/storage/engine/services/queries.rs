//! Extracted read-only query functions.
//!
//! Each function takes explicit references to the engine sub-structs it needs
//! (e.g. `&EngineStores`, `&CellMirror`) instead of `&self`.  The original
//! bridge methods in `queries.rs` delegate to these with one-line calls.

use crate::engine_types::{
    CellPosition, CellPositionResult, ColumnEdge, DataBounds, DefaultFont, ProjectionData,
    RectBounds, RegexSearchMatch, RegexSearchOptions, RegexSearchResult, RowEdge,
    SheetProtectionConfig, SignAnomaly, SignCheckOptions, SignCheckResult, SignNeighbor,
    WorkbookSearchMatch, WorkbookSearchResult,
};
use crate::mirror::CellMirror;
use crate::range_manager::{self, A1CellRef, A1RangeRef, ViewportBounds};
use crate::snapshot::{
    CalcMode, CalculationSettings, ProtectedWorkbookOperation, WorkbookProtectionOptions,
    WorkbookSettings,
};
use crate::storage::cells::values as cell_values;
use crate::storage::infra::cell_iter;
use crate::storage::sheet::{
    dimensions, merges, order, print, properties, protection, settings, view, visibility,
};
use crate::storage::workbook::named_ranges;
use crate::storage::workbook::settings as workbook;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use domain_types::domain::merge::{
    CellMergeInfo, IdentityMergedRegion, MergeRegion, ResolvedMergedRegion,
};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::NamedSlicerStyle;
use domain_types::units::{CharWidth, Pixels, Points};
use domain_types::{DefinedName, NameValidationResult};
use value_types::ComputeError;
use yrs::Transact;

use super::super::merge_index::MergeDirectResolver;
use super::super::query_serialization::{cell_data_to_json, cell_value_to_json};
use crate::storage::engine::stores::EngineStores;

/// Resolve a cell's (row, col) from its hex id via the authoritative
/// `GridIndex`. Returns `None` if the hex fails to parse or the cell is
/// unknown to the index.
fn resolve_pos_from_grid(
    grid: Option<&crate::identity::GridIndex>,
    cell_id_hex: &str,
) -> Option<(u32, u32)> {
    let grid = grid?;
    let raw = hex_to_id(cell_id_hex)?;
    grid.cell_position(&CellId::from_raw(raw))
}

// -------------------------------------------------------------------
// Workbook Settings
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_workbook_settings(stores: &EngineStores) -> WorkbookSettings {
    workbook::get_settings(stores.storage.doc(), stores.storage.workbook_map())
}

// -------------------------------------------------------------------
// Document Properties
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_document_properties(
    stores: &EngineStores,
) -> domain_types::DocumentProperties {
    use compute_document::schema::KEY_DOCUMENT_PROPERTIES;
    use yrs::{Map, Out};

    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    match workbook.get(&txn, KEY_DOCUMENT_PROPERTIES) {
        Some(Out::YMap(m)) => domain_types::yrs_schema::doc_properties::from_yrs_map(&m, &txn),
        _ => domain_types::DocumentProperties::default(),
    }
}

pub(in crate::storage::engine) fn set_document_properties(
    stores: &EngineStores,
    props: &domain_types::DocumentProperties,
) {
    use compute_document::schema::KEY_DOCUMENT_PROPERTIES;
    use yrs::{Any, Map, MapPrelim, Out};

    let doc = stores.storage.doc();
    let mut txn = doc.transact_mut();
    let workbook = stores.storage.workbook_map();

    let props_map = match workbook.get(&txn, KEY_DOCUMENT_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            workbook.insert(&mut txn, KEY_DOCUMENT_PROPERTIES, empty);
            match workbook.get(&txn, KEY_DOCUMENT_PROPERTIES) {
                Some(Out::YMap(m)) => m,
                _ => return,
            }
        }
    };

    for (key, value) in domain_types::yrs_schema::doc_properties::to_yrs_prelim(props) {
        props_map.insert(&mut txn, key, value);
    }
}

// -------------------------------------------------------------------
// Sheet Metadata Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_all_sheet_ids(stores: &EngineStores) -> Vec<String> {
    let yrs_sheets: Vec<String> = stores
        .storage
        .sheet_order()
        .iter()
        .map(|sid| id_to_hex(sid.as_u128()).into())
        .collect();
    // Deferred hydration: Yrs is empty but ComputeCore has sheet order from snapshot
    if yrs_sheets.is_empty() {
        return stores
            .compute
            .ordered_sheets()
            .iter()
            .map(|sid| id_to_hex(sid.as_u128()).into())
            .collect();
    }
    yrs_sheets
}

pub(in crate::storage::engine) fn get_sheet_name(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<String> {
    properties::get_sheet_name(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_hidden(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    visibility::is_sheet_hidden(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_protected(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    protection::is_sheet_protected(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

// -------------------------------------------------------------------
// Dimension Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn is_row_hidden_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> bool {
    dimensions::is_row_hidden(stores.storage.doc(), stores.storage.sheets(), sheet_id, row)
}

pub(in crate::storage::engine) fn is_col_hidden_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    dimensions::is_column_hidden(stores.storage.doc(), stores.storage.sheets(), sheet_id, col)
}

pub(in crate::storage::engine) fn get_hidden_rows(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<u32> {
    dimensions::get_hidden_rows(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_hidden_columns(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<u32> {
    dimensions::get_hidden_columns(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_data_bounds(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Option<DataBounds> {
    let sheet = mirror.get_sheet(sheet_id)?;

    let mut min_row = u32::MAX;
    let mut max_row = 0u32;
    let mut min_col = u32::MAX;
    let mut max_col = 0u32;
    let mut found = false;

    // 1. Bounds from mirror cells (value / formula cells)
    for (cell_id, entry) in sheet.cells_iter() {
        if entry.is_ghost() {
            continue;
        }
        if let Some(pos) = sheet.position_of(cell_id) {
            found = true;
            min_row = min_row.min(pos.row());
            max_row = max_row.max(pos.row());
            min_col = min_col.min(pos.col());
            max_col = max_col.max(pos.col());
        }
    }

    // 2. Expand bounds with sheet extent (includes materialized values: pivot output, spill arrays).
    //    expand_extent() is called when writing to col_data, so sheet.rows/cols reflects the
    //    farthest materialized cell even though those cells have no CellId.
    if !sheet.col_data_is_empty() && sheet.rows > 0 && sheet.cols > 0 {
        found = true;
        min_row = 0;
        max_row = max_row.max(sheet.rows - 1);
        min_col = 0;
        max_col = max_col.max(sheet.cols - 1);
    }

    // 3. Expand bounds with format-only cells from CRDT properties.
    //    These cells have formatting but no value/formula, so they exist in
    //    the CRDT properties map but not in the cell mirror.
    use crate::storage::properties;

    let doc = stores.storage.doc();
    let sheets_map = stores.storage.sheets();
    let grid = stores.grid_indexes.get(sheet_id);

    for cell_id_hex in properties::iter_formatted_property_cell_ids(doc, sheets_map, sheet_id) {
        // Resolve position directly from the authoritative GridIndex.
        if let Some((row, col)) = resolve_pos_from_grid(grid, cell_id_hex.as_str()) {
            found = true;
            min_row = min_row.min(row);
            max_row = max_row.max(row);
            min_col = min_col.min(col);
            max_col = max_col.max(col);
        }
    }

    // 4. Expand bounds with merge-region footprints.
    //    A merged region is sheet structure (not just a view hint), so its
    //    bounding box must be part of the used range — matches Excel's
    //    `UsedRange` semantics. Walking merges here makes `get_data_bounds`
    //    a pure function of CRDT state: originator and receiver agree even
    //    though the receiver never runs `expand_extent` on merge-apply (the
    //    nulled non-origin corner cells look like ghosts to step 1).
    //
    //    Uses `merges::iter_merge_bounds`, which reads the inline
    //    `sr/sc/er/ec` fields from each merge entry. Crucially this is
    //    independent of the in-memory `GridIndex`: on a merge receiver the
    //    local `GridIndex` may not yet have the merge-origin cell IDs
    //    registered (hydration gap fixed in a separate round), but the
    //    Yrs merges map carries the rectangle directly.
    for (sr, sc, er, ec) in merges::iter_merge_bounds(doc, sheets_map, *sheet_id) {
        found = true;
        min_row = min_row.min(sr);
        max_row = max_row.max(er);
        min_col = min_col.min(sc);
        max_col = max_col.max(ec);
    }

    if !found {
        return None;
    }

    Some(DataBounds {
        min_row,
        min_col,
        max_row,
        max_col,
    })
}

// -------------------------------------------------------------------
// Sheet Metadata (extended)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_sheet_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<usize> {
    stores
        .storage
        .sheet_order()
        .iter()
        .position(|sid| sid == sheet_id)
}

pub(in crate::storage::engine) fn get_frozen_panes_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> FrozenPanes {
    view::get_frozen_panes(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_view_options_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> SheetViewOptions {
    view::get_view_options(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_scroll_position_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> SheetScrollPosition {
    view::get_scroll_position(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_tab_color_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<String> {
    properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)?.tab_color
}

pub(in crate::storage::engine) fn get_sheet_protection_config(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> SheetProtectionConfig {
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    SheetProtectionConfig {
        is_protected: settings.is_protected,
        protection_password_hash: settings.protection_password_hash,
    }
}

// -------------------------------------------------------------------
// Dimension Off-Viewport Reads
// -------------------------------------------------------------------

/// Returns row height in **pixels** (for TypeScript bridge).
/// Reads canonical (points) from Yrs and converts.
pub(in crate::storage::engine) fn get_row_height_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> Pixels {
    let height_pt = dimensions::get_row_height(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        stores.grid_indexes.get(sheet_id),
    );
    if height_pt.0 == 0.0 {
        Pixels(0.0)
    } else {
        domain_types::units::points_to_pixels(height_pt)
    }
}

/// Returns column width in **pixels** (for TypeScript bridge).
/// Reads canonical (char-width) from Yrs and converts.
pub(in crate::storage::engine) fn get_col_width_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> Pixels {
    let width_cw = dimensions::get_col_width(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col,
        stores.grid_indexes.get(sheet_id),
    );
    if width_cw.0 == 0.0 {
        Pixels(0.0)
    } else {
        domain_types::units::char_width_to_pixels(width_cw, domain_types::units::platform_mdw())
    }
}

/// Returns default row height in **canonical units (points)**.
pub(in crate::storage::engine) fn get_default_row_height(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Points {
    properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)
        .map(|m| Points(m.default_row_height))
        .unwrap_or(dimensions::DEFAULT_ROW_HEIGHT)
}

/// Returns default column width in **canonical units (char-width)**.
pub(in crate::storage::engine) fn get_default_col_width(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> CharWidth {
    properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)
        .map(|m| CharWidth(m.default_col_width))
        .unwrap_or(dimensions::DEFAULT_COL_WIDTH)
}

/// Returns row heights in **pixels** (for TypeScript bridge).
pub(in crate::storage::engine) fn get_row_heights_batch(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Vec<(u32, Pixels)> {
    (start_row..=end_row)
        .map(|row| {
            let pt = dimensions::get_row_height(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                row,
                stores.grid_indexes.get(sheet_id),
            );
            (
                row,
                if pt.0 == 0.0 {
                    Pixels(0.0)
                } else {
                    domain_types::units::points_to_pixels(pt)
                },
            )
        })
        .collect()
}

/// Returns column width in **character-width units** (for TypeScript bridge).
/// Reads canonical (char-width) from Yrs directly — no pixel conversion.
pub(in crate::storage::engine) fn get_col_width_chars_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> CharWidth {
    dimensions::get_col_width(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col,
        stores.grid_indexes.get(sheet_id),
    )
}

/// Returns column widths in **character-width units** for a range.
pub(in crate::storage::engine) fn get_col_widths_batch_chars(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<(u32, CharWidth)> {
    (start_col..=end_col)
        .map(|col| {
            let cw = dimensions::get_col_width(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                col,
                stores.grid_indexes.get(sheet_id),
            );
            (col, cw)
        })
        .collect()
}

/// Returns column widths in **pixels** (for TypeScript bridge).
pub(in crate::storage::engine) fn get_col_widths_batch(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<(u32, Pixels)> {
    let mdw = domain_types::units::platform_mdw();
    (start_col..=end_col)
        .map(|col| {
            let cw = dimensions::get_col_width(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                col,
                stores.grid_indexes.get(sheet_id),
            );
            (
                col,
                if cw.0 == 0.0 {
                    Pixels(0.0)
                } else {
                    domain_types::units::char_width_to_pixels(cw, mdw)
                },
            )
        })
        .collect()
}

// -------------------------------------------------------------------
// Named Range Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_all_named_ranges_wire(
    stores: &EngineStores,
) -> Vec<DefinedName> {
    named_ranges::get_all_named_ranges(stores.storage.doc(), stores.storage.workbook_map())
        .into_iter()
        .filter(|dn| dn.visible)
        .collect()
}

// -------------------------------------------------------------------
// Merge Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_merge_at_cell_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    let grid = stores.grid_indexes.get(sheet_id)?;
    merges::get_merge_for_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
    )
}

pub(in crate::storage::engine) fn get_all_merges_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ResolvedMergedRegion> {
    match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_all_merges(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
        ),
        None => Vec::new(),
    }
}

// -------------------------------------------------------------------
// Cell ID Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_cell_id_at(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    stores
        .grid_indexes
        .get(sheet_id)?
        .cell_id_at(row, col)
        .map(|cid| id_to_hex(cid.as_u128()).into())
}

pub(in crate::storage::engine) fn get_cell_position(
    mirror: &CellMirror,
    _sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<CellPositionResult> {
    let id_u128 = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(id_u128);
    let sheet_id = mirror.sheet_for_cell(&cell_id)?;
    let pos = mirror.resolve_position(&cell_id)?;
    Some(CellPositionResult {
        sheet_id: id_to_hex(sheet_id.as_u128()).into(),
        sheet_name: String::new(), // Enriched by engine-level caller
        row: pos.row(),
        col: pos.col(),
    })
}

pub(in crate::storage::engine) fn resolve_cell_positions(
    mirror: &CellMirror,
    cell_id_hexes: &[String],
) -> Vec<Option<CellPositionResult>> {
    cell_id_hexes
        .iter()
        .map(|hex| {
            let id_u128 = hex_to_id(hex)?;
            let cell_id = CellId::from_raw(id_u128);
            let sheet_id = mirror.sheet_for_cell(&cell_id)?;
            let pos = mirror.resolve_position(&cell_id)?;
            Some(CellPositionResult {
                sheet_id: id_to_hex(sheet_id.as_u128()).into(),
                sheet_name: String::new(), // Enriched by engine-level caller
                row: pos.row(),
                col: pos.col(),
            })
        })
        .collect()
}

// -------------------------------------------------------------------
// Projection Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn is_projection_source(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    mirror
        .projection_registry
        .source_at(sheet_id, row, col)
        .is_some()
}

pub(in crate::storage::engine) fn is_projected_position(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    if let Some((_source, er, ec)) = mirror.projection_registry.resolve(sheet_id, row, col) {
        return er != 0 || ec != 0;
    }
    false
}

pub(in crate::storage::engine) fn get_projection_range(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<RectBounds> {
    if let Some(source) = mirror.projection_registry.source_at(sheet_id, row, col)
        && let Some(proj) = mirror.projection_registry.get(&source)
    {
        return Some(RectBounds {
            start_row: proj.origin_row,
            start_col: proj.origin_col,
            end_row: proj.origin_row + proj.rows - 1,
            end_col: proj.origin_col + proj.cols - 1,
        });
    }
    None
}

pub(in crate::storage::engine) fn get_projection_source(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<SheetPos> {
    if let Some((source, er, ec)) = mirror.projection_registry.resolve(sheet_id, row, col)
        && (er != 0 || ec != 0)
        && let Some(proj) = mirror.projection_registry.get(&source)
    {
        return Some(SheetPos::new(proj.origin_row, proj.origin_col));
    }
    None
}

pub(in crate::storage::engine) fn get_viewport_projection_data(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<ProjectionData> {
    let registry = &mirror.projection_registry;
    let projections =
        registry.projections_in_range(sheet_id, start_row, start_col, end_row + 1, end_col + 1);

    projections
        .into_iter()
        .map(|proj| ProjectionData {
            origin_row: proj.origin_row,
            origin_col: proj.origin_col,
            rows: proj.rows,
            cols: proj.cols,
        })
        .collect()
}

// -------------------------------------------------------------------
// Workbook Granular Reads
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_calc_mode(stores: &EngineStores) -> String {
    match get_workbook_settings(stores)
        .calculation_settings
        .unwrap_or_default()
        .calc_mode
    {
        CalcMode::Auto => "auto",
        CalcMode::AutoNoTable => "autoNoTable",
        CalcMode::Manual => "manual",
    }
    .to_string()
}

pub(in crate::storage::engine) fn get_default_font() -> DefaultFont {
    DefaultFont {
        name: "Calibri".to_string(),
        size: 11,
        color: "#000000".to_string(),
    }
}

// -------------------------------------------------------------------
// Workbook Granular Settings (read)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_workbook_setting(
    stores: &EngineStores,
    key: &str,
) -> Option<serde_json::Value> {
    workbook::get_setting(stores.storage.doc(), stores.storage.workbook_map(), key)
}

pub(in crate::storage::engine) fn get_calculation_settings(
    stores: &EngineStores,
) -> CalculationSettings {
    workbook::get_calculation_settings(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn is_iterative_calculation_enabled(stores: &EngineStores) -> bool {
    workbook::is_iterative_calculation_enabled(stores.storage.doc(), stores.storage.workbook_map())
}

// -------------------------------------------------------------------
// Workbook Protection (read)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_workbook_protection_options(
    stores: &EngineStores,
) -> WorkbookProtectionOptions {
    workbook::get_protection_options(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn has_workbook_protection_password(stores: &EngineStores) -> bool {
    workbook::has_protection_password(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn is_workbook_protected(stores: &EngineStores) -> bool {
    workbook::is_protected(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn is_workbook_operation_allowed(
    stores: &EngineStores,
    operation: ProtectedWorkbookOperation,
) -> Result<bool, ComputeError> {
    Ok(workbook::is_operation_allowed(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        operation,
    ))
}

pub(in crate::storage::engine) fn get_default_table_style_id(
    stores: &EngineStores,
) -> Option<String> {
    workbook::get_default_table_style_id(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn get_default_slicer_style(
    stores: &EngineStores,
) -> Option<String> {
    workbook::get_default_slicer_style(stores.storage.doc(), stores.storage.workbook_map())
}

// -------------------------------------------------------------------
// Named Slicer Style Registry (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_named_slicer_style_count(stores: &EngineStores) -> u32 {
    workbook::get_named_slicer_style_count(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn get_named_slicer_style(
    stores: &EngineStores,
    name: &str,
) -> Option<NamedSlicerStyle> {
    workbook::get_named_slicer_style(stores.storage.doc(), stores.storage.workbook_map(), name)
        .ok()
        .flatten()
}

pub(in crate::storage::engine) fn list_named_slicer_styles(
    stores: &EngineStores,
) -> Vec<NamedSlicerStyle> {
    workbook::list_named_slicer_styles(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn get_default_pivot_table_style(
    stores: &EngineStores,
) -> Option<String> {
    workbook::get_default_pivot_table_style(stores.storage.doc(), stores.storage.workbook_map())
}

// -------------------------------------------------------------------
// Custom Settings (arbitrary KV store)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_custom_setting(
    stores: &EngineStores,
    key: &str,
) -> Option<String> {
    workbook::get_custom_setting(stores.storage.doc(), stores.storage.workbook_map(), key)
}

pub(in crate::storage::engine) fn list_custom_settings(
    stores: &EngineStores,
) -> Vec<(String, String)> {
    workbook::list_custom_settings(stores.storage.doc(), stores.storage.workbook_map())
}

// -------------------------------------------------------------------
// Named Ranges (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_named_range_by_id(
    stores: &EngineStores,
    id: &str,
) -> Option<DefinedName> {
    named_ranges::get_named_range_by_id(stores.storage.doc(), stores.storage.workbook_map(), id)
}

pub(in crate::storage::engine) fn get_named_range_by_name(
    stores: &EngineStores,
    name: &str,
    scope: Option<&str>,
) -> Option<DefinedName> {
    named_ranges::get_named_range_by_name(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
        scope,
    )
}

pub(in crate::storage::engine) fn get_named_ranges_by_scope(
    stores: &EngineStores,
    scope: Option<&str>,
) -> Vec<DefinedName> {
    named_ranges::get_named_ranges_by_scope(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        scope,
    )
}

pub(in crate::storage::engine) fn get_visible_named_ranges(
    stores: &EngineStores,
) -> Vec<DefinedName> {
    named_ranges::get_visible_named_ranges(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn named_range_exists(
    stores: &EngineStores,
    name: &str,
    scope: Option<&str>,
) -> bool {
    named_ranges::named_range_exists(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
        scope,
    )
}

pub(in crate::storage::engine) fn named_range_count(stores: &EngineStores) -> usize {
    named_ranges::named_range_count(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn validate_named_range_name(
    stores: &EngineStores,
    name: &str,
    scope: Option<&str>,
    exclude_id: Option<&str>,
) -> NameValidationResult {
    named_ranges::validate_name(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
        scope,
        exclude_id,
    )
}

pub(in crate::storage::engine) fn resolve_named_range(
    stores: &EngineStores,
    name: &str,
    current_sheet: Option<&str>,
) -> Option<DefinedName> {
    named_ranges::resolve_named_range(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
        current_sheet,
    )
}

// -------------------------------------------------------------------
// Sheet Extended Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_visible_sheet_ids(stores: &EngineStores) -> Vec<String> {
    visibility::get_visible_sheets(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
    )
    .iter()
    .map(|sid| id_to_hex(sid.as_u128()).into())
    .collect()
}

pub(in crate::storage::engine) fn get_hidden_sheet_ids(stores: &EngineStores) -> Vec<String> {
    visibility::get_hidden_sheets(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
    )
    .iter()
    .map(|sid| id_to_hex(sid.as_u128()).into())
    .collect()
}

pub(in crate::storage::engine) fn count_visible_sheets(stores: &EngineStores) -> u32 {
    visibility::count_visible_sheets(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
    )
}

pub(in crate::storage::engine) fn get_sheet_order(stores: &EngineStores) -> Vec<String> {
    order::get_sheet_order(stores.storage.doc(), stores.storage.workbook_map())
        .iter()
        .map(|sid| id_to_hex(sid.as_u128()).into())
        .collect()
}

pub(in crate::storage::engine) fn get_first_sheet_id(stores: &EngineStores) -> Option<String> {
    properties::get_first_sheet_id(stores.storage.doc(), stores.storage.workbook_map())
        .map(|sid| String::from(id_to_hex(sid.as_u128())))
}

pub(in crate::storage::engine) fn get_print_settings(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> domain_types::domain::print::PrintSettings {
    print::get_print_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_hf_images(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
    print::get_hf_images(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_sheet_meta(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<SheetMeta> {
    properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn has_sheet_protection_password(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    settings
        .protection_password_hash
        .map(|h| !h.is_empty())
        .unwrap_or(false)
}

// -------------------------------------------------------------------
// Cell Values (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_cell_data(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<serde_json::Value> {
    let grid_index = stores.grid_indexes.get(sheet_id)?;
    let data = cell_values::get_cell_data(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        col,
        grid_index,
    )?;
    Some(cell_data_to_json(&data))
}

pub(in crate::storage::engine) fn get_cell_data_by_id_hex(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<serde_json::Value> {
    let id_u128 = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(id_u128);
    let grid_index = stores.grid_indexes.get(sheet_id)?;
    let data = cell_values::get_cell_data_by_id(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cell_id,
        grid_index,
    )?;
    Some(cell_data_to_json(&data))
}

pub(in crate::storage::engine) fn get_raw_value(
    mirror: &CellMirror,
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> String {
    if let Some(formula) =
        crate::storage::engine::data_table_formula::formula_at(mirror, sheet_id, row, col)
    {
        return formula;
    }
    let Some(grid_index) = stores.grid_indexes.get(sheet_id) else {
        return String::new();
    };
    cell_values::get_raw_value(
        mirror,
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        col,
        grid_index,
    )
}

pub(in crate::storage::engine) fn get_effective_value(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<serde_json::Value> {
    let value = cell_values::get_effective_value(mirror, sheet_id, row, col)?;
    Some(cell_value_to_json(&value))
}

pub(in crate::storage::engine) fn get_cell_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> usize {
    cell_values::get_cell_count(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

// -------------------------------------------------------------------
// Cell Iteration (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_current_region(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
) -> RectBounds {
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return RectBounds {
            start_row,
            start_col,
            end_row: start_row,
            end_col: start_col,
        };
    };
    let region = cell_iter::get_current_region(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        start_row,
        start_col,
    );
    RectBounds {
        start_row: region.start_row(),
        start_col: region.start_col(),
        end_row: region.end_row(),
        end_col: region.end_col(),
    }
}

pub(in crate::storage::engine) fn find_data_edge(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    direction: &str,
) -> CellPosition {
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return CellPosition { row, col };
    };
    cell_iter::find_data_edge(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
        direction,
    )
}

/// Find the last populated row in a column. Returns data and formatting edges.
pub(in crate::storage::engine) fn find_last_row(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    col: u32,
) -> ColumnEdge {
    let mut last_data_row: Option<u32> = None;

    // 1. Scan CellMirror cells (value / formula cells) for this column.
    if let Some(sheet) = mirror.get_sheet(sheet_id) {
        for (cell_id, entry) in sheet.cells_iter() {
            if entry.is_ghost() {
                continue;
            }
            if let Some(pos) = sheet.position_of(cell_id)
                && pos.col() == col
            {
                last_data_row = Some(last_data_row.map_or(pos.row(), |cur| cur.max(pos.row())));
            }
        }

        // 2. Scan col_data (spill arrays, pivot output, etc.) for this column.
        if let Some(col_slice) = sheet.get_column_slice(col) {
            for (row, val) in col_slice.iter().enumerate() {
                if !val.is_null() {
                    last_data_row =
                        Some(last_data_row.map_or(row as u32, |cur| cur.max(row as u32)));
                }
            }
        }
    }

    // 3. Scan CRDT format properties for this column.
    let mut last_format_row: Option<u32> = None;
    {
        use crate::storage::properties;

        let doc = stores.storage.doc();
        let sheets_map = stores.storage.sheets();
        let grid = stores.grid_indexes.get(sheet_id);

        for cell_id_hex in properties::iter_formatted_property_cell_ids(doc, sheets_map, sheet_id) {
            if let Some((row, c)) = resolve_pos_from_grid(grid, cell_id_hex.as_str())
                && c == col
            {
                last_format_row = Some(last_format_row.map_or(row, |cur| cur.max(row)));
            }
        }
    }

    ColumnEdge {
        last_data_row,
        last_format_row,
    }
}

/// Find the last populated column in a row. Returns data and formatting edges.
pub(in crate::storage::engine) fn find_last_column(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
) -> RowEdge {
    let mut last_data_col: Option<u32> = None;

    // 1. Scan CellMirror cells (value / formula cells) for this row.
    if let Some(sheet) = mirror.get_sheet(sheet_id) {
        for (cell_id, entry) in sheet.cells_iter() {
            if entry.is_ghost() {
                continue;
            }
            if let Some(pos) = sheet.position_of(cell_id)
                && pos.row() == row
            {
                last_data_col = Some(last_data_col.map_or(pos.col(), |cur| cur.max(pos.col())));
            }
        }

        // 2. Scan col_data for all columns at this row.
        if !sheet.col_data_is_empty() && sheet.rows > row {
            for c in 0..sheet.cols {
                if let Some(col_slice) = sheet.get_column_slice(c)
                    && let Some(val) = col_slice.get(row as usize)
                    && !val.is_null()
                {
                    last_data_col = Some(last_data_col.map_or(c, |cur| cur.max(c)));
                }
            }
        }
    }

    // 3. Scan CRDT format properties for this row.
    let mut last_format_col: Option<u32> = None;
    {
        use crate::storage::properties;

        let doc = stores.storage.doc();
        let sheets_map = stores.storage.sheets();
        let grid = stores.grid_indexes.get(sheet_id);

        for cell_id_hex in properties::iter_formatted_property_cell_ids(doc, sheets_map, sheet_id) {
            if let Some((r, c)) = resolve_pos_from_grid(grid, cell_id_hex.as_str())
                && r == row
            {
                last_format_col = Some(last_format_col.map_or(c, |cur| cur.max(c)));
            }
        }
    }

    RowEdge {
        last_data_col,
        last_format_col,
    }
}

pub(in crate::storage::engine) fn get_cell_id_at_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let grid = stores.grid_indexes.get(sheet_id)?;
    grid.cell_id_at(row, col)
        .map(|cid| id_to_hex(cid.as_u128()).into())
}

pub(in crate::storage::engine) fn get_cells_in_range(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<String> {
    let grid = match stores.grid_indexes.get(sheet_id) {
        Some(g) => g,
        None => return vec![],
    };
    grid.cells_in_range(start_row, start_col, end_row, end_col)
        .map(|(cid, _, _)| id_to_hex(cid.as_u128()).into())
        .collect()
}

pub(in crate::storage::engine) fn get_all_cells_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> serde_json::Value {
    let mut cells = Vec::new();
    let Some(grid_index) = stores.grid_indexes.get(sheet_id) else {
        return serde_json::Value::Array(cells);
    };
    cell_iter::for_each_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid_index,
        |row, col, data| {
            let mut entry = serde_json::json!({
                "cell_id": id_to_hex(data.cell_id.as_u128()),
                "row": row,
                "col": col,
            });
            if let Some(ref value) = data.value {
                entry["value"] = cell_value_to_json(value);
            }
            if let Some(ref formula) = data.formula {
                entry["formula"] = serde_json::Value::String(formula.clone());
            }
            cells.push(entry);
        },
    );
    serde_json::Value::Array(cells)
}

pub(in crate::storage::engine) fn get_cells_in_range_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> serde_json::Value {
    let range = cell_types::RangePos::new(*sheet_id, start_row, start_col, end_row, end_col);
    let mut cells = Vec::new();
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return serde_json::Value::Array(cells);
    };
    cell_iter::for_each_cell_in_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        &range,
        |row, col, data| {
            if let Some(data) = data {
                let mut entry = serde_json::json!({
                    "cell_id": id_to_hex(data.cell_id.as_u128()),
                    "row": row,
                    "col": col,
                    "has_data": true,
                });
                if let Some(ref value) = data.value {
                    entry["value"] = cell_value_to_json(value);
                }
                if let Some(ref formula) = data.formula {
                    entry["formula"] = serde_json::Value::String(formula.clone());
                }
                cells.push(entry);
            } else {
                cells.push(serde_json::json!({
                    "row": row,
                    "col": col,
                    "has_data": false,
                }));
            }
        },
    );
    serde_json::Value::Array(cells)
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn get_data_bounds_for_range(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    is_full_column: bool,
    is_full_row: bool,
) -> Option<RectBounds> {
    let range = cell_types::RangePos::new(*sheet_id, start_row, start_col, end_row, end_col);
    let span = if is_full_column {
        cell_iter::RangeSpan::FullColumns
    } else if is_full_row {
        cell_iter::RangeSpan::FullRows
    } else {
        cell_iter::RangeSpan::Exact
    };

    let grid = stores.grid_indexes.get(sheet_id)?;
    let bounded = cell_iter::get_data_bounds_for_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        &range,
        span,
    )?;

    Some(RectBounds {
        start_row: bounded.start_row(),
        start_col: bounded.start_col(),
        end_row: bounded.end_row(),
        end_col: bounded.end_col(),
    })
}

// -------------------------------------------------------------------
// Range Parsing & Stringification
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn parse_range_ref(range_str: &str) -> Option<A1RangeRef> {
    range_manager::parse_range(range_str)
}

pub(in crate::storage::engine) fn stringify_range_ref(range: &A1RangeRef) -> Option<String> {
    Some(range_manager::stringify_range(range))
}

pub(in crate::storage::engine) fn parse_cell_ref(cell_str: &str) -> Option<A1CellRef> {
    range_manager::parse_cell(cell_str)
}

pub(in crate::storage::engine) fn stringify_cell_ref(cell: &A1CellRef) -> Option<String> {
    Some(range_manager::stringify_cell(cell))
}

// -------------------------------------------------------------------
// Spatial Range Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_merges_in_viewport_spatial(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<MergeRegion> {
    let viewport = ViewportBounds {
        min_row: start_row,
        max_row: end_row,
        min_col: start_col,
        max_col: end_col,
    };

    if let Some(index) = stores.merge_indexes.get(sheet_id) {
        let resolver = MergeDirectResolver;
        let items = index.get_items_in_viewport(&viewport, &resolver);
        return items
            .values()
            .map(|item| MergeRegion {
                start_row: item.start_row,
                start_col: item.start_col,
                end_row: item.end_row,
                end_col: item.end_col,
            })
            .collect();
    }

    let merges_vec = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_merges_in_viewport(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        ),
        None => Vec::new(),
    };
    merges_vec
        .into_iter()
        .map(|m| MergeRegion {
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
        })
        .collect()
}

pub(in crate::storage::engine) fn get_merge_at_cell_spatial(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    if let Some(index) = stores.merge_indexes.get(sheet_id) {
        let resolver = MergeDirectResolver;
        let items = index.get_items_for_cell(row, col, &resolver);
        if let Some(item) = items.first() {
            let is_origin = row == item.start_row && col == item.start_col;
            return Some(CellMergeInfo {
                merge: ResolvedMergedRegion::new(
                    IdentityMergedRegion {
                        top_left_id: String::new(),
                        bottom_right_id: String::new(),
                    },
                    item.start_row,
                    item.start_col,
                    item.end_row,
                    item.end_col,
                ),
                is_origin,
            });
        }
        return None;
    }

    let grid = stores.grid_indexes.get(sheet_id)?;
    merges::get_merge_for_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
    )
}

// -------------------------------------------------------------------
// Shared Cell Visitor
// -------------------------------------------------------------------

/// Per-cell data yielded by the shared cell visitor.
pub(in crate::storage::engine) struct CellVisit {
    pub row: u32,
    pub col: u32,
    pub cell_id: Option<cell_types::CellId>,
    pub value: value_types::CellValue,
    pub formatted: String,
    pub formula: Option<String>,
    pub is_projection: bool,
    pub effective_format: domain_types::CellFormat,
}

/// Iterate all non-empty cells in the given range, handling merge redirects,
/// ComputeCore-first value priority, spill values, and locale-aware formatting.
/// This is the single source of truth for "how to walk cells correctly."
///
/// - `include_format_only`: if true, emit cells that have row/col/range formatting only
///   (no value, no formula). `query_range` passes true; `regex_search` passes false.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn for_each_cell_in_range(
    engine: &crate::storage::engine::YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    include_format_only: bool,
    visitor: &mut impl FnMut(CellVisit),
) {
    use crate::storage::properties;
    use std::collections::HashMap;
    use value_types::CellValue;

    let locale = &engine.settings.locale;
    let mirror = &engine.mirror;
    let sheet_mirror = mirror.get_sheet(sheet_id);

    if let Some(grid) = engine.stores.grid_indexes.get(sheet_id) {
        // Build merge child→origin lookup for this range
        let merge_origins: HashMap<(u32, u32), (u32, u32)> = {
            let all_merges = merges::get_all_merges(
                engine.stores.storage.doc(),
                engine.stores.storage.sheets(),
                *sheet_id,
                grid,
            );
            let mut map = HashMap::new();
            for m in &all_merges {
                let origin = (m.start_row, m.start_col);
                for r in m.start_row..=m.end_row {
                    for c in m.start_col..=m.end_col {
                        if (r, c) != origin {
                            map.insert((r, c), origin);
                        }
                    }
                }
            }
            map
        };

        // Pre-cache column formats (one CRDT read per column, not per cell).
        let col_fmt_cache: HashMap<u32, bool> = (start_col..=end_col)
            .map(|c| {
                let has = properties::get_col_format(
                    &engine.stores.storage,
                    sheet_id,
                    c,
                    engine.stores.grid_indexes.get(sheet_id),
                )
                .is_some();
                (c, has)
            })
            .collect();

        for row in start_row..=end_row {
            // Cache row format once per row (not per cell).
            let has_row_fmt = properties::get_row_format(
                &engine.stores.storage,
                sheet_id,
                row,
                engine.stores.grid_indexes.get(sheet_id),
            )
            .is_some();

            for col in start_col..=end_col {
                let has_col_fmt = col_fmt_cache.get(&col).copied().unwrap_or(false);
                let has_range_fmt = sheet_mirror
                    .map(|sm| !sm.format_ranges_at(row, col).is_empty())
                    .unwrap_or(false);

                let cell_id_raw = grid.cell_id_at(row, col);

                // Merge-aware: redirect child cells to origin
                let cell_id_opt =
                    if let Some(&(origin_row, origin_col)) = merge_origins.get(&(row, col)) {
                        grid.cell_id_at(origin_row, origin_col).or(cell_id_raw)
                    } else {
                        cell_id_raw
                    };

                if let Some(cell_id) = cell_id_opt {
                    // ComputeCore-first value read (same pattern as get_active_cell)
                    let value = engine
                        .stores
                        .compute
                        .get_cell_value(&engine.mirror, &cell_id)
                        .cloned()
                        .unwrap_or_else(|| {
                            mirror
                                .get_cell_value_in_sheet(sheet_id, &cell_id)
                                .cloned()
                                .unwrap_or(CellValue::Null)
                        });

                    // Actual formula text from ComputeCore, mirror identity formula fallback
                    let formula = engine
                        .stores
                        .compute
                        .get_formula(&cell_id)
                        .map(|s| s.to_string())
                        .or_else(|| {
                            mirror
                                .get_formula(&cell_id)
                                .map(|f| format!("={}", f.template))
                        })
                        .or_else(|| {
                            crate::storage::engine::data_table_formula::formula_at(
                                mirror, sheet_id, row, col,
                            )
                        });

                    let cell_id_hex = id_to_hex(cell_id.as_u128());

                    // Pre-fetch cell-level format (one CRDT read) — used
                    // both for the skip check and for effective format build.
                    let cell_fmt = properties::get_cell_format(
                        engine.stores.storage.doc(),
                        engine.stores.storage.workbook_map(),
                        engine.stores.storage.sheets(),
                        sheet_id,
                        &cell_id_hex,
                    );

                    // Skip truly empty cells: no value, no formula, no cell-level formatting,
                    // AND no explicit row/column format.
                    if matches!(value, CellValue::Null)
                        && formula.is_none()
                        && cell_fmt.is_none()
                        && !has_row_fmt
                        && !has_col_fmt
                        && !has_range_fmt
                    {
                        continue;
                    }

                    // Build effective format reusing the pre-fetched cell format
                    let table_fmt =
                        super::tables::resolve_table_format_at_cell(mirror, sheet_id, row, col);
                    let mut effective = properties::get_effective_format_preloaded(
                        &engine.stores.storage,
                        sheet_id,
                        row,
                        col,
                        table_fmt.as_ref(),
                        &cell_fmt.unwrap_or_default(),
                        engine.stores.grid_indexes.get(sheet_id),
                        sheet_mirror,
                    );
                    domain_types::theme_color::resolve_theme_refs(
                        &mut effective,
                        &engine.settings.theme_palette,
                    );
                    let format_code = effective.number_format.as_deref().unwrap_or("General");
                    let format_result = compute_formats::format_value(&value, format_code, locale);
                    let formatted = format_result.text;

                    visitor(CellVisit {
                        row,
                        col,
                        cell_id: Some(cell_id),
                        value,
                        formatted,
                        formula,
                        is_projection: false,
                        effective_format: effective,
                    });
                } else if let Some(proj_value) =
                    mirror.get_cell_value_at(sheet_id, SheetPos::new(row, col))
                {
                    // No real cell at this position — check for materialized
                    // projection (spill) values in col_data.
                    if !proj_value.is_null() {
                        let value = proj_value.clone();
                        let table_fmt =
                            super::tables::resolve_table_format_at_cell(mirror, sheet_id, row, col);
                        let empty_cell_id_hex = String::new();
                        let mut effective = properties::get_effective_format(
                            &engine.stores.storage,
                            sheet_id,
                            &empty_cell_id_hex,
                            row,
                            col,
                            table_fmt.as_ref(),
                            engine.stores.grid_indexes.get(sheet_id),
                            sheet_mirror,
                        );
                        domain_types::theme_color::resolve_theme_refs(
                            &mut effective,
                            &engine.settings.theme_palette,
                        );
                        let format_code = effective.number_format.as_deref().unwrap_or("General");
                        let format_result =
                            compute_formats::format_value(&value, format_code, locale);
                        let formatted = format_result.text;

                        visitor(CellVisit {
                            row,
                            col,
                            cell_id: None,
                            value,
                            formatted,
                            formula: None,
                            is_projection: true,
                            effective_format: effective,
                        });
                    }
                } else if include_format_only && (has_row_fmt || has_col_fmt || has_range_fmt) {
                    // No cell_id, no spill value — but explicit row/column
                    // format exists that should be visible to the API.
                    let table_fmt =
                        super::tables::resolve_table_format_at_cell(mirror, sheet_id, row, col);
                    let empty_cell_id_hex = String::new();
                    let mut effective = properties::get_effective_format(
                        &engine.stores.storage,
                        sheet_id,
                        &empty_cell_id_hex,
                        row,
                        col,
                        table_fmt.as_ref(),
                        engine.stores.grid_indexes.get(sheet_id),
                        sheet_mirror,
                    );
                    domain_types::theme_color::resolve_theme_refs(
                        &mut effective,
                        &engine.settings.theme_palette,
                    );

                    visitor(CellVisit {
                        row,
                        col,
                        cell_id: None,
                        value: CellValue::Null,
                        formatted: String::new(),
                        formula: None,
                        is_projection: false,
                        effective_format: effective,
                    });
                }
            }
        }
    }
}

// -------------------------------------------------------------------
// Regex Search
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn regex_search(
    engine: &crate::storage::engine::YrsComputeEngine,
    sheet_id: &SheetId,
    options: RegexSearchOptions,
) -> RegexSearchResult {
    let case_insensitive = !options.case_sensitive.unwrap_or(false);
    let whole_cell = options.whole_cell.unwrap_or(false);
    let include_formulas = options.include_formulas.unwrap_or(false);

    // 1. Compile patterns with regex crate
    let mut compiled = Vec::new();
    let mut errors = Vec::new();
    for pattern in &options.patterns {
        let mut p = pattern.clone();
        if case_insensitive {
            p = format!("(?i){}", p);
        }
        if whole_cell {
            p = format!("^(?:{})$", p);
        }
        match regex::Regex::new(&p) {
            Ok(re) => compiled.push((pattern.clone(), re)),
            Err(e) => errors.push(format!("Pattern '{}': {}", pattern, e)),
        }
    }

    let sheet_name = get_sheet_name(&engine.stores, sheet_id).unwrap_or_default();

    if compiled.is_empty() {
        return RegexSearchResult {
            matches: vec![],
            errors,
        };
    }

    // 2. Get data bounds and clamp to optional range constraint
    let bounds = match get_data_bounds(&engine.stores, &engine.mirror, sheet_id) {
        Some(b) => b,
        None => {
            return RegexSearchResult {
                matches: vec![],
                errors,
            };
        }
    };

    let min_row = options
        .start_row
        .map_or(bounds.min_row, |r| r.max(bounds.min_row));
    let min_col = options
        .start_col
        .map_or(bounds.min_col, |c| c.max(bounds.min_col));
    let max_row = options
        .end_row
        .map_or(bounds.max_row, |r| r.min(bounds.max_row));
    let max_col = options
        .end_col
        .map_or(bounds.max_col, |c| c.min(bounds.max_col));

    // 3. Iterate cells using shared visitor
    let mut matches = Vec::new();

    for_each_cell_in_range(
        engine,
        sheet_id,
        min_row,
        min_col,
        max_row,
        max_col,
        false, // skip format-only cells
        &mut |visit| {
            // Test formatted display string against patterns
            for (original_pattern, re) in &compiled {
                if re.is_match(&visit.formatted) {
                    matches.push(RegexSearchMatch {
                        row: visit.row,
                        col: visit.col,
                        address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                        sheet_name: sheet_name.clone(),
                        value: visit.formatted.clone(),
                        matched_pattern: original_pattern.clone(),
                    });
                    return; // one match per cell (first pattern wins)
                }
            }

            // Optionally test formula text
            if include_formulas && let Some(ref formula) = visit.formula {
                for (original_pattern, re) in &compiled {
                    if re.is_match(formula) {
                        matches.push(RegexSearchMatch {
                            row: visit.row,
                            col: visit.col,
                            address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                            sheet_name: sheet_name.clone(),
                            value: visit.formatted.clone(),
                            matched_pattern: original_pattern.clone(),
                        });
                        return;
                    }
                }
            }
        },
    );

    RegexSearchResult { matches, errors }
}

// -------------------------------------------------------------------
// Sign Check
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn sign_check(
    engine: &crate::storage::engine::YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: SignCheckOptions,
) -> SignCheckResult {
    use std::collections::BTreeMap;

    let axis = options.axis.as_deref().unwrap_or("column");
    let window = options.window.unwrap_or(3) as usize;

    // Pass 1: Collect all non-zero numeric cell values in the range.
    let mut cells: BTreeMap<(u32, u32), f64> = BTreeMap::new();

    for_each_cell_in_range(
        engine,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        false,
        &mut |visit| {
            if let Some(num) = visit.value.as_number()
                && num != 0.0
            {
                cells.insert((visit.row, visit.col), num);
            }
        },
    );

    let cells_checked = cells.len() as u32;

    // Pass 2: For each cell, find neighbors and compute disagreement.
    let mut anomalies = Vec::new();

    for (&(row, col), &value) in &cells {
        let mut neighbors: Vec<(u32, u32, f64)> = Vec::new();

        if axis == "column" || axis == "both" {
            // Collect cells in the same column, sorted by row distance.
            let mut col_cells: Vec<(u32, f64)> = cells
                .iter()
                .filter(|&(&(r, c), _)| c == col && r != row)
                .map(|(&(r, _), &v)| (r, v))
                .collect();
            col_cells.sort_by_key(|&(r, _)| row.abs_diff(r));

            // Take up to `window` before and `window` after.
            let mut before = 0usize;
            let mut after = 0usize;
            for (r, v) in &col_cells {
                if *r < row && before < window {
                    neighbors.push((*r, col, *v));
                    before += 1;
                } else if *r > row && after < window {
                    neighbors.push((*r, col, *v));
                    after += 1;
                }
                if before >= window && after >= window {
                    break;
                }
            }
        }

        if axis == "row" || axis == "both" {
            // Collect cells in the same row, sorted by column distance.
            let mut row_cells: Vec<(u32, f64)> = cells
                .iter()
                .filter(|&(&(r, c), _)| r == row && c != col)
                .map(|(&(_, c), &v)| (c, v))
                .collect();
            row_cells.sort_by_key(|&(c, _)| col.abs_diff(c));

            let mut before = 0usize;
            let mut after = 0usize;
            for (c, v) in &row_cells {
                if *c < col && before < window {
                    neighbors.push((row, *c, *v));
                    before += 1;
                } else if *c > col && after < window {
                    neighbors.push((row, *c, *v));
                    after += 1;
                }
                if before >= window && after >= window {
                    break;
                }
            }
        }

        if neighbors.is_empty() {
            continue;
        }

        let cell_positive = value > 0.0;
        let disagree_count = neighbors
            .iter()
            .filter(|&&(_, _, v)| (v > 0.0) != cell_positive)
            .count();
        let disagreement = disagree_count as f64 / neighbors.len() as f64;

        if disagreement > 0.5 {
            // `value` and neighbor `v` come from `CellValue::Number`'s inner
            // `FiniteF64`, so they are finite by construction — `must` is
            // correct. `disagreement` is `disagree_count / neighbors.len()`
            // with the `if neighbors.is_empty() { continue; }` guard above,
            // so the divisor is positive — also finite.
            anomalies.push(SignAnomaly {
                row,
                col,
                cell: crate::range_manager::pos_to_a1(row, col),
                value: value_types::FiniteF64::must(value),
                disagreement: value_types::FiniteF64::must(disagreement),
                neighbors: neighbors
                    .iter()
                    .map(|&(r, c, v)| SignNeighbor {
                        cell: crate::range_manager::pos_to_a1(r, c),
                        value: value_types::FiniteF64::must(v),
                    })
                    .collect(),
            });
        }
    }

    // Sort by disagreement descending (strongest signals first).
    anomalies.sort_by(|a, b| {
        b.disagreement
            .partial_cmp(&a.disagreement)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    SignCheckResult {
        cells_checked,
        anomalies,
    }
}

// -------------------------------------------------------------------
// Find in Range (literal text search via regex crate)
// -------------------------------------------------------------------

use crate::engine_types::queries::{FindInRangeOptions, FindInRangeResult};

/// Build a compiled regex from `FindInRangeOptions`.
///
/// The search text is regex-escaped (literal match). Case-insensitive
/// and whole-cell anchoring are applied based on options.
fn build_find_regex(options: &FindInRangeOptions) -> Option<regex::Regex> {
    if options.text.is_empty() {
        return None;
    }
    let escaped = regex::escape(&options.text);
    let pattern = if options.whole_cell.unwrap_or(false) {
        format!("^(?:{escaped})$")
    } else {
        escaped
    };
    let case_insensitive = !options.case_sensitive.unwrap_or(false);
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(case_insensitive)
        .build()
        .ok()
}

/// Find the first cell matching literal text in a range.
pub(in crate::storage::engine) fn find_in_range(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: FindInRangeOptions,
) -> Option<FindInRangeResult> {
    let re = build_find_regex(&options)?;
    let range = cell_types::RangePos::new(*sheet_id, start_row, start_col, end_row, end_col);
    let mut result: Option<FindInRangeResult> = None;
    let grid = stores.grid_indexes.get(sheet_id)?;

    cell_iter::for_each_cell_in_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        &range,
        |row, col, data| {
            if result.is_some() {
                return; // already found first match
            }
            if let Some(data) = data {
                let display = match &data.value {
                    Some(v) if !matches!(v, value_types::CellValue::Null) => v.to_string(),
                    _ => return,
                };
                if !display.is_empty() && re.is_match(&display) {
                    result = Some(FindInRangeResult {
                        row,
                        col,
                        address: crate::range_manager::pos_to_a1(row, col),
                        value: display,
                    });
                }
            }
        },
    );

    result
}

/// Find all cells matching literal text in a range.
pub(in crate::storage::engine) fn find_all_in_range(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: FindInRangeOptions,
) -> Vec<FindInRangeResult> {
    let re = match build_find_regex(&options) {
        Some(r) => r,
        None => return Vec::new(),
    };
    let range = cell_types::RangePos::new(*sheet_id, start_row, start_col, end_row, end_col);
    let mut results = Vec::new();
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return results;
    };

    cell_iter::for_each_cell_in_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        &range,
        |row, col, data| {
            if let Some(data) = data {
                let display = match &data.value {
                    Some(v) if !matches!(v, value_types::CellValue::Null) => v.to_string(),
                    _ => return,
                };
                if !display.is_empty() && re.is_match(&display) {
                    results.push(FindInRangeResult {
                        row,
                        col,
                        address: crate::range_manager::pos_to_a1(row, col),
                        value: display,
                    });
                }
            }
        },
    );

    results
}

// -------------------------------------------------------------------
// Workbook-wide Regex Search
// -------------------------------------------------------------------

/// Search all sheets for cells matching regex patterns.
///
/// Compiles patterns once, then iterates each sheet's data bounds.
/// Range constraint from `options` is applied per-sheet when present.
pub(in crate::storage::engine) fn regex_search_all_sheets(
    engine: &crate::storage::engine::YrsComputeEngine,
    options: RegexSearchOptions,
) -> WorkbookSearchResult {
    let case_insensitive = !options.case_sensitive.unwrap_or(false);
    let whole_cell = options.whole_cell.unwrap_or(false);
    let include_formulas = options.include_formulas.unwrap_or(false);

    // 1. Compile patterns once
    let mut compiled = Vec::new();
    let mut errors = Vec::new();
    for pattern in &options.patterns {
        let mut p = pattern.clone();
        if case_insensitive {
            p = format!("(?i){}", p);
        }
        if whole_cell {
            p = format!("^(?:{})$", p);
        }
        match regex::Regex::new(&p) {
            Ok(re) => compiled.push((pattern.clone(), re)),
            Err(e) => errors.push(format!("Pattern '{}': {}", pattern, e)),
        }
    }

    if compiled.is_empty() {
        return WorkbookSearchResult {
            matches: vec![],
            errors,
        };
    }

    // 2. Iterate all sheets in tab order
    let sheet_ids = engine.stores.storage.sheet_order();
    let mut matches = Vec::new();

    for sheet_id in &sheet_ids {
        let sheet_name = properties::get_sheet_name(
            engine.stores.storage.doc(),
            engine.stores.storage.sheets(),
            sheet_id,
        )
        .unwrap_or_else(|| id_to_hex(sheet_id.as_u128()).into());

        let bounds = match get_data_bounds(&engine.stores, &engine.mirror, sheet_id) {
            Some(b) => b,
            None => continue,
        };

        // Clamp to optional range constraint (applied per-sheet)
        let min_row = options
            .start_row
            .map_or(bounds.min_row, |r| r.max(bounds.min_row));
        let min_col = options
            .start_col
            .map_or(bounds.min_col, |c| c.max(bounds.min_col));
        let max_row = options
            .end_row
            .map_or(bounds.max_row, |r| r.min(bounds.max_row));
        let max_col = options
            .end_col
            .map_or(bounds.max_col, |c| c.min(bounds.max_col));

        for_each_cell_in_range(
            engine,
            sheet_id,
            min_row,
            min_col,
            max_row,
            max_col,
            false,
            &mut |visit| {
                for (original_pattern, re) in &compiled {
                    if re.is_match(&visit.formatted) {
                        matches.push(WorkbookSearchMatch {
                            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
                            sheet_name: sheet_name.clone(),
                            row: visit.row,
                            col: visit.col,
                            address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                            value: visit.formatted.clone(),
                            matched_pattern: original_pattern.clone(),
                        });
                        return;
                    }
                }

                if include_formulas && let Some(ref formula) = visit.formula {
                    for (original_pattern, re) in &compiled {
                        if re.is_match(formula) {
                            matches.push(WorkbookSearchMatch {
                                sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
                                sheet_name: sheet_name.clone(),
                                row: visit.row,
                                col: visit.col,
                                address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                                value: visit.formatted.clone(),
                                matched_pattern: original_pattern.clone(),
                            });
                            return;
                        }
                    }
                }
            },
        );
    }

    WorkbookSearchResult { matches, errors }
}
