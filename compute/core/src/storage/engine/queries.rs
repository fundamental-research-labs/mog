//! Read-only query methods for YrsComputeEngine.

use super::YrsComputeEngine;
use crate::diagnostics::formula_references::{
    FormulaReferenceDiagnosticsOptions, FormulaReferenceDiagnosticsPage,
};
use crate::engine_types::{
    CellPosition, CellPositionResult, ColumnEdge, DataBounds, DefaultFont, ProjectionData,
    RectBounds, RegexSearchOptions, RegexSearchResult, RowEdge, SheetProtectionConfig,
    SignCheckOptions, SignCheckResult, WorkbookSearchResult,
};
use crate::eval::Evaluator;
use crate::eval::sync_block_on;
use crate::eval_bridge::MirrorContext;
use crate::mirror::MirrorPositionLookup;
use crate::range_manager::{self, A1CellRef, A1RangeRef};
use crate::snapshot::{
    BatchRangeEntry, BatchRangeRequest, BatchRangeResponse, BatchRangeResult, CalculationSettings,
    ChangeKind, IdentityCell, MutationResult, ProtectedWorkbookOperation, RangeCellData,
    RangeQueryResult, RustWorkbookSettingsPatch, ViewportMerge, WorkbookProtectionOptions,
    WorkbookSettings, WorkbookSettingsChange,
};
use crate::storage::cells::values as cell_values;
use crate::storage::properties;
use crate::storage::sheet::{hyperlinks, merges, properties as sheets};
use crate::storage::workbook::settings as workbook;
use bridge_core as bridge;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::undo::{ORIGIN_UI_STATE, ORIGIN_USER_EDIT};
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use domain_types::{DefinedName, NameValidationResult};
use formula_types::WorkbookLookup;
use value_types::CellValue;
use value_types::ComputeError;

/// Compute the top-level object keys whose values differ between two JSON
/// snapshots. Used by workbook-settings mutations to populate
/// `WorkbookSettingsChange.changed_keys`.
///
/// Both inputs are expected to be JSON objects (the result of serializing a
/// `WorkbookSettings`); non-object inputs return all keys present in `post`
/// (or empty if neither is an object).
fn diff_top_level_keys(pre: &serde_json::Value, post: &serde_json::Value) -> Vec<String> {
    match (pre.as_object(), post.as_object()) {
        (Some(pre_map), Some(post_map)) => {
            let mut keys: Vec<String> = Vec::new();
            for (k, v_post) in post_map {
                match pre_map.get(k) {
                    Some(v_pre) if v_pre == v_post => {}
                    _ => keys.push(k.clone()),
                }
            }
            for k in pre_map.keys() {
                if !post_map.contains_key(k) {
                    keys.push(k.clone());
                }
            }
            keys
        }
        (None, Some(post_map)) => post_map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

fn workbook_settings_origin_for_change(changed_keys: &[String]) -> &'static [u8] {
    if changed_keys
        .iter()
        .all(|key| key.as_str() == "selectedSheetIds")
    {
        ORIGIN_UI_STATE
    } else {
        ORIGIN_USER_EDIT
    }
}

fn intended_patch_changed_keys(patch: &RustWorkbookSettingsPatch) -> Vec<String> {
    let mut keys = Vec::new();
    macro_rules! push_if_some {
        ($field:expr, $key:literal) => {
            if $field.is_some() {
                keys.push($key.to_string());
            }
        };
    }
    push_if_some!(patch.show_horizontal_scrollbar, "showHorizontalScrollbar");
    push_if_some!(patch.show_vertical_scrollbar, "showVerticalScrollbar");
    push_if_some!(patch.auto_hide_scroll_bars, "autoHideScrollBars");
    push_if_some!(patch.show_tab_strip, "showTabStrip");
    push_if_some!(patch.show_formula_bar, "showFormulaBar");
    push_if_some!(patch.allow_sheet_reorder, "allowSheetReorder");
    push_if_some!(patch.auto_fit_on_double_click, "autoFitOnDoubleClick");
    push_if_some!(patch.show_cut_copy_indicator, "showCutCopyIndicator");
    push_if_some!(patch.allow_drag_fill, "allowDragFill");
    push_if_some!(patch.enter_key_direction, "enterKeyDirection");
    push_if_some!(patch.allow_cell_drag_drop, "allowCellDragDrop");
    push_if_some!(patch.theme_id, "themeId");
    push_if_some!(patch.theme_fonts_id, "themeFontsId");
    push_if_some!(patch.culture, "culture");
    push_if_some!(patch.selected_sheet_ids, "selectedSheetIds");
    push_if_some!(patch.is_workbook_protected, "isWorkbookProtected");
    push_if_some!(
        patch.workbook_protection_password_hash,
        "workbookProtectionPasswordHash"
    );
    push_if_some!(
        patch.workbook_protection_options,
        "workbookProtectionOptions"
    );
    push_if_some!(patch.calculation_settings, "calculationSettings");
    push_if_some!(patch.date1904, "date1904");
    push_if_some!(patch.default_table_style_id, "defaultTableStyleId");
    push_if_some!(patch.custom_settings, "customSettings");
    push_if_some!(
        patch.automatic_conversion_policy,
        "automaticConversionPolicy"
    );
    keys
}

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "queries",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Workbook Settings
    // -------------------------------------------------------------------

    #[bridge::read(scope = "workbook")]
    pub fn get_workbook_settings(&self) -> WorkbookSettings {
        super::services::queries::get_workbook_settings(&self.stores)
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_formula_reference_diagnostics(
        &self,
        options: FormulaReferenceDiagnosticsOptions,
    ) -> Result<FormulaReferenceDiagnosticsPage, ComputeError> {
        crate::diagnostics::formula_references::collect_formula_reference_diagnostics(
            &self.mirror,
            &self.stores.compute,
            options,
        )
    }

    #[bridge::write(scope = "workbook")]
    pub fn set_workbook_settings(
        &mut self,
        settings: WorkbookSettings,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let pre = workbook::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let desired_json =
            serde_json::to_value(&settings).expect("WorkbookSettings must serialize");
        let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");
        let intended_changed_keys = diff_top_level_keys(&pre_json, &desired_json);
        let origin = workbook_settings_origin_for_change(&intended_changed_keys);

        workbook::set_settings_with_origin(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            &settings,
            origin,
        );
        let post = workbook::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let pre_calc = pre.calculation_settings.clone().unwrap_or_default();
        let post_calc = post.calculation_settings.clone().unwrap_or_default();
        self.sync_runtime_calculation_settings(&pre_calc, &post_calc);

        let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
        let changed_keys = diff_top_level_keys(&pre_json, &post_json);
        let mut result = MutationResult::empty();
        result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Set,
                changed_keys,
                settings: post_json,
            });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    #[bridge::write(scope = "workbook")]
    pub fn patch_workbook_settings(
        &mut self,
        patch: RustWorkbookSettingsPatch,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let pre = workbook::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");
        let intended_changed_keys = intended_patch_changed_keys(&patch);
        let origin = workbook_settings_origin_for_change(&intended_changed_keys);

        let changed = workbook::patch_settings_with_origin(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            &patch,
            origin,
        );
        if !changed {
            return Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ));
        }

        let post = workbook::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let pre_calc = pre.calculation_settings.clone().unwrap_or_default();
        let post_calc = post.calculation_settings.clone().unwrap_or_default();
        self.sync_runtime_calculation_settings(&pre_calc, &post_calc);

        let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
        let changed_keys = diff_top_level_keys(&pre_json, &post_json);
        let mut result = MutationResult::empty();
        result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Set,
                changed_keys,
                settings: post_json,
            });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // -------------------------------------------------------------------
    // Document Properties
    // -------------------------------------------------------------------

    /// Get document properties (title, creator, description, etc.).
    #[bridge::read(scope = "workbook")]
    pub fn get_document_properties(&self) -> domain_types::DocumentProperties {
        super::services::queries::get_document_properties(&self.stores)
    }

    /// Set document properties (title, creator, description, etc.).
    #[bridge::write(scope = "workbook")]
    pub fn set_document_properties(
        &self,
        props: domain_types::DocumentProperties,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        super::services::queries::set_document_properties(&self.stores, &props);
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    // -------------------------------------------------------------------
    // Read Query IPC Methods
    // -------------------------------------------------------------------

    // GROUP 1: Sheet Metadata Queries

    /// Get ordered list of all sheet IDs as hex strings.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_sheet_ids(&self) -> Vec<String> {
        super::services::queries::get_all_sheet_ids(&self.stores)
    }

    /// Get a sheet's name by SheetId.
    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_name(&self, sheet_id: &SheetId) -> Option<String> {
        super::services::queries::get_sheet_name(&self.stores, sheet_id)
    }

    /// Check if a sheet is hidden.
    #[bridge::read(scope = "sheet")]
    pub fn is_sheet_hidden(&self, sheet_id: &SheetId) -> bool {
        super::services::queries::is_sheet_hidden(&self.stores, sheet_id)
    }

    /// Check if formula calculation is enabled for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn is_sheet_calculation_enabled(&self, sheet_id: &SheetId) -> bool {
        self.mirror.is_calculation_enabled(sheet_id)
    }

    /// Check if a sheet is protected.
    #[bridge::read(scope = "sheet")]
    pub fn is_sheet_protected(&self, sheet_id: &SheetId) -> bool {
        super::services::queries::is_sheet_protected(&self.stores, sheet_id)
    }

    // GROUP 3: Dimension Queries

    /// Check if a row is hidden.
    #[bridge::read(scope = "sheet")]
    pub fn is_row_hidden_query(&self, sheet_id: &SheetId, row: u32) -> bool {
        super::services::queries::is_row_hidden_query(&self.stores, sheet_id, row)
    }

    /// Check if a column is hidden.
    #[bridge::read(scope = "sheet")]
    pub fn is_col_hidden_query(&self, sheet_id: &SheetId, col: u32) -> bool {
        super::services::queries::is_col_hidden_query(&self.stores, sheet_id, col)
    }

    /// Get all hidden rows for a sheet, sorted.
    #[bridge::read(scope = "sheet")]
    pub fn get_hidden_rows(&self, sheet_id: &SheetId) -> Vec<u32> {
        super::services::queries::get_hidden_rows(&self.stores, sheet_id)
    }

    /// Get all hidden columns for a sheet, sorted.
    #[bridge::read(scope = "sheet")]
    pub fn get_hidden_columns(&self, sheet_id: &SheetId) -> Vec<u32> {
        super::services::queries::get_hidden_columns(&self.stores, sheet_id)
    }

    /// Get the data bounds (min/max row/col with actual cell data) for a sheet.
    #[bridge::skip(ts_bridge)]
    #[bridge::read(scope = "sheet")]
    pub fn get_data_bounds(&self, sheet_id: &SheetId) -> Option<DataBounds> {
        super::services::queries::get_data_bounds(&self.stores, &self.mirror, sheet_id)
    }

    // GROUP 1 (extended): Sheet Metadata Reads

    /// Get the position (0-based index) of a sheet in the workbook order.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::read(scope = "sheet")]
    #[bridge::skip(napi)]
    pub fn get_sheet_index(&self, sheet_id: &SheetId) -> Option<usize> {
        super::services::queries::get_sheet_index(&self.stores, sheet_id)
    }

    /// Get frozen panes configuration for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_frozen_panes_query(&self, sheet_id: &SheetId) -> FrozenPanes {
        super::services::queries::get_frozen_panes_query(&self.stores, sheet_id)
    }

    /// Get view options for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_view_options_query(&self, sheet_id: &SheetId) -> SheetViewOptions {
        super::services::queries::get_view_options_query(&self.stores, sheet_id)
    }

    /// Get the scroll position for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_scroll_position_query(&self, sheet_id: &SheetId) -> SheetScrollPosition {
        super::services::queries::get_scroll_position_query(&self.stores, sheet_id)
    }

    /// Get the tab color for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_tab_color_query(&self, sheet_id: &SheetId) -> Option<String> {
        super::services::queries::get_tab_color_query(&self.stores, sheet_id)
    }

    /// Get sheet protection configuration.
    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_protection_config(&self, sheet_id: &SheetId) -> SheetProtectionConfig {
        super::services::queries::get_sheet_protection_config(&self.stores, sheet_id)
    }

    // GROUP 3 (extended): Dimension Off-Viewport Reads

    /// Get individual row height (returns 0 for hidden rows, default for unset).
    #[bridge::read(scope = "sheet")]
    pub fn get_row_height_query(&self, sheet_id: &SheetId, row: u32) -> f64 {
        super::services::queries::get_row_height_query(&self.stores, sheet_id, row).0
    }

    /// Get individual column width (returns 0 for hidden cols, default for unset).
    #[bridge::read(scope = "sheet")]
    pub fn get_col_width_query(&self, sheet_id: &SheetId, col: u32) -> f64 {
        super::services::queries::get_col_width_query(&self.stores, sheet_id, col).0
    }

    /// Get the default row height for a sheet (converted to pixels).
    #[bridge::read(scope = "sheet")]
    pub fn get_default_row_height(&self, sheet_id: &SheetId) -> f64 {
        let pt = super::services::queries::get_default_row_height(&self.stores, sheet_id);
        domain_types::units::points_to_pixels(pt).0
    }

    /// Get the default column width for a sheet (converted to pixels).
    #[bridge::read(scope = "sheet")]
    pub fn get_default_col_width(&self, sheet_id: &SheetId) -> f64 {
        let cw = super::services::queries::get_default_col_width(&self.stores, sheet_id);
        domain_types::units::char_width_to_pixels(cw, domain_types::units::platform_mdw()).0
    }

    /// Get row heights for a range of rows as (row, height) pairs.
    #[bridge::read(scope = "sheet")]
    pub fn get_row_heights_batch(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Vec<(u32, f64)> {
        super::services::queries::get_row_heights_batch(&self.stores, sheet_id, start_row, end_row)
            .into_iter()
            .map(|(i, px)| (i, px.0))
            .collect()
    }

    /// Get column widths for a range of columns as (col, width) pairs.
    #[bridge::read(scope = "sheet")]
    pub fn get_col_widths_batch(
        &self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Vec<(u32, f64)> {
        super::services::queries::get_col_widths_batch(&self.stores, sheet_id, start_col, end_col)
            .into_iter()
            .map(|(i, px)| (i, px.0))
            .collect()
    }

    /// Get individual column width in character-width units (OOXML-native).
    /// Returns 0 for hidden cols, default char-width for unset.
    #[bridge::read(scope = "sheet")]
    pub fn get_col_width_chars_query(&self, sheet_id: &SheetId, col: u32) -> f64 {
        super::services::queries::get_col_width_chars_query(&self.stores, sheet_id, col).0
    }

    /// Get the default column width for a sheet in character-width units.
    #[bridge::read(scope = "sheet")]
    pub fn get_default_col_width_chars(&self, sheet_id: &SheetId) -> f64 {
        super::services::queries::get_default_col_width(&self.stores, sheet_id).0
    }

    /// Get column widths in character-width units for a range of columns.
    #[bridge::read(scope = "sheet")]
    pub fn get_col_widths_batch_chars(
        &self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Vec<(u32, f64)> {
        super::services::queries::get_col_widths_batch_chars(
            &self.stores,
            sheet_id,
            start_col,
            end_col,
        )
        .into_iter()
        .map(|(i, cw)| (i, cw.0))
        .collect()
    }

    // GROUP 4: Named Range Queries

    /// Get all named ranges, converting Yrs storage to strongly-typed wire format.
    ///
    /// After typed formula boundary, Yrs stores `DefinedName.refers_to` in exactly one
    /// format: `serde_json::to_string(&IdentityFormula)`. Entries that fail
    /// to deserialize are skipped with a tracing warning — the prior
    /// "fall back to raw A1 text" arm silently returned wrong semantics
    /// (template-only `IdentityFormula` with no refs) whenever JSON parse
    /// failed, and has been deleted.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_named_ranges_wire(&self) -> Vec<crate::engine_types::queries::DefinedNameWire> {
        let raw = super::services::queries::get_all_named_ranges_wire(&self.stores);
        raw.into_iter()
            .filter_map(|dn| {
                let scope = match dn.scope {
                    Some(ref hex) => match hex_to_id(hex) {
                        Some(raw) => formula_types::Scope::Sheet(SheetId::from_raw(raw)),
                        None => formula_types::Scope::Workbook,
                    },
                    None => formula_types::Scope::Workbook,
                };

                let refers_to =
                    match serde_json::from_str::<formula_types::IdentityFormula>(&dn.refers_to) {
                        Ok(identity) => identity,
                        Err(e) => {
                            tracing::warn!(
                                name = %dn.name,
                                error = %e,
                                "Yrs DefinedName.refers_to is not a valid IdentityFormula JSON; \
                                 omitting from wire response. Typed formula boundary: made IdentityFormula \
                                 JSON the single canonical on-disk format."
                            );
                            return None;
                        }
                    };

                Some(crate::engine_types::queries::DefinedNameWire {
                    id: dn.id,
                    name: dn.name,
                    refers_to,
                    scope,
                    comment: dn.comment,
                    visible: dn.visible,
                })
            })
            .collect()
    }

    // GROUP 4b: Dependency Graph Queries

    /// Get cells that depend on the given cell (its dependents).
    ///
    /// Returns positions of all formula cells that reference this cell.
    #[bridge::read(scope = "cell")]
    pub fn get_dependents(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Vec<CellPositionResult> {
        let pos = SheetPos::new(row, col);
        let cell_id = match self.mirror.resolve_cell_id(sheet_id, pos) {
            Some(id) => id,
            None => return Vec::new(),
        };
        self.stores
            .compute
            .get_dependents(&cell_id)
            .into_iter()
            .filter_map(|dep_id| {
                let dep_sheet = self.mirror.sheet_for_cell(&dep_id)?;
                let dep_pos = self.mirror.resolve_position(&dep_id)?;
                let dep_name = super::services::queries::get_sheet_name(&self.stores, &dep_sheet)
                    .unwrap_or_default();
                Some(CellPositionResult {
                    sheet_id: dep_sheet.to_uuid_string(),
                    sheet_name: dep_name,
                    row: dep_pos.row(),
                    col: dep_pos.col(),
                })
            })
            .collect()
    }

    /// Get cells that the given cell references (its precedents).
    ///
    /// Returns positions of all cells this cell's formula depends on.
    #[bridge::read(scope = "cell")]
    pub fn get_precedents(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Vec<CellPositionResult> {
        let pos = SheetPos::new(row, col);
        let cell_id = match self.mirror.resolve_cell_id(sheet_id, pos) {
            Some(id) => id,
            None => return Vec::new(),
        };
        self.stores
            .compute
            .graph()
            .get_precedents(&cell_id)
            .iter()
            .filter_map(|dep_target| {
                let target_id = match dep_target {
                    compute_graph::DepTarget::Cell(id) => *id,
                    compute_graph::DepTarget::Range(_, _) => return None,
                };
                let dep_sheet = self.mirror.sheet_for_cell(&target_id)?;
                let dep_pos = self.mirror.resolve_position(&target_id)?;
                let dep_name = super::services::queries::get_sheet_name(&self.stores, &dep_sheet)
                    .unwrap_or_default();
                Some(CellPositionResult {
                    sheet_id: dep_sheet.to_uuid_string(),
                    sheet_name: dep_name,
                    row: dep_pos.row(),
                    col: dep_pos.col(),
                })
            })
            .collect()
    }

    // GROUP 5: Merge Queries

    /// Get the merge containing a specific cell, if any.
    #[bridge::read(scope = "cell")]
    pub fn get_merge_at_cell_query(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellMergeInfo> {
        super::services::queries::get_merge_at_cell_query(&self.stores, sheet_id, row, col)
    }

    /// Get all merges for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_merges_in_sheet(&self, sheet_id: &SheetId) -> Vec<ResolvedMergedRegion> {
        super::services::queries::get_all_merges_in_sheet(&self.stores, sheet_id)
    }

    // GROUP 6: Cell ID Queries

    /// Get the CellId at a given position as a hex string.
    #[bridge::read(scope = "cell")]
    pub fn get_cell_id_at(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<String> {
        super::services::queries::get_cell_id_at(&self.stores, sheet_id, row, col)
    }

    /// Resolve a CellId hex string to its (sheetId, row, col) position.
    /// Tries the compute mirror first (fast path for cells with data); falls
    /// back to GridIndex for comment-only or identity-only cells that exist
    /// in the grid but have no computed value and therefore are absent from
    /// the CellMirror.
    #[bridge::read(scope = "sheet")]
    pub fn get_cell_position(
        &self,
        sheet_id: &SheetId,
        cell_id_hex: &str,
    ) -> Option<CellPositionResult> {
        // Fast path: CellMirror (has value / formula).
        if let Some(mut result) =
            super::services::queries::get_cell_position(&self.mirror, sheet_id, cell_id_hex)
        {
            if let Ok(sid) = SheetId::from_uuid_str(&result.sheet_id) {
                result.sheet_name = super::services::queries::get_sheet_name(&self.stores, &sid)
                    .unwrap_or_default();
            }
            return Some(result);
        }
        // Fallback: GridIndex (comment-only / identity-only cells not in mirror).
        let raw_id = hex_to_id(cell_id_hex)?;
        let cell_id = CellId::from_raw(raw_id);
        let grid = self.stores.grid_indexes.get(sheet_id)?;
        let (row, col) = grid.cell_position(&cell_id)?;
        let sheet_name =
            super::services::queries::get_sheet_name(&self.stores, sheet_id).unwrap_or_default();
        Some(CellPositionResult {
            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            sheet_name,
            row,
            col,
        })
    }

    /// Batch-resolve multiple CellId hex strings to their (sheetId, row, col) positions.
    /// Returns results in the same order as the input; unresolvable IDs yield `None`.
    #[bridge::read(scope = "workbook")]
    pub fn resolve_cell_positions(
        &self,
        cell_id_hexes: Vec<String>,
    ) -> Vec<Option<CellPositionResult>> {
        super::services::queries::resolve_cell_positions(&self.mirror, &cell_id_hexes)
            .into_iter()
            .map(|opt| {
                opt.map(|mut r| {
                    if let Ok(sid) = SheetId::from_uuid_str(&r.sheet_id) {
                        r.sheet_name = super::services::queries::get_sheet_name(&self.stores, &sid)
                            .unwrap_or_default();
                    }
                    r
                })
            })
            .collect()
    }

    // GROUP 7: Projection Queries

    /// Check if a cell is a projection source (the origin cell of a dynamic array formula).
    #[bridge::read(scope = "cell")]
    pub fn is_projection_source(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        super::services::queries::is_projection_source(&self.mirror, sheet_id, row, col)
    }

    /// Check if a cell is a projected position (a non-origin cell in a dynamic array).
    #[bridge::read(scope = "cell")]
    pub fn is_projected_position(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        super::services::queries::is_projected_position(&self.mirror, sheet_id, row, col)
    }

    // -------------------------------------------------------------------
    // G10: Projection Range Queries
    // -------------------------------------------------------------------

    /// Get the full projection range for a source cell.
    ///
    /// Returns the projection bounds if the cell is a projection source, or None if not.
    #[bridge::read(scope = "cell")]
    pub fn get_projection_range(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<RectBounds> {
        super::services::queries::get_projection_range(&self.mirror, sheet_id, row, col)
    }

    /// Get the source cell for a projected position.
    ///
    /// Returns the position of the source cell, or None if
    /// this cell is not a projected position.
    #[bridge::read(scope = "cell")]
    pub fn get_projection_source(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<SheetPos> {
        super::services::queries::get_projection_source(&self.mirror, sheet_id, row, col)
    }

    /// Get all projection data overlapping a viewport range (batch query).
    ///
    /// Returns an array of projection entries for the given rectangular region.
    /// Each entry contains the projection origin and dimensions.
    /// This replaces per-cell isProjectedPosition/getProjectionSource/getProjectionRange
    /// queries during viewport initialization — one call instead of 10K+.
    #[bridge::read(scope = "range")]
    pub fn get_viewport_projection_data(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<ProjectionData> {
        super::services::queries::get_viewport_projection_data(
            &self.mirror,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )
    }

    // -------------------------------------------------------------------
    // G11: Workbook Granular Reads
    // -------------------------------------------------------------------

    /// Get the calculation mode (automatic or manual).
    #[bridge::read(scope = "workbook")]
    pub fn get_calc_mode(&self) -> String {
        super::services::queries::get_calc_mode(&self.stores)
    }

    /// Get the default font settings for the workbook.
    #[bridge::read(scope = "workbook")]
    pub fn get_default_font(&self) -> DefaultFont {
        super::services::queries::get_default_font()
    }

    // -------------------------------------------------------------------
    // G12: Workbook Granular Settings
    // -------------------------------------------------------------------

    /// Get a single workbook setting by key.
    #[bridge::read(scope = "workbook")]
    pub fn get_workbook_setting(&self, key: &str) -> Option<serde_json::Value> {
        super::services::queries::get_workbook_setting(&self.stores, key)
    }

    /// Set a single workbook setting by key.
    #[bridge::write(scope = "workbook")]
    pub fn set_workbook_setting(
        &mut self,
        key: &str,
        value: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let pre_calc = (key == "calculationSettings").then(|| {
            workbook::get_calculation_settings(
                self.stores.storage.doc(),
                self.stores.storage.workbook_map(),
            )
        });
        workbook::set_setting(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            key,
            value,
        );
        if let Some(pre_calc) = pre_calc {
            let post_calc = workbook::get_calculation_settings(
                self.stores.storage.doc(),
                self.stores.storage.workbook_map(),
            );
            self.sync_runtime_calculation_settings(&pre_calc, &post_calc);
        }
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Reset all workbook settings to their defaults.
    #[bridge::write(scope = "workbook")]
    pub fn reset_workbook_settings(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let pre = workbook::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        workbook::reset_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let post = workbook::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let pre_calc = pre.calculation_settings.clone().unwrap_or_default();
        let post_calc = post.calculation_settings.clone().unwrap_or_default();
        self.sync_runtime_calculation_settings(&pre_calc, &post_calc);

        let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");
        let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
        let changed_keys = diff_top_level_keys(&pre_json, &post_json);
        let mut result = MutationResult::empty();
        result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Removed,
                changed_keys,
                settings: post_json,
            });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Get calculation settings with defaults applied.
    #[bridge::read(scope = "workbook")]
    pub fn get_calculation_settings(&self) -> CalculationSettings {
        super::services::queries::get_calculation_settings(&self.stores)
    }

    /// Set calculation settings (merges with current values).
    #[bridge::write(scope = "workbook")]
    pub fn set_calculation_settings(
        &mut self,
        settings: CalculationSettings,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let pre_calc = workbook::get_calculation_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        workbook::set_calculation_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            &settings,
        );
        let post_calc = workbook::get_calculation_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        self.sync_runtime_calculation_settings(&pre_calc, &post_calc);

        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Check if iterative calculation is enabled.
    #[bridge::read(scope = "workbook")]
    pub fn is_iterative_calculation_enabled(&self) -> bool {
        super::services::queries::is_iterative_calculation_enabled(&self.stores)
    }

    /// Enable or disable iterative calculation.
    #[bridge::write(scope = "workbook")]
    pub fn set_iterative_calculation_enabled(
        &mut self,
        enabled: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let pre_calc = workbook::get_calculation_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        workbook::set_iterative_calculation_enabled(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            enabled,
        );
        let post_calc = workbook::get_calculation_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        self.sync_runtime_calculation_settings(&pre_calc, &post_calc);

        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    // -------------------------------------------------------------------
    // G13: Workbook Protection
    // -------------------------------------------------------------------

    /// Protect the workbook with optional password hash and options.
    #[bridge::write(scope = "workbook")]
    pub fn protect_workbook(
        &mut self,
        password_hash: Option<String>,
        options: Option<WorkbookProtectionOptions>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        workbook::protect_workbook(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            password_hash.as_deref(),
            options.as_ref(),
        );
        let post = workbook::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
        let changed_keys = match &post_json {
            serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
            _ => Vec::new(),
        };
        let mut result = MutationResult::empty();
        result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Set,
                changed_keys,
                settings: post_json,
            });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Unprotect the workbook. Returns true if successful.
    #[bridge::write(scope = "workbook")]
    pub fn unprotect_workbook(
        &mut self,
        password_hash: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let success = workbook::unprotect_workbook(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            password_hash.as_deref(),
        );
        let post = workbook::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
        let changed_keys = match &post_json {
            serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
            _ => Vec::new(),
        };
        let mut result = MutationResult::empty().with_data(&success)?;
        result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Set,
                changed_keys,
                settings: post_json,
            });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Get workbook protection options.
    #[bridge::read(scope = "workbook")]
    pub fn get_workbook_protection_options(&self) -> WorkbookProtectionOptions {
        super::services::queries::get_workbook_protection_options(&self.stores)
    }

    /// Check if the workbook has a protection password set.
    #[bridge::read(scope = "workbook")]
    pub fn has_workbook_protection_password(&self) -> bool {
        super::services::queries::has_workbook_protection_password(&self.stores)
    }

    /// Check if the workbook is protected.
    #[bridge::read(scope = "workbook")]
    pub fn is_workbook_protected(&self) -> bool {
        super::services::queries::is_workbook_protected(&self.stores)
    }

    /// Check if a workbook-level operation is allowed under current protection.
    #[bridge::read(scope = "workbook")]
    pub fn is_workbook_operation_allowed(
        &self,
        operation: ProtectedWorkbookOperation,
    ) -> Result<bool, ComputeError> {
        super::services::queries::is_workbook_operation_allowed(&self.stores, operation)
    }

    /// Set the default table style ID for new tables.
    #[bridge::write(scope = "workbook")]
    pub fn set_default_table_style_id(
        &mut self,
        style_id: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        workbook::set_default_table_style_id(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            style_id.as_deref(),
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Get the default table style ID for new tables.
    #[bridge::read(scope = "workbook")]
    pub fn get_default_table_style_id(&self) -> Option<String> {
        super::services::queries::get_default_table_style_id(&self.stores)
    }

    /// Set the default slicer style for new slicers.
    #[bridge::write(scope = "workbook")]
    pub fn set_default_slicer_style(
        &mut self,
        style_id: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        workbook::set_default_slicer_style(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            style_id.as_deref(),
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Get the default slicer style for new slicers.
    #[bridge::read(scope = "workbook")]
    pub fn get_default_slicer_style(&self) -> Option<String> {
        super::services::queries::get_default_slicer_style(&self.stores)
    }

    // -------------------------------------------------------------------
    // Named Slicer Style Registry
    // -------------------------------------------------------------------

    /// Get the count of named slicer styles in the workbook registry.
    #[bridge::read(scope = "workbook")]
    pub fn get_slicer_style_count(&self) -> u32 {
        super::services::queries::get_named_slicer_style_count(&self.stores)
    }

    /// Get a named slicer style by name.
    #[bridge::read(scope = "workbook")]
    pub fn get_slicer_style(&self, name: &str) -> Option<NamedSlicerStyle> {
        super::services::queries::get_named_slicer_style(&self.stores, name)
    }

    /// List all named slicer styles in the workbook registry.
    #[bridge::read(scope = "workbook")]
    pub fn list_slicer_styles(&self) -> Vec<NamedSlicerStyle> {
        super::services::queries::list_named_slicer_styles(&self.stores)
    }

    /// Add a named slicer style to the workbook registry.
    ///
    /// If `make_unique_name` is true and the name conflicts, a numeric suffix
    /// is appended. The final name is returned in `MutationResult.data`.
    #[bridge::write(scope = "workbook")]
    pub fn add_slicer_style(
        &mut self,
        name: &str,
        style: SlicerCustomStyle,
        make_unique_name: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let final_name = workbook::add_named_slicer_style(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            name,
            style,
            make_unique_name,
        )?;
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty().with_data(&final_name)?,
        ))
    }

    /// Delete a named slicer style from the workbook registry.
    #[bridge::write(scope = "workbook")]
    pub fn delete_slicer_style(
        &mut self,
        name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        workbook::delete_named_slicer_style(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            name,
        )?;
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Duplicate a named slicer style, creating a copy with a unique name.
    ///
    /// The new style's name is returned in `MutationResult.data`.
    #[bridge::write(scope = "workbook")]
    pub fn duplicate_slicer_style(
        &mut self,
        name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let new_name = workbook::duplicate_named_slicer_style(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            name,
        )?;
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty().with_data(&new_name)?,
        ))
    }

    /// Set the default pivot table style for new pivot tables.
    #[bridge::write(scope = "workbook")]
    pub fn set_default_pivot_table_style(
        &mut self,
        style_id: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        workbook::set_default_pivot_table_style(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            style_id.as_deref(),
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Get the default pivot table style for new pivot tables.
    #[bridge::read(scope = "workbook")]
    pub fn get_default_pivot_table_style(&self) -> Option<String> {
        super::services::queries::get_default_pivot_table_style(&self.stores)
    }

    // -------------------------------------------------------------------
    // Custom Settings (arbitrary KV store)
    // -------------------------------------------------------------------

    /// Get a custom setting value by key.
    #[bridge::read(scope = "workbook")]
    pub fn get_custom_setting(&self, key: &str) -> Option<String> {
        super::services::queries::get_custom_setting(&self.stores, key)
    }

    /// Set a custom setting value. Pass `None` to delete the key.
    #[bridge::write(scope = "workbook")]
    pub fn set_custom_setting(
        &mut self,
        key: &str,
        value: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        workbook::set_custom_setting(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            key,
            value.as_deref(),
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// List all custom settings as key-value pairs.
    #[bridge::read(scope = "workbook")]
    pub fn list_custom_settings(&self) -> Vec<(String, String)> {
        super::services::queries::list_custom_settings(&self.stores)
    }

    // -------------------------------------------------------------------
    // G14: Named Ranges (Read Queries)
    // -------------------------------------------------------------------

    /// Get a named range by its unique ID.
    #[bridge::read(scope = "workbook")]
    pub fn get_named_range_by_id(&self, id: &str) -> Option<DefinedName> {
        super::services::queries::get_named_range_by_id(&self.stores, id)
    }

    /// Get a named range by name and optional scope.
    #[bridge::read(scope = "workbook")]
    pub fn get_named_range_by_name(
        &self,
        name: &str,
        scope: Option<String>,
    ) -> Option<DefinedName> {
        super::services::queries::get_named_range_by_name(&self.stores, name, scope.as_deref())
    }

    /// Get all named ranges in a specific scope.
    #[bridge::read(scope = "workbook")]
    pub fn get_named_ranges_by_scope(&self, scope: Option<String>) -> Vec<DefinedName> {
        super::services::queries::get_named_ranges_by_scope(&self.stores, scope.as_deref())
    }

    /// Get all visible named ranges.
    #[bridge::read(scope = "workbook")]
    pub fn get_visible_named_ranges(&self) -> Vec<DefinedName> {
        super::services::queries::get_visible_named_ranges(&self.stores)
    }

    /// Check if a named range exists in the given scope.
    #[bridge::read(scope = "workbook")]
    pub fn named_range_exists(&self, name: &str, scope: Option<String>) -> bool {
        super::services::queries::named_range_exists(&self.stores, name, scope.as_deref())
    }

    /// Get the total number of defined names.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::read(scope = "workbook")]
    #[bridge::skip(napi)]
    pub fn named_range_count(&self) -> usize {
        super::services::queries::named_range_count(&self.stores)
    }

    /// Validate a proposed name for a defined name.
    #[bridge::read(scope = "workbook")]
    pub fn validate_named_range_name(
        &self,
        name: &str,
        scope: Option<String>,
        exclude_id: Option<String>,
    ) -> NameValidationResult {
        super::services::queries::validate_named_range_name(
            &self.stores,
            name,
            scope.as_deref(),
            exclude_id.as_deref(),
        )
    }

    /// Resolve a name reference, respecting scope precedence.
    #[bridge::read(scope = "workbook")]
    pub fn resolve_named_range(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<DefinedName> {
        super::services::queries::resolve_named_range(&self.stores, name, current_sheet.as_deref())
    }

    // -------------------------------------------------------------------
    // G15: Sheet Extended Queries
    // -------------------------------------------------------------------

    /// Get IDs of all visible (non-hidden) sheets, in order.
    #[bridge::read(scope = "workbook")]
    pub fn get_visible_sheet_ids(&self) -> Vec<String> {
        super::services::queries::get_visible_sheet_ids(&self.stores)
    }

    /// Get IDs of all hidden sheets, in order.
    #[bridge::read(scope = "workbook")]
    pub fn get_hidden_sheet_ids(&self) -> Vec<String> {
        super::services::queries::get_hidden_sheet_ids(&self.stores)
    }

    /// Count the number of visible (non-hidden) sheets.
    #[bridge::read(scope = "workbook")]
    pub fn count_visible_sheets(&self) -> u32 {
        super::services::queries::count_visible_sheets(&self.stores)
    }

    /// Get ordered list of sheet IDs from the workbook sheet order.
    #[bridge::read(scope = "workbook")]
    pub fn get_sheet_order(&self) -> Vec<String> {
        super::services::queries::get_sheet_order(&self.stores)
    }

    /// Get the first sheet ID, if any.
    #[bridge::read(scope = "workbook")]
    pub fn get_first_sheet_id(&self) -> Option<String> {
        super::services::queries::get_first_sheet_id(&self.stores)
    }

    /// Get print settings for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_print_settings(
        &self,
        sheet_id: &SheetId,
    ) -> domain_types::domain::print::PrintSettings {
        super::services::queries::get_print_settings(&self.stores, sheet_id)
    }

    /// Get header/footer images for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_hf_images(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
        super::services::queries::get_hf_images(&self.stores, sheet_id)
    }

    /// Get sheet metadata (name, dimensions, tab color, frozen, hidden).
    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_meta(&self, sheet_id: &SheetId) -> Option<SheetMeta> {
        super::services::queries::get_sheet_meta(&self.stores, sheet_id)
    }

    /// Check if a sheet has a protection password set.
    #[bridge::read(scope = "sheet")]
    pub fn has_sheet_protection_password(&self, sheet_id: &SheetId) -> bool {
        super::services::queries::has_sheet_protection_password(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // G16: Cell Values (Read Queries)
    // -------------------------------------------------------------------

    /// Get full cell data at a position.
    ///
    /// Checks Yrs storage first (real cells with CellId), then falls back to
    /// the CellMirror's col_data for materialized values (pivot output, spill arrays).
    ///
    /// **D4 (projection-family unification):** the response carries a
    /// `region` field on every successful read — the unified region-
    /// membership shape (CSE / dynamic-array spill / Data Table; future
    /// pivot / table column / etc.) composed from
    /// `mirror.cell_render_at(...)`. `region` is `null` for plain cells.
    /// The TS API `cells.getData(...)` consumes this field to populate
    /// `StoreCellData.region`; the formula bar's brace policy is a
    /// per-`region.kind` switch (D5).
    // TODO(typed-returns): Return concrete struct once CellValue implements Serialize.
    // CellData contains CellValue which uses custom JSON serialization (cell_data_to_json).
    #[bridge::read(scope = "cell")]
    pub fn get_cell_data(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<serde_json::Value> {
        // 1. Try Yrs storage (real cells with CellId)
        if let Some(mut data) =
            super::services::queries::get_cell_data(&self.stores, sheet_id, row, col)
        {
            // Override formula from ComputeCore's formula_strings if available.
            // After structural changes, ComputeCore regenerates A1 formula
            // strings from IdentityFormulas, but Yrs KEY_FORMULA may be stale.
            if let Some(cell_id_hex) = data.get("cell_id").and_then(|v| v.as_str())
                && let Some(id_u128) = compute_document::hex::hex_to_id(cell_id_hex)
            {
                let cell_id = cell_types::CellId::from_raw(id_u128);
                if let Some(formula) = self.stores.compute.get_formula(&cell_id) {
                    // formula_strings may store with or without '=' prefix;
                    // strip it since CellData.formula convention is without '='.
                    let body = formula.strip_prefix('=').unwrap_or(formula);
                    data["formula"] = serde_json::Value::String(body.to_string());
                }
            }
            if data.get("formula").and_then(|v| v.as_str()).is_none()
                && let Some(formula) =
                    super::data_table_formula::formula_at(&self.mirror, sheet_id, row, col)
            {
                data["formula"] = serde_json::Value::String(
                    formula.strip_prefix('=').unwrap_or(&formula).to_string(),
                );
            }
            // D4: surface region-membership through the same chokepoint
            // (`cell_render_at`) used by `get_active_cell`. Plain cells
            // outside any region get `region: null`.
            data["region"] = region_json(&self.mirror, sheet_id, row, col);
            return Some(data);
        }
        // 2. Fallback: check mirror col_data for materialized values.
        // Materialized cells (pivot output, spill members without a Yrs
        // CellId) still flow through `cell_render_at` for region info —
        // a dynamic-array spill member at a non-anchor position has no
        // Yrs CellId of its own but DOES have `region.kind == arraySpill`.
        let region = region_json(&self.mirror, sheet_id, row, col);
        let data_table_formula =
            super::data_table_formula::formula_at(&self.mirror, sheet_id, row, col)
                .map(|f| f.strip_prefix('=').unwrap_or(&f).to_string());
        let value = cell_values::get_effective_value(&self.mirror, sheet_id, row, col);
        match (value, &region) {
            (Some(v), _) if !v.is_null() => Some(serde_json::json!({
                "cell_id": serde_json::Value::Null,
                "row": row,
                "col": col,
                "value": cell_value_to_json(&v),
                "formula": data_table_formula,
                "region": region,
            })),
            // Region-only response: a position inside a region rectangle
            // that has no per-cell value (rare — Data Table body cells
            // always have cached values). Return the region so callers can
            // still discover membership.
            (_, serde_json::Value::Object(_)) => Some(serde_json::json!({
                "cell_id": serde_json::Value::Null,
                "row": row,
                "col": col,
                "formula": data_table_formula,
                "region": region,
            })),
            _ => None,
        }
    }

    /// Get full cell data by CellId hex string.
    // TODO(typed-returns): Return concrete struct once CellValue implements Serialize.
    #[bridge::read(scope = "sheet")]
    pub fn get_cell_data_by_id_hex(
        &self,
        sheet_id: &SheetId,
        cell_id_hex: &str,
    ) -> Option<serde_json::Value> {
        super::services::queries::get_cell_data_by_id_hex(&self.stores, sheet_id, cell_id_hex)
    }

    /// Get the display value for a cell as a string.
    ///
    /// Uses the canonical `format_cell_display` path: effective format resolution
    /// (cell → row → col → table → theme) + `compute_formats::format_value`.
    #[bridge::read(scope = "cell")]
    pub fn get_display_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        self.format_cell_display(sheet_id, row, col)
    }

    /// Get the raw value for formula bar display.
    #[bridge::read(scope = "cell")]
    pub fn get_raw_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        // Prefer ComputeCore's formula_strings (authoritative after structural
        // changes) over Yrs KEY_FORMULA which may be stale.
        if let Some(cell_id) = self
            .mirror
            .resolve_cell_id(sheet_id, cell_types::SheetPos::new(row, col))
            && let Some(formula) = self.stores.compute.get_formula(&cell_id)
        {
            return if formula.starts_with('=') {
                formula.to_string()
            } else {
                format!("={}", formula)
            };
        }
        if let Some(formula) =
            super::data_table_formula::formula_at(&self.mirror, sheet_id, row, col)
        {
            return formula;
        }
        super::services::queries::get_raw_value(&self.mirror, &self.stores, sheet_id, row, col)
    }

    /// Get the effective value of a cell (computed for formulas, raw otherwise).
    /// Returns a JSON object with { type, value } fields.
    // TODO(typed-returns): Return concrete struct once CellValue implements Serialize.
    #[bridge::read(scope = "cell")]
    pub fn get_effective_value(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<serde_json::Value> {
        super::services::queries::get_effective_value(&self.mirror, sheet_id, row, col)
    }

    /// Get the count of non-empty cells in a sheet.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::read(scope = "sheet")]
    #[bridge::skip(napi)]
    pub fn get_cell_count(&self, sheet_id: &SheetId) -> usize {
        super::services::queries::get_cell_count(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // G17: Cell Iteration (Read Queries)
    // -------------------------------------------------------------------

    /// Get the current region around a cell (Ctrl+Shift+* functionality).
    #[bridge::read(scope = "sheet")]
    pub fn get_current_region(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
    ) -> RectBounds {
        super::services::queries::get_current_region(&self.stores, sheet_id, start_row, start_col)
    }

    /// Find the data edge from a cell in a direction (Ctrl+Arrow navigation).
    #[bridge::read(scope = "cell")]
    pub fn find_data_edge(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        direction: &str,
    ) -> CellPosition {
        super::services::queries::find_data_edge(&self.stores, sheet_id, row, col, direction)
    }

    /// Find the last populated row in a column. Returns data and formatting edges.
    #[bridge::read(scope = "sheet")]
    pub fn find_last_row(&self, sheet_id: &SheetId, col: u32) -> ColumnEdge {
        super::services::queries::find_last_row(&self.stores, &self.mirror, sheet_id, col)
    }

    /// Find the last populated column in a row. Returns data and formatting edges.
    #[bridge::read(scope = "sheet")]
    pub fn find_last_column(&self, sheet_id: &SheetId, row: u32) -> RowEdge {
        super::services::queries::find_last_column(&self.stores, &self.mirror, sheet_id, row)
    }

    // -------------------------------------------------------------------
    // G18: Cell Iteration — Yrs-level queries
    // -------------------------------------------------------------------

    /// Get the CellId at a position from the Yrs document (not the in-memory GridIndex).
    ///
    /// This reads directly from the Yrs CRDT document, which is the authoritative
    /// source of truth. Use this when you need the persisted state rather than
    /// the in-memory cache (which is what `get_cell_id_at` above uses via GridIndex).
    #[bridge::read(scope = "cell")]
    pub fn get_cell_id_at_yrs(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<String> {
        super::services::queries::get_cell_id_at_yrs(&self.stores, sheet_id, row, col)
    }

    /// Get all CellIds in a range from the Yrs document.
    ///
    /// Returns hex-encoded CellId strings for all cells that exist at
    /// positions within the specified range. Reads directly from the Yrs
    /// CRDT document.
    #[bridge::read(scope = "range")]
    pub fn get_cells_in_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<String> {
        super::services::queries::get_cells_in_range(
            &self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )
    }

    /// Iterate all cells in a sheet and return their data as JSON.
    ///
    /// Returns an array of cell data objects, each containing cell_id (hex),
    /// row, col, value, and formula. Reads directly from the Yrs CRDT document,
    /// which is useful for diagnostics or when the mirror may be stale.
    // TODO(typed-returns): Return Vec<CellEntry> once CellValue implements Serialize.
    // Uses cell_value_to_json for custom CellValue serialization.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_cells_yrs(&self, sheet_id: &SheetId) -> serde_json::Value {
        super::services::queries::get_all_cells_yrs(&self.stores, sheet_id)
    }

    /// Iterate cells in a range and return their data as JSON.
    ///
    /// Returns an array of objects for each position in the range. Positions
    /// with data include cell_id, value, and formula fields. Positions without
    /// data have `has_data: false`. Reads directly from Yrs.
    // TODO(typed-returns): Return Vec<CellEntry> once CellValue implements Serialize.
    // Uses cell_value_to_json for custom CellValue serialization.
    #[bridge::read(scope = "range")]
    pub fn get_cells_in_range_yrs(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> serde_json::Value {
        super::services::queries::get_cells_in_range_yrs(
            &self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )
    }

    /// Constrain a full-column or full-row selection to actual data bounds.
    ///
    /// When a user selects an entire column (by clicking the header) and
    /// performs an operation like sort, this detects the actual data range
    /// and returns the constrained bounds. For normal (non-full) selections,
    /// returns the range unchanged.
    ///
    /// Returns None if no data is found in the selected columns/rows.
    #[bridge::read(scope = "range")]
    #[allow(clippy::too_many_arguments)]
    pub fn get_data_bounds_for_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        is_full_column: bool,
        is_full_row: bool,
    ) -> Option<RectBounds> {
        super::services::queries::get_data_bounds_for_range(
            &self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            is_full_column,
            is_full_row,
        )
    }

    // -------------------------------------------------------------------
    // G21: Range Parsing & Stringification (range_manager wiring)
    // -------------------------------------------------------------------

    /// Parse an A1-style range reference string into structured components.
    ///
    /// Returns the structured range reference, or None if the string is invalid.
    #[bridge::read(scope = "workbook")]
    pub fn parse_range_ref(&self, range_str: &str) -> Option<A1RangeRef> {
        super::services::queries::parse_range_ref(range_str)
    }

    /// Convert a structured range reference back to an A1-style string.
    #[bridge::read(scope = "workbook")]
    pub fn stringify_range_ref(&self, range: A1RangeRef) -> Option<String> {
        super::services::queries::stringify_range_ref(&range)
    }

    /// Parse a single A1-style cell reference string.
    ///
    /// Returns the structured cell reference, or None if the string is invalid.
    #[bridge::read(scope = "workbook")]
    pub fn parse_cell_ref(&self, cell_str: &str) -> Option<A1CellRef> {
        super::services::queries::parse_cell_ref(cell_str)
    }

    /// Convert a structured cell reference back to an A1-style string.
    #[bridge::read(scope = "workbook")]
    pub fn stringify_cell_ref(&self, cell: A1CellRef) -> Option<String> {
        super::services::queries::stringify_cell_ref(&cell)
    }

    // -------------------------------------------------------------------
    // G22: Spatial Range Queries (range_manager wiring)
    // -------------------------------------------------------------------

    /// Query merges that intersect a viewport using the spatial index.
    ///
    /// Uses `RangeSpatialIndex` for efficient merge lookups instead of
    /// scanning all merges linearly. Falls back to linear scan if the
    /// spatial index is not populated for the given sheet.
    #[bridge::read(scope = "range")]
    pub fn get_merges_in_viewport_spatial(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<MergeRegion> {
        super::services::queries::get_merges_in_viewport_spatial(
            &self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )
    }

    /// Query which merge contains a given cell using the spatial index.
    ///
    /// Returns the merge bounds and whether the queried cell is the merge origin.
    #[bridge::read(scope = "cell")]
    pub fn get_merge_at_cell_spatial(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellMergeInfo> {
        super::services::queries::get_merge_at_cell_spatial(&self.stores, sheet_id, row, col)
    }

    // -------------------------------------------------------------------
    // G23: Named Range Display Values (mirror-based resolution)
    // -------------------------------------------------------------------

    /// Build a scope chain for variable resolution: [Sheet(current), Workbook].
    fn build_scope_chain(&self, current_sheet: Option<&str>) -> Vec<formula_types::Scope> {
        let mut chain = Vec::with_capacity(2);
        if let Some(hex) = current_sheet
            && let Some(raw) = hex_to_id(hex)
        {
            chain.push(formula_types::Scope::Sheet(SheetId::from_raw(raw)));
        }
        chain.push(formula_types::Scope::Workbook);
        chain
    }

    /// Get the display-formatted value of a named range.
    ///
    /// Resolves the named range from the mirror's VariableStore, evaluates its
    /// `refers_to` identity formula, and returns the result formatted for display.
    #[bridge::read(scope = "workbook")]
    pub fn get_named_range_display_value(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<String> {
        let scope_chain = self.build_scope_chain(current_sheet.as_deref());
        let def = self.mirror.resolve_variable(name, &scope_chain)?;
        let formula = &def.refers_to;

        // Single-cell reference: resolve CellId → position → formatted value
        if formula.refs.len() == 1
            && let formula_types::IdentityFormulaRef::Cell(cell_ref) = &formula.refs[0]
        {
            let lookup = MirrorPositionLookup::new(&self.mirror, SheetId::from_raw(0));
            if let Some((sheet_id, row, col)) = lookup.cell_position(&cell_ref.id) {
                return Some(self.format_cell_display(&sheet_id, row, col));
            }
        }

        // Range or complex formula: fall back to A1 display
        if !formula.refs.is_empty() {
            let a1 = self.stores.compute.to_a1_display_qualified(
                &self.mirror,
                &SheetId::from_raw(0),
                formula,
            );
            let a1 = a1.strip_prefix('=').unwrap_or(&a1);
            if !a1.is_empty() {
                return Some(a1.to_string());
            }
        }

        // Constants, #REF!, etc. — use raw_expression
        def.raw_expression.clone().or_else(|| {
            if formula.template.is_empty() {
                None
            } else {
                Some(formula.template.clone())
            }
        })
    }

    /// Get the raw typed value of a named range.
    ///
    /// For single-cell references, returns the cell's `CellValue` directly.
    /// For range or multi-ref formulas, delegates to `get_named_range_array_values()`
    /// and returns the first cell.
    /// For constants or unresolvable formulas, falls back to `raw_expression` then template.
    #[bridge::read(scope = "workbook")]
    pub fn get_named_range_typed_value(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<CellValue> {
        let scope_chain = self.build_scope_chain(current_sheet.as_deref());
        let def = self.mirror.resolve_variable(name, &scope_chain)?;
        let formula = &def.refers_to;

        // Single-cell reference: resolve CellId → position → raw CellValue
        if formula.refs.len() == 1
            && let formula_types::IdentityFormulaRef::Cell(cell_ref) = &formula.refs[0]
        {
            let lookup = MirrorPositionLookup::new(&self.mirror, SheetId::from_raw(0));
            if let Some((sheet_id, row, col)) = lookup.cell_position(&cell_ref.id) {
                return cell_values::get_effective_value(&self.mirror, &sheet_id, row, col);
            }
        }

        // Range or multi-ref: delegate to array values and return first cell
        if !formula.refs.is_empty() {
            let arr = self.get_named_range_array_values(name, current_sheet)?;
            return arr.into_iter().next()?.into_iter().next();
        }

        // Constants, #REF!, etc. — use raw_expression first, then template
        def.raw_expression
            .as_deref()
            .map(CellValue::from)
            .or_else(|| {
                if formula.template.is_empty() {
                    None
                } else {
                    Some(CellValue::from(formula.template.as_str()))
                }
            })
    }

    // -------------------------------------------------------------------
    // G24: Named Range Value Type & Array Values
    // -------------------------------------------------------------------

    /// Get the OfficeJS-compatible type of a named range's resolved value.
    ///
    /// Returns one of: `"String"`, `"Integer"`, `"Double"`, `"Boolean"`,
    /// `"Range"`, `"Error"`, `"Array"`.
    /// For single-cell references, returns the type of the cell's value.
    /// For multi-cell range references, returns `"Range"`.
    #[bridge::read(scope = "workbook")]
    pub fn get_named_range_type(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<String> {
        let scope_chain = self.build_scope_chain(current_sheet.as_deref());
        let def = self.mirror.resolve_variable(name, &scope_chain)?;
        let formula = &def.refers_to;

        if formula.refs.is_empty() {
            // Constant or unparseable — treat as string
            return Some("String".to_string());
        }

        // Check if it's a single cell or multi-cell range
        if formula.refs.len() == 1 {
            match &formula.refs[0] {
                formula_types::IdentityFormulaRef::Cell(cell_ref) => {
                    // Single cell → look up value type
                    let lookup = MirrorPositionLookup::new(&self.mirror, SheetId::from_raw(0));
                    if let Some((sid, row, col)) = lookup.cell_position(&cell_ref.id) {
                        let value = cell_values::get_effective_value(&self.mirror, &sid, row, col);
                        return Some(cell_value_to_type_string(value.as_ref()).to_string());
                    }
                }
                _ => {
                    // Range ref → "Range"
                    return Some("Range".to_string());
                }
            }
        }

        // Multiple refs → likely a range or complex formula
        Some("Range".to_string())
    }

    /// Get the 2D array of resolved values for a named range that refers to a range.
    ///
    /// For single-cell references, returns a 1x1 array.
    /// For multi-cell ranges, returns the full grid of values.
    /// Returns `None` if the name doesn't exist, doesn't refer to a parseable range,
    /// or exceeds the 10 million cell OOM guard.
    #[bridge::read(scope = "workbook")]
    pub fn get_named_range_array_values(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<Vec<Vec<CellValue>>> {
        let scope_chain = self.build_scope_chain(current_sheet.as_deref());
        let def = self.mirror.resolve_variable(name, &scope_chain)?;
        let formula = &def.refers_to;

        // We need to resolve the formula to a concrete range with positions.
        // Use A1 display to get the range, then parse it back.
        let a1 = if !formula.refs.is_empty() {
            let display = self.stores.compute.to_a1_display_qualified(
                &self.mirror,
                &SheetId::from_raw(0),
                formula,
            );
            let display = display.strip_prefix('=').unwrap_or(&display);
            display.to_string()
        } else {
            return None; // No refs → can't be a range
        };

        let range = range_manager::parse_range(&a1)?;
        let sid = self.resolve_sheet_from_range(&range)?;

        // OOM guard: reject ranges exceeding 10M cells (e.g. full-column refs like A:A)
        let total_cells = (range.end.row as u64 - range.start.row as u64 + 1)
            * (range.end.col as u64 - range.start.col as u64 + 1);
        if total_cells > 10_000_000 {
            return None;
        }

        let mut rows = Vec::with_capacity((range.end.row - range.start.row + 1) as usize);
        for row in range.start.row..=range.end.row {
            let mut row_values = Vec::with_capacity((range.end.col - range.start.col + 1) as usize);
            for col in range.start.col..=range.end.col {
                let value = cell_values::get_effective_value(&self.mirror, &sid, row, col)
                    .unwrap_or_default();
                row_values.push(value);
            }
            rows.push(row_values);
        }

        Some(rows)
    }

    /// Format a CellValue for display using the canonical format resolution path.
    ///
    /// Delegates to `format_cell_display` which resolves the effective number format
    /// and applies `compute_formats::format_value` for correct date/currency/percentage display.
    #[bridge::read(scope = "cell")]
    pub fn format_cell_value_for_display(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        self.format_cell_display(sheet_id, row, col)
    }

    // -------------------------------------------------------------------
    // Range Query
    // -------------------------------------------------------------------

    /// Query a range of cells (for clipboard, dialog init, export, API reads, etc.).
    ///
    /// Reads from `grid_indexes` + ComputeCore (authoritative), NOT from the CRDT mirror.
    /// This fixes:
    /// 1. Ghost cells: cells created via `setCellsByPosition` now appear correctly
    /// 2. Formula text: actual formula string instead of `has_formula` bool
    #[bridge::read(scope = "range")]
    pub fn query_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> RangeQueryResult {
        let mut cells = Vec::new();
        let grid_index = self.stores.grid_indexes.get(sheet_id);

        super::services::queries::for_each_cell_in_range(
            self,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            true, // include format-only cells
            &mut |visit| {
                // Expensive fields only query_range needs:
                let cell_id_str = if let Some(cid) = visit.cell_id {
                    cid.to_uuid_string()
                } else if visit.is_projection {
                    // Resolve source cell from projection registry
                    self.mirror
                        .projection_registry
                        .resolve(sheet_id, visit.row, visit.col)
                        .map(|(src, _, _)| src.to_uuid_string())
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                let format = serde_json::to_value(&visit.effective_format).ok();

                let hyperlink_url = if visit.cell_id.is_some() {
                    grid_index.and_then(|grid| {
                        hyperlinks::get_hyperlink(
                            self.stores.storage.doc(),
                            self.stores.storage.sheets(),
                            sheet_id,
                            grid,
                            visit.row,
                            visit.col,
                        )
                    })
                } else {
                    None
                };

                cells.push(RangeCellData {
                    row: visit.row,
                    col: visit.col,
                    cell_id: cell_id_str,
                    value: visit.value,
                    formula: visit.formula,
                    formatted: if visit.formatted.is_empty() {
                        None
                    } else {
                        Some(visit.formatted)
                    },
                    format,
                    hyperlink_url,
                });
            },
        );

        // Merges from CRDT doc
        let merges_result: Vec<ViewportMerge> = match grid_index {
            Some(grid) => merges::get_merges_in_viewport(
                self.stores.storage.doc(),
                self.stores.storage.sheets(),
                *sheet_id,
                grid,
                start_row,
                start_col,
                end_row,
                end_col,
            )
            .into_iter()
            .map(|r| ViewportMerge {
                start_row: r.start_row,
                start_col: r.start_col,
                end_row: r.end_row,
                end_col: r.end_col,
            })
            .collect(),
            None => Vec::new(),
        };

        RangeQueryResult {
            cells,
            merges: merges_result,
        }
    }

    /// Get cells with identity, pre-normalizing errors to display strings.
    /// This is the Rust-native equivalent of the TS `getRangeWithIdentity()`.
    #[bridge::read(scope = "range")]
    pub fn get_range_with_identity(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<IdentityCell> {
        let mut cells = Vec::new();

        super::services::queries::for_each_cell_in_range(
            self,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            false, // skip format-only cells (same as getValueTypes2d)
            &mut |visit| {
                let cell_id_str = if let Some(cid) = visit.cell_id {
                    cid.to_uuid_string()
                } else if visit.is_projection {
                    self.mirror
                        .projection_registry
                        .resolve(sheet_id, visit.row, visit.col)
                        .map(|(src, _, _)| src.to_uuid_string())
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                // Normalize errors to display strings
                let value = match &visit.value {
                    value_types::CellValue::Error(err, _) => {
                        value_types::CellValue::Text(err.as_str().into())
                    }
                    other => other.clone(),
                };

                // Always produce a display string
                let display_string = if !visit.formatted.is_empty() {
                    visit.formatted.clone()
                } else {
                    match &visit.value {
                        value_types::CellValue::Null => String::new(),
                        value_types::CellValue::Text(s) => s.to_string(),
                        value_types::CellValue::Number(n) => n.to_string(),
                        value_types::CellValue::Boolean(b) => {
                            if *b { "TRUE" } else { "FALSE" }.to_string()
                        }
                        value_types::CellValue::Error(err, _) => err.as_str().to_string(),
                        value_types::CellValue::Array(_) => String::new(),
                        value_types::CellValue::Control(c) => {
                            if c.value { "TRUE" } else { "FALSE" }.to_string()
                        }
                    }
                };

                cells.push(IdentityCell {
                    cell_id: cell_id_str,
                    row: visit.row,
                    col: visit.col,
                    value,
                    formula_text: visit.formula,
                    display_string,
                });
            },
        );

        cells
    }

    /// Batch query: read multiple ranges across multiple sheets in one IPC call.
    /// Each request specifies a sheet name + optional bounds. Results are returned
    /// in the same order as requests.
    #[bridge::read(scope = "workbook")]
    pub fn query_ranges(&self, requests: Vec<BatchRangeRequest>) -> BatchRangeResponse {
        let entries = requests
            .into_iter()
            .map(|req| {
                // 1. Resolve sheet name -> SheetId
                let sheet_id = match self.mirror.sheet_by_name(&req.sheet_name) {
                    Some(id) => id,
                    None => {
                        return BatchRangeEntry::Err {
                            message: format!("Sheet not found: {}", req.sheet_name),
                        };
                    }
                };

                // 2. Resolve bounds — use provided bounds or auto-detect from data bounds
                let (start_row, start_col, end_row, end_col) =
                    match (req.start_row, req.start_col, req.end_row, req.end_col) {
                        (Some(sr), Some(sc), Some(er), Some(ec)) => (sr, sc, er, ec),
                        _ => {
                            // Auto-detect used range
                            match super::services::queries::get_data_bounds(
                                &self.stores,
                                &self.mirror,
                                &sheet_id,
                            ) {
                                Some(bounds) => (
                                    bounds.min_row,
                                    bounds.min_col,
                                    bounds.max_row,
                                    bounds.max_col,
                                ),
                                None => {
                                    // Empty sheet — return valid empty result
                                    return BatchRangeEntry::Ok(BatchRangeResult {
                                        sheet_id: id_to_hex(sheet_id.as_u128()).into(),
                                        sheet_name: req.sheet_name,
                                        start_row: 0,
                                        start_col: 0,
                                        end_row: 0,
                                        end_col: 0,
                                        result: RangeQueryResult {
                                            cells: Vec::new(),
                                            merges: Vec::new(),
                                        },
                                    });
                                }
                            }
                        }
                    };

                // 3. Reuse existing query_range logic
                let result = self.query_range(&sheet_id, start_row, start_col, end_row, end_col);

                let sheet_name_resolved =
                    super::services::queries::get_sheet_name(&self.stores, &sheet_id)
                        .unwrap_or(req.sheet_name);

                BatchRangeEntry::Ok(BatchRangeResult {
                    sheet_id: id_to_hex(sheet_id.as_u128()).into(),
                    sheet_name: sheet_name_resolved,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    result,
                })
            })
            .collect();

        BatchRangeResponse { entries }
    }

    #[bridge::read(scope = "sheet")]
    pub fn regex_search(
        &self,
        sheet_id: &SheetId,
        options: RegexSearchOptions,
    ) -> RegexSearchResult {
        super::services::queries::regex_search(self, sheet_id, options)
    }

    // -------------------------------------------------------------------
    // Find in Range
    // -------------------------------------------------------------------

    /// Find the first cell matching literal text within a range.
    #[bridge::read(scope = "range")]
    pub fn find_in_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: crate::engine_types::queries::FindInRangeOptions,
    ) -> Option<crate::engine_types::queries::FindInRangeResult> {
        super::services::queries::find_in_range(
            &self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            options,
        )
    }

    /// Find all cells matching literal text within a range.
    #[bridge::read(scope = "range")]
    pub fn find_all_in_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: crate::engine_types::queries::FindInRangeOptions,
    ) -> Vec<crate::engine_types::queries::FindInRangeResult> {
        super::services::queries::find_all_in_range(
            &self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            options,
        )
    }

    /// Search all sheets for cells matching regex patterns (one IPC call).
    #[bridge::read(scope = "workbook")]
    pub fn regex_search_all_sheets(&self, options: RegexSearchOptions) -> WorkbookSearchResult {
        super::services::queries::regex_search_all_sheets(self, options)
    }

    #[bridge::read(scope = "range")]
    pub fn sign_check(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: SignCheckOptions,
    ) -> SignCheckResult {
        super::services::queries::sign_check(
            self, sheet_id, start_row, start_col, end_row, end_col, options,
        )
    }

    // -------------------------------------------------------------------
    // Programmatic Formula Evaluation
    // -------------------------------------------------------------------

    /// Validate authored formula text using the parser only.
    ///
    /// This intentionally does not resolve cell references, sheet names, or
    /// function availability. Interactive editing must reject malformed syntax
    /// such as unbalanced parentheses before the mutation path normalizes it,
    /// but semantic/runtime errors still belong to formula evaluation so they
    /// surface as spreadsheet values like `#NAME?`, `#REF!`, or `#DIV/0!`.
    #[bridge::read(scope = "sheet")]
    pub fn validate_formula_syntax(
        &self,
        _sheet_id: &SheetId,
        formula: &str,
    ) -> Option<(String, Option<u32>)> {
        compute_parser::parse_formula(formula, None)
            .err()
            .map(|err| (err.message(), u32::try_from(err.position()).ok()))
    }

    /// Evaluate a formula expression without writing it to any cell.
    ///
    /// Parses the expression, evaluates it in the context of cell (0,0) on the
    /// given sheet, and returns the resulting CellValue. The expression may
    /// optionally start with '='; if omitted it is prepended automatically.
    ///
    /// This enables programmatic function invocation (OfficeJS: `workbook.functions`).
    #[bridge::read(scope = "sheet")]
    pub fn evaluate_expression(
        &self,
        sheet_id: &SheetId,
        expression: &str,
    ) -> Result<CellValue, ComputeError> {
        // 1. Normalize: ensure the expression starts with '=' for the parser.
        let formula_str = if expression.trim_start().starts_with('=') {
            expression.to_string()
        } else {
            format!("={}", expression)
        };

        // 2. Parse without a resolver — unqualified refs get SheetId(0) which
        //    the evaluator resolves via EvalMetadata at runtime. Cross-sheet
        //    refs (e.g. Sheet2!A1) become UnresolvedSheetRef nodes that the
        //    evaluator resolves dynamically via sheet_by_name().
        let ast = compute_parser::parse_formula(&formula_str, None)
            .map_err(|e| ComputeError::Eval {
                message: format!("Failed to parse expression: {}", e),
            })?
            .into_inner();

        // 3. Build an evaluation context anchored at (0,0) on the target sheet.
        //    Use a synthetic CellId so the evaluator has a "current cell" position.
        let cell_id = self
            .mirror
            .resolve_cell_id(sheet_id, SheetPos::new(0, 0))
            .unwrap_or(CellId::from_raw(0));
        let ctx = MirrorContext::new(&self.mirror, cell_id, *sheet_id);

        // 4. Evaluate and return.
        let value = sync_block_on(Evaluator::evaluate(&ast, &ctx, &ctx)).map_err(|e| {
            ComputeError::Eval {
                message: format!("Expression evaluation failed: {}", e),
            }
        })?;

        // Excel coercion: standalone formula returning Null → Number(0).
        if matches!(value, CellValue::Null) {
            return Ok(CellValue::number(0.0));
        }

        // If the result is an array (dynamic array formula), return the top-left scalar.
        if let CellValue::Array(ref arr) = value {
            return Ok(arr.get(0, 0).cloned().unwrap_or(CellValue::number(0.0)));
        }

        Ok(value)
    }
}

// ---------------------------------------------------------------------------
// Named range helpers (non-bridge)
// ---------------------------------------------------------------------------

/// Map a `CellValue` to an OfficeJS `NamedItemType` string.
fn cell_value_to_type_string(value: Option<&CellValue>) -> &'static str {
    match value {
        None | Some(CellValue::Null) => "String",
        Some(CellValue::Number(n)) => {
            if n.get().fract() == 0.0 && n.get().abs() < (i32::MAX as f64) {
                "Integer"
            } else {
                "Double"
            }
        }
        Some(CellValue::Text(_)) => "String",
        Some(CellValue::Boolean(_)) => "Boolean",
        Some(CellValue::Error(..)) => "Error",
        Some(CellValue::Array(_)) => "Array",
        Some(CellValue::Control(_)) => "Boolean",
    }
}

impl YrsComputeEngine {
    /// Resolve the target sheet ID from a parsed `A1RangeRef`.
    ///
    /// If the range includes a sheet name, looks it up in the sheet order.
    /// Otherwise falls back to the first sheet.
    fn resolve_sheet_from_range(&self, range: &A1RangeRef) -> Option<SheetId> {
        let sheet_ids = self.stores.storage.sheet_order();
        if let Some(ref sheet_name) = range.sheet_name {
            sheet_ids
                .iter()
                .find(|sid| {
                    sheets::get_sheet_name(
                        self.stores.storage.doc(),
                        self.stores.storage.sheets(),
                        sid,
                    )
                    .as_deref()
                        == Some(sheet_name.as_str())
                })
                .copied()
        } else {
            sheet_ids.first().copied()
        }
    }
}

// ---------------------------------------------------------------------------
// Canonical display formatting (non-bridge internal methods)
// ---------------------------------------------------------------------------

impl YrsComputeEngine {
    /// Inner workhorse: format a known CellValue using the effective format at (sheet_id, row, col).
    /// Includes `resolve_theme_refs` — fixing a bug where `enrich_display_text` was missing it.
    pub(crate) fn format_value_at_cell(
        &self,
        value: &CellValue,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> String {
        // 1. Resolve cell_id for format lookup (empty string if no cell at this position)
        let cell_id_hex = self
            .mirror
            .resolve_cell_id(sheet_id, SheetPos::new(row, col))
            .map(|cid| id_to_hex(cid.as_u128()))
            .unwrap_or_default();

        // 2. Full format resolution pipeline: table → effective → theme.
        // Formula display uses the formula cell's OWN format. Excel applies
        // operand-format inheritance at edit time (stored on the cell), not at
        // display time, so the runtime path here intentionally does not walk
        // referenced cells.
        let table_fmt = self.resolve_table_format_at_cell(sheet_id, row, col);
        let mut effective = properties::get_effective_format(
            &self.stores.storage,
            sheet_id,
            &cell_id_hex,
            row,
            col,
            table_fmt.as_ref(),
            self.stores.grid_indexes.get(sheet_id),
            self.mirror.get_sheet(sheet_id),
        );

        domain_types::theme_color::resolve_theme_refs(&mut effective, &self.settings.theme_palette);

        // 3. Format using compute_formats
        let format_code = effective.number_format.as_deref().unwrap_or("General");
        let format_result =
            compute_formats::format_value(value, format_code, &self.settings.locale);
        format_result.text
    }

    /// Public API: look up value + format it. The canonical "what does this cell look like?"
    pub fn format_cell_display(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        let value = match cell_values::get_effective_value(&self.mirror, sheet_id, row, col) {
            Some(v) => v,
            None => return String::new(),
        };
        self.format_value_at_cell(&value, sheet_id, row, col)
    }
}

// ---------------------------------------------------------------------------
// Merge Spatial Index types (wiring range_manager into merge lookups)
// ---------------------------------------------------------------------------

/// A merge region item for the spatial index.
///
/// Wraps resolved merge bounds so the `RangeSpatialIndex` can efficiently
/// query which merges contain a cell or intersect a viewport.
#[derive(Debug, Clone)]
pub(crate) struct MergeSpatialItem {
    pub id: String,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    /// Single range ref stored inline for the SpatialItem trait.
    pub range_ref: MergeRangeRef,
}

/// Range reference type for merge spatial items (bounds are stored directly).
#[derive(Debug, Clone)]
pub(crate) struct MergeRangeRef {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

impl range_manager::SpatialItem for MergeSpatialItem {
    type RangeRef = MergeRangeRef;

    fn id(&self) -> &str {
        &self.id
    }

    fn range_refs(&self) -> &[MergeRangeRef] {
        std::slice::from_ref(&self.range_ref)
    }
}

/// Direct resolver for merge bounds (no identity resolution needed).
pub(crate) struct MergeDirectResolver;

impl range_manager::RangeBoundsResolver for MergeDirectResolver {
    type RangeRef = MergeRangeRef;

    fn resolve(&self, range_ref: &MergeRangeRef) -> Option<range_manager::ResolvedBounds> {
        Some(range_manager::ResolvedBounds {
            min_row: range_ref.start_row,
            max_row: range_ref.end_row,
            min_col: range_ref.start_col,
            max_col: range_ref.end_col,
        })
    }
}

// ---------------------------------------------------------------------------
// Helper functions for JSON serialization
// ---------------------------------------------------------------------------

/// Convert a CellValue to a JSON representation.
pub(super) fn cell_value_to_json(value: &CellValue) -> serde_json::Value {
    match value {
        CellValue::Null => serde_json::json!({ "type": "null" }),
        CellValue::Number(n) => serde_json::json!({ "type": "number", "value": n.get() }),
        CellValue::Text(s) => serde_json::json!({ "type": "text", "value": s.to_string() }),
        CellValue::Boolean(b) => serde_json::json!({ "type": "boolean", "value": *b }),
        CellValue::Error(e, _) => serde_json::json!({ "type": "error", "value": e.as_str() }),
        CellValue::Array(_) => serde_json::json!({ "type": "array" }),
        CellValue::Control(c) => serde_json::json!({ "type": "boolean", "value": c.value }),
    }
}

/// Convert a CellData to a JSON representation.
pub(super) fn cell_data_to_json(data: &cell_values::CellData) -> serde_json::Value {
    let mut json = serde_json::json!({
        "cell_id": id_to_hex(data.cell_id.as_u128()),
        "row": data.row,
        "col": data.col,
    });

    if let Some(ref raw) = data.raw {
        json["raw"] = cell_value_to_json(raw);
    }
    if let Some(ref computed) = data.computed {
        json["computed"] = cell_value_to_json(computed);
    }
    if let Some(ref formula) = data.formula {
        json["formula"] = serde_json::Value::String(formula.clone());
    }
    if let Some(ref hyperlink) = data.hyperlink {
        json["hyperlink"] = serde_json::Value::String(hyperlink.clone());
    }
    if let Some(ref note) = data.note {
        json["note"] = serde_json::Value::String(note.clone());
    }

    json
}

/// Build the `region` JSON value for a cell at `(sheet, row, col)` by
/// composing `mirror.cell_render_at(...)`. Returns `null` when the cell is
/// not part of any region (CSE, dynamic-array spill, Data Table; future
/// pivot / table column / etc.).
///
/// **D4 chokepoint.** This is the read path used by the kernel API
/// `cells.getData(...)` to surface region membership to the formula bar
/// and devtools probes. Mirrors the projection arm of
/// `viewport::functions::get_active_cell` so the wire shape is identical
/// regardless of which read entry consumers use.
pub(super) fn region_json(
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> serde_json::Value {
    let region_meta: Option<crate::storage::properties::RegionMeta> =
        match mirror.cell_render_at(sheet_id, row, col) {
            crate::projection::CellRender::Projection(view) => {
                let kind = if view.is_cse {
                    crate::storage::properties::RegionKind::CseArray
                } else {
                    crate::storage::properties::RegionKind::ArraySpill
                };
                let bounds = mirror
                    .projection_registry
                    .get(&view.anchor_id)
                    .map(|p| crate::storage::properties::RegionBounds {
                        rows: p.rows,
                        cols: p.cols,
                    })
                    .unwrap_or(crate::storage::properties::RegionBounds { rows: 1, cols: 1 });
                let is_anchor = row == view.anchor_row && col == view.anchor_col;
                Some(crate::storage::properties::RegionMeta {
                    kind,
                    is_anchor,
                    anchor_row: view.anchor_row,
                    anchor_col: view.anchor_col,
                    bounds,
                })
            }
            crate::projection::CellRender::Plain(plain) => plain.region.map(|r| {
                let kind = match r.kind {
                    crate::projection::RegionKind::DataTable => {
                        crate::storage::properties::RegionKind::DataTable
                    }
                };
                crate::storage::properties::RegionMeta {
                    kind,
                    is_anchor: r.is_anchor,
                    anchor_row: r.anchor_row,
                    anchor_col: r.anchor_col,
                    bounds: crate::storage::properties::RegionBounds {
                        rows: r.rows,
                        cols: r.cols,
                    },
                }
            }),
            crate::projection::CellRender::Empty => None,
        };

    match region_meta {
        Some(rm) => serde_json::to_value(rm).unwrap_or(serde_json::Value::Null),
        None => serde_json::Value::Null,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// `set_workbook_settings` / `reset_workbook_settings` are the two
// previously-empty workbook-level returners that now populate direct state.
// One regression test per function asserting the
// `WorkbookSettingsChange` family rides the channel with the contract:
// `kind`, `changed_keys`, full `settings` snapshot (camelCase keys).
#[cfg(test)]
mod mirror_coverage_tests {
    use super::*;
    use crate::storage::engine::mutation::CellInput;
    use snapshot_types::{RecalcOptions, SheetSnapshot, WorkbookSnapshot};
    use value_types::CellValue;

    const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

    fn build_engine() -> YrsComputeEngine {
        let snap = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: SHEET_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            }],
            ..Default::default()
        };
        let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
        engine
    }

    fn sheet_id() -> SheetId {
        SheetId::from_uuid_str(SHEET_UUID).expect("test sheet id")
    }

    fn parse_input(text: &str) -> CellInput {
        CellInput::Parse {
            text: text.to_string(),
        }
    }

    fn number_at(engine: &YrsComputeEngine, row: u32, col: u32) -> f64 {
        match engine
            .mirror()
            .get_cell_value_at(&sheet_id(), SheetPos::new(row, col))
        {
            Some(CellValue::Number(n)) => n.get(),
            other => panic!("expected numeric value at ({row}, {col}), got {other:?}"),
        }
    }

    fn assert_close(actual: f64, expected: f64, tolerance: f64, label: &str) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "{label}: expected {expected} +/- {tolerance}, got {actual}"
        );
    }

    #[test]
    fn validate_formula_syntax_accepts_valid_and_runtime_error_formulas() {
        let engine = build_engine();
        let sheet_id = sheet_id();

        assert_eq!(
            engine.validate_formula_syntax(&sheet_id, "=SUM(A1:A3)"),
            None
        );
        assert_eq!(
            engine.validate_formula_syntax(&sheet_id, "=UNKNOWN_FN(1)"),
            None,
            "unknown functions are semantic/runtime errors, not syntax errors"
        );
        assert_eq!(
            engine.validate_formula_syntax(&sheet_id, "=1/0"),
            None,
            "runtime errors must still commit and evaluate to spreadsheet errors"
        );
    }

    #[test]
    fn validate_formula_syntax_rejects_raw_unclosed_paren_before_normalization() {
        let engine = build_engine();
        let sheet_id = sheet_id();

        let result = engine
            .validate_formula_syntax(&sheet_id, "=SUM(1,2")
            .expect("unclosed formula should be rejected");

        assert!(
            result.0.contains("close") || result.0.contains("unexpected end"),
            "expected parser syntax error, got {result:?}"
        );
        assert!(result.1.is_some(), "parser should provide an error offset");
    }

    #[test]
    fn set_workbook_settings_returns_workbook_settings_change() {
        let mut engine = build_engine();
        let pre = engine.get_workbook_settings();
        // Mutate two top-level keys so `changed_keys` covers more than one.
        let mut next = pre.clone();
        next.show_horizontal_scrollbar = !pre.show_horizontal_scrollbar;
        next.theme_id = "dark".to_string();

        let (_patches, result) = engine
            .set_workbook_settings(next)
            .expect("set_workbook_settings");
        assert_eq!(result.workbook_settings_changes.len(), 1);
        let change = &result.workbook_settings_changes[0];
        assert_eq!(change.kind, ChangeKind::Set);
        assert!(
            change
                .changed_keys
                .iter()
                .any(|k| k == "showHorizontalScrollbar"),
            "changed_keys must include showHorizontalScrollbar; got {:?}",
            change.changed_keys
        );
        assert!(
            change.changed_keys.iter().any(|k| k == "themeId"),
            "changed_keys must include themeId; got {:?}",
            change.changed_keys
        );
        // Full post-mutation settings snapshot must be present.
        assert!(change.settings.is_object());
        assert_eq!(
            change.settings.get("themeId").and_then(|v| v.as_str()),
            Some("dark")
        );
    }

    #[test]
    fn reset_workbook_settings_returns_workbook_settings_change() {
        let mut engine = build_engine();
        // Start from a non-default state so reset has work to do.
        let mut next = engine.get_workbook_settings();
        next.theme_id = "dark".to_string();
        next.show_formula_bar = false;
        engine
            .set_workbook_settings(next)
            .expect("seed non-defaults");

        let (_patches, result) = engine
            .reset_workbook_settings()
            .expect("reset_workbook_settings");
        assert_eq!(result.workbook_settings_changes.len(), 1);
        let change = &result.workbook_settings_changes[0];
        assert_eq!(
            change.kind,
            ChangeKind::Removed,
            "reset must signal Removed kind"
        );
        assert!(
            !change.changed_keys.is_empty(),
            "reset must enumerate the keys that diverged from defaults"
        );
        // `settings` must be a serialized object (the post-reset
        // defaults snapshot, not Null).
        assert!(change.settings.is_object());
        assert_eq!(
            change.settings.get("themeId").and_then(|v| v.as_str()),
            Some("office"),
            "post-reset themeId must be the default 'office'"
        );
    }

    #[test]
    fn set_workbook_settings_syncs_iterative_runtime_before_formula_recalc() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let mut settings = engine.get_workbook_settings();
        settings.calculation_settings = Some(CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 100,
            ..CalculationSettings::default()
        });

        engine
            .set_workbook_settings(settings)
            .expect("set workbook settings");

        let (_patches, result) = engine
            .batch_set_cells_by_position(
                vec![
                    (sid, 0, 0, parse_input("=B1+1")),
                    (sid, 0, 1, parse_input("=A1*0.5")),
                ],
                true,
            )
            .expect("batch set circular formulas");

        assert!(
            result.recalc.metrics.iterative_iterations > 1,
            "formula mutation should use iterative runtime settings; metrics = {:?}",
            result.recalc.metrics
        );
        assert_close(number_at(&engine, 0, 0), 2.0, 0.01, "A1");
        assert_close(number_at(&engine, 0, 1), 1.0, 0.01, "B1");
    }

    #[test]
    fn set_calculation_settings_marks_dirty_for_existing_circular_recalc() {
        let mut engine = build_engine();
        let sid = sheet_id();

        engine
            .batch_set_cells_by_position(
                vec![
                    (sid, 0, 0, parse_input("=B1+1")),
                    (sid, 0, 1, parse_input("=A1*0.5")),
                ],
                true,
            )
            .expect("batch set circular formulas");

        // Clear the mutation dirty bit while iterative calculation is still off.
        engine
            .recalculate_with_options(&RecalcOptions::default())
            .expect("non-iterative recalc should run");
        assert!(
            (number_at(&engine, 0, 0) - 2.0).abs() > 0.01,
            "test setup should leave A1 non-converged before iterative calc is enabled"
        );

        engine
            .set_calculation_settings(CalculationSettings {
                enable_iterative_calculation: true,
                max_iterations: 100,
                ..CalculationSettings::default()
            })
            .expect("set calculation settings");

        let result = engine
            .recalculate_with_options(&RecalcOptions::default())
            .expect("bare recalculate after settings change");
        assert!(
            result.metrics.iterative_iterations > 1,
            "settings-only change must dirty compute and use iterative runtime settings; metrics = {:?}",
            result.metrics
        );
        assert_close(number_at(&engine, 0, 0), 2.0, 0.01, "A1");
        assert_close(number_at(&engine, 0, 1), 1.0, 0.01, "B1");
    }

    #[test]
    fn from_yrs_state_hydrates_runtime_calculation_settings() {
        let mut engine_a = build_engine();
        let mut settings = engine_a.get_workbook_settings();
        settings.calculation_settings = Some(CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 100,
            ..CalculationSettings::default()
        });
        engine_a
            .set_workbook_settings(settings)
            .expect("set workbook settings");

        let state = compute_collab::encode_full_state(engine_a.storage().doc());
        let (mut engine_b, _) = YrsComputeEngine::from_yrs_state(&state).expect("from_yrs_state");
        let sid = sheet_id();
        let (_patches, result) = engine_b
            .batch_set_cells_by_position(
                vec![
                    (sid, 0, 0, parse_input("=B1+1")),
                    (sid, 0, 1, parse_input("=A1*0.5")),
                ],
                true,
            )
            .expect("batch set circular formulas");

        assert!(
            result.recalc.metrics.iterative_iterations > 1,
            "from_yrs_state must hydrate iterative runtime settings; metrics = {:?}",
            result.recalc.metrics
        );
        assert_close(number_at(&engine_b, 0, 0), 2.0, 0.01, "A1");
        assert_close(number_at(&engine_b, 0, 1), 1.0, 0.01, "B1");
    }

    #[test]
    fn apply_sync_update_syncs_remote_runtime_calculation_settings_before_cell_recalc() {
        let mut engine_a = build_engine();
        let full_state = compute_collab::encode_full_state(engine_a.storage().doc());
        let (mut engine_b, _) =
            YrsComputeEngine::from_yrs_state(&full_state).expect("from_yrs_state");
        let engine_b_state_vector = engine_b.encode_state_vector();

        let mut settings = engine_a.get_workbook_settings();
        settings.calculation_settings = Some(CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 100,
            ..CalculationSettings::default()
        });
        engine_a
            .set_workbook_settings(settings)
            .expect("set workbook settings");
        let sid = sheet_id();
        engine_a
            .batch_set_cells_by_position(
                vec![
                    (sid, 0, 0, parse_input("=B1+1")),
                    (sid, 0, 1, parse_input("=A1*0.5")),
                ],
                true,
            )
            .expect("batch set circular formulas");

        let delta = engine_a
            .encode_diff(&engine_b_state_vector)
            .expect("encode A to B diff");
        let (_patches, result) = engine_b
            .apply_sync_update(&delta)
            .expect("apply A to B diff");

        assert!(
            result.recalc.metrics.iterative_iterations > 1,
            "remote settings must sync before remote formulas recalc; metrics = {:?}",
            result.recalc.metrics
        );
        assert_close(number_at(&engine_b, 0, 0), 2.0, 0.01, "A1");
        assert_close(number_at(&engine_b, 0, 1), 1.0, 0.01, "B1");
    }
}
