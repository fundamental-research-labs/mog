#![allow(unused_imports, unused_variables)]
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
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::query_serialization::{cell_value_to_json, region_json};
use crate::storage::engine::{data_table_formula, services};
use crate::storage::sheet::{hyperlinks, merges, properties as sheets};
use crate::storage::workbook::settings as workbook;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::undo::{ORIGIN_UI_STATE, ORIGIN_USER_EDIT};
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use domain_types::{DefinedName, NameValidationResult};
use formula_types::{IdentityFormula, WorkbookLookup};
use value_types::CellValue;
use value_types::ComputeError;

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
        Some(CellValue::Image(_)) => "String",
    }
}

pub(in crate::storage::engine) fn get_document_properties(
    engine: &YrsComputeEngine,
) -> domain_types::DocumentProperties {
    services::queries::get_document_properties(&engine.stores)
}

pub(in crate::storage::engine) fn set_document_properties(
    engine: &YrsComputeEngine,
    props: domain_types::DocumentProperties,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    services::queries::set_document_properties(&engine.stores, &props);
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn get_all_sheet_ids(engine: &YrsComputeEngine) -> Vec<String> {
    services::queries::get_all_sheet_ids(&engine.stores)
}

pub(in crate::storage::engine) fn get_sheet_name(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Option<String> {
    services::queries::get_sheet_name(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_hidden(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> bool {
    services::queries::is_sheet_hidden(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_calculation_enabled(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> bool {
    engine.mirror.is_calculation_enabled(sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_protected(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> bool {
    services::queries::is_sheet_protected(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn is_row_hidden_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> bool {
    services::queries::is_row_hidden_query(&engine.stores, sheet_id, row)
}

pub(in crate::storage::engine) fn is_col_hidden_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    services::queries::is_col_hidden_query(&engine.stores, sheet_id, col)
}

pub(in crate::storage::engine) fn get_hidden_rows(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<u32> {
    services::queries::get_hidden_rows(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_filter_hidden_rows(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<u32> {
    services::queries::get_filter_hidden_rows(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_hidden_columns(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<u32> {
    services::queries::get_hidden_columns(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_data_bounds(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Option<DataBounds> {
    services::queries::get_data_bounds(&engine.stores, &engine.mirror, sheet_id)
}

pub(in crate::storage::engine) fn get_sheet_index(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Option<usize> {
    services::queries::get_sheet_index(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_frozen_panes_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> FrozenPanes {
    services::queries::get_frozen_panes_query(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_view_options_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> SheetViewOptions {
    services::queries::get_view_options_query(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_scroll_position_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> SheetScrollPosition {
    services::queries::get_scroll_position_query(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_tab_color_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Option<String> {
    services::queries::get_tab_color_query(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_sheet_protection_config(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> SheetProtectionConfig {
    services::queries::get_sheet_protection_config(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_row_height_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> f64 {
    services::queries::get_row_height_query(&engine.stores, sheet_id, row).0
}

pub(in crate::storage::engine) fn get_col_width_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> f64 {
    services::queries::get_col_width_query(&engine.stores, sheet_id, col).0
}

pub(in crate::storage::engine) fn get_default_row_height(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> f64 {
    let pt = services::queries::get_default_row_height(&engine.stores, sheet_id);
    domain_types::units::points_to_pixels(pt).0
}

pub(in crate::storage::engine) fn get_default_col_width(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> f64 {
    let cw = services::queries::get_default_col_width(&engine.stores, sheet_id);
    domain_types::units::char_width_to_pixels(cw, domain_types::units::platform_mdw()).0
}

pub(in crate::storage::engine) fn get_row_heights_batch(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Vec<(u32, f64)> {
    services::queries::get_row_heights_batch(&engine.stores, sheet_id, start_row, end_row)
        .into_iter()
        .map(|(i, px)| (i, px.0))
        .collect()
}

pub(in crate::storage::engine) fn get_col_widths_batch(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<(u32, f64)> {
    services::queries::get_col_widths_batch(&engine.stores, sheet_id, start_col, end_col)
        .into_iter()
        .map(|(i, px)| (i, px.0))
        .collect()
}

pub(in crate::storage::engine) fn get_col_width_chars_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> f64 {
    services::queries::get_col_width_chars_query(&engine.stores, sheet_id, col).0
}

pub(in crate::storage::engine) fn get_default_col_width_chars(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> f64 {
    services::queries::get_default_col_width(&engine.stores, sheet_id).0
}

pub(in crate::storage::engine) fn get_col_widths_batch_chars(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<(u32, f64)> {
    services::queries::get_col_widths_batch_chars(&engine.stores, sheet_id, start_col, end_col)
        .into_iter()
        .map(|(i, cw)| (i, cw.0))
        .collect()
}

pub(in crate::storage::engine) fn get_all_named_ranges_wire(
    engine: &YrsComputeEngine,
) -> Vec<crate::engine_types::queries::DefinedNameWire> {
    let raw = services::queries::get_all_named_ranges_wire(&engine.stores);
    let mut result = Vec::with_capacity(raw.len());
    let mut invalid_refers_to_count = 0usize;
    let mut invalid_refers_to_samples = Vec::new();

    for dn in raw {
        let refers_to = match defined_name_wire_identity_formula(&dn) {
            Ok(identity) => identity,
            Err(reason) => {
                invalid_refers_to_count += 1;
                if invalid_refers_to_samples.len() < 5 {
                    invalid_refers_to_samples.push(format!("{}: {reason}", dn.name));
                }
                continue;
            }
        };

        let scope = match dn.scope {
            Some(ref hex) => match hex_to_id(hex) {
                Some(raw) => formula_types::Scope::Sheet(SheetId::from_raw(raw)),
                None => formula_types::Scope::Workbook,
            },
            None => formula_types::Scope::Workbook,
        };

        result.push(crate::engine_types::queries::DefinedNameWire {
            id: dn.id,
            name: dn.name,
            refers_to,
            scope,
            comment: dn.comment,
            visible: dn.visible,
        });
    }

    if invalid_refers_to_count > 0 {
        tracing::warn!(
            invalid_refers_to_count,
            samples = ?invalid_refers_to_samples,
            "Yrs DefinedName.refers_to contains entries that are not valid IdentityFormula JSON; \
             omitted invalid entries from wire response. Typed formula boundary: IdentityFormula \
             JSON is the single canonical on-disk format."
        );
    }

    result
}

fn defined_name_wire_identity_formula(dn: &DefinedName) -> Result<IdentityFormula, String> {
    let trimmed_refers_to = dn.refers_to.trim_start();
    if !trimmed_refers_to.starts_with('{') {
        return preserved_opaque_defined_name_identity_formula(dn)
            .ok_or_else(|| "expected JSON object".to_string());
    }

    match serde_json::from_str::<IdentityFormula>(&dn.refers_to) {
        Ok(identity) => Ok(identity),
        Err(e) => preserved_opaque_defined_name_identity_formula(dn).ok_or_else(|| e.to_string()),
    }
}

fn preserved_opaque_defined_name_identity_formula(dn: &DefinedName) -> Option<IdentityFormula> {
    let raw = dn.raw_refers_to.as_deref()?;
    if dn.visible
        && matches!(
            compute_parser::ParsedExpr::classify(raw),
            compute_parser::ParsedExpr::BrokenRef { .. } | compute_parser::ParsedExpr::Empty
        )
    {
        return None;
    }

    Some(IdentityFormula {
        template: raw.strip_prefix('=').unwrap_or(raw).to_string(),
        refs: Vec::new(),
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    })
}

pub(in crate::storage::engine) fn get_dependents(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<CellPositionResult> {
    let pos = SheetPos::new(row, col);
    let cell_id = match engine.mirror.resolve_cell_id(sheet_id, pos) {
        Some(id) => id,
        None => return Vec::new(),
    };
    engine
        .stores
        .compute
        .get_dependents(&cell_id)
        .into_iter()
        .filter_map(|dep_id| {
            let dep_sheet = engine.mirror.sheet_for_cell(&dep_id)?;
            let dep_pos = engine.mirror.resolve_position(&dep_id)?;
            let dep_name =
                services::queries::get_sheet_name(&engine.stores, &dep_sheet).unwrap_or_default();
            Some(CellPositionResult {
                sheet_id: dep_sheet.to_uuid_string(),
                sheet_name: dep_name,
                row: dep_pos.row(),
                col: dep_pos.col(),
            })
        })
        .collect()
}

pub(in crate::storage::engine) fn get_precedents(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<CellPositionResult> {
    let pos = SheetPos::new(row, col);
    let cell_id = match engine.mirror.resolve_cell_id(sheet_id, pos) {
        Some(id) => id,
        None => return Vec::new(),
    };
    engine
        .stores
        .compute
        .graph()
        .get_precedents(&cell_id)
        .iter()
        .filter_map(|dep_target| {
            let target_id = match dep_target {
                compute_graph::DepTarget::Cell(id) => *id,
                compute_graph::DepTarget::Range(_, _) => return None,
            };
            let dep_sheet = engine.mirror.sheet_for_cell(&target_id)?;
            let dep_pos = engine.mirror.resolve_position(&target_id)?;
            let dep_name =
                services::queries::get_sheet_name(&engine.stores, &dep_sheet).unwrap_or_default();
            Some(CellPositionResult {
                sheet_id: dep_sheet.to_uuid_string(),
                sheet_name: dep_name,
                row: dep_pos.row(),
                col: dep_pos.col(),
            })
        })
        .collect()
}

pub(in crate::storage::engine) fn get_merge_at_cell_query(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    services::queries::get_merge_at_cell_query(&engine.stores, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_all_merges_in_sheet(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<ResolvedMergedRegion> {
    services::queries::get_all_merges_in_sheet(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_cell_id_at(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    services::queries::get_cell_id_at(&engine.stores, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_cell_position(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<CellPositionResult> {
    if let Some(mut result) =
        services::queries::get_cell_position(&engine.mirror, sheet_id, cell_id_hex)
    {
        if let Ok(sid) = SheetId::from_uuid_str(&result.sheet_id) {
            result.sheet_name =
                services::queries::get_sheet_name(&engine.stores, &sid).unwrap_or_default();
        }
        return Some(result);
    }
    let raw_id = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(raw_id);
    let grid = engine.stores.grid_indexes.get(sheet_id)?;
    let (row, col) = grid.cell_position(&cell_id)?;
    let sheet_name =
        services::queries::get_sheet_name(&engine.stores, sheet_id).unwrap_or_default();
    Some(CellPositionResult {
        sheet_id: id_to_hex(sheet_id.as_u128()).into(),
        sheet_name,
        row,
        col,
    })
}

pub(in crate::storage::engine) fn resolve_cell_positions(
    engine: &YrsComputeEngine,
    cell_id_hexes: Vec<String>,
) -> Vec<Option<CellPositionResult>> {
    services::queries::resolve_cell_positions(&engine.mirror, &cell_id_hexes)
        .into_iter()
        .map(|opt| {
            opt.map(|mut r| {
                if let Ok(sid) = SheetId::from_uuid_str(&r.sheet_id) {
                    r.sheet_name =
                        services::queries::get_sheet_name(&engine.stores, &sid).unwrap_or_default();
                }
                r
            })
        })
        .collect()
}

pub(in crate::storage::engine) fn is_projection_source(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    services::queries::is_projection_source(&engine.mirror, sheet_id, row, col)
}

pub(in crate::storage::engine) fn is_projected_position(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    services::queries::is_projected_position(&engine.mirror, sheet_id, row, col)
}
