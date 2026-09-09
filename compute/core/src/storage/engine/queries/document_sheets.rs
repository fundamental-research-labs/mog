#![allow(unused_imports, unused_variables)]
use crate::cells::StorePositionLookup;
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
use crate::eval_bridge::EvalContext;
use crate::range_manager::{self, A1CellRef, A1RangeRef};
use crate::snapshot::{
    BatchRangeEntry, BatchRangeRequest, BatchRangeResponse, BatchRangeResult, CalculationSettings,
    ChangeKind, IdentityCell, MutationResult, ProtectedWorkbookOperation, RangeCellData,
    RangeQueryResult, RustWorkbookSettingsPatch, ViewportMerge, WorkbookProtectionOptions,
    WorkbookSettings, WorkbookSettingsChange,
};
use crate::storage::cells::values as cell_values;
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::query_serialization::{cell_value_to_json, region_json};
use crate::storage::engine::{data_table_formula, services};
use crate::storage::sheet::{hyperlinks, merges, properties as sheets};
use crate::storage::workbook::settings as workbook;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use domain_types::{DefinedName, NameValidationResult};
use formula_types::{IdentityFormula, WorkbookLookup};
use value_types::CellValue;
use value_types::ComputeError;

pub(in crate::storage::engine) fn get_document_properties(
    engine: &ComputeEngine,
) -> domain_types::DocumentProperties {
    services::queries::get_document_properties(&engine.stores)
}

pub(in crate::storage::engine) fn set_document_properties(
    engine: &mut ComputeEngine,
    props: domain_types::DocumentProperties,
) -> Result<MutationResult, ComputeError> {
    services::queries::set_document_properties(&mut engine.stores, &props);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_all_sheet_ids(engine: &ComputeEngine) -> Vec<String> {
    services::queries::get_all_sheet_ids(&engine.stores)
}

pub(in crate::storage::engine) fn get_sheet_name(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Option<String> {
    services::queries::get_sheet_name(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_hidden(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> bool {
    services::queries::is_sheet_hidden(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_calculation_enabled(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> bool {
    engine.cell_store.is_calculation_enabled(sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_protected(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> bool {
    services::queries::is_sheet_protected(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn is_row_hidden_query(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> bool {
    services::queries::is_row_hidden_query(&engine.stores, sheet_id, row)
}

pub(in crate::storage::engine) fn is_col_hidden_query(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    services::queries::is_col_hidden_query(&engine.stores, sheet_id, col)
}

pub(in crate::storage::engine) fn get_hidden_rows(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<u32> {
    services::queries::get_hidden_rows(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_filter_hidden_rows(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<u32> {
    services::queries::get_filter_hidden_rows(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_hidden_columns(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<u32> {
    services::queries::get_hidden_columns(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_data_bounds(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Option<DataBounds> {
    services::queries::get_data_bounds(&engine.stores, &engine.cell_store, sheet_id)
}

pub(in crate::storage::engine) fn get_sheet_index(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Option<usize> {
    services::queries::get_sheet_index(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_frozen_panes_query(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> FrozenPanes {
    services::queries::get_frozen_panes_query(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_view_options_query(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> SheetViewOptions {
    services::queries::get_view_options_query(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_scroll_position_query(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> SheetScrollPosition {
    services::queries::get_scroll_position_query(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_tab_color_query(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Option<String> {
    services::queries::get_tab_color_query(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_sheet_protection_config(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> SheetProtectionConfig {
    services::queries::get_sheet_protection_config(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_row_height_query(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> f64 {
    services::queries::get_row_height_query(&engine.stores, sheet_id, row).0
}

pub(in crate::storage::engine) fn get_col_width_query(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> f64 {
    services::queries::get_col_width_query(&engine.stores, sheet_id, col).0
}

pub(in crate::storage::engine) fn get_default_row_height(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> f64 {
    let pt = services::queries::get_default_row_height(&engine.stores, sheet_id);
    domain_types::units::points_to_pixels(pt).0
}

pub(in crate::storage::engine) fn get_default_col_width(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> f64 {
    let cw = services::queries::get_default_col_width(&engine.stores, sheet_id);
    domain_types::units::char_width_to_pixels(cw, engine.stores.layout_metrics.column_width_mdw).0
}

pub(in crate::storage::engine) fn get_row_heights_batch(
    engine: &ComputeEngine,
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
    engine: &ComputeEngine,
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
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> f64 {
    services::queries::get_col_width_chars_query(&engine.stores, sheet_id, col).0
}

pub(in crate::storage::engine) fn get_default_col_width_chars(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> f64 {
    services::queries::get_default_col_width(&engine.stores, sheet_id).0
}

pub(in crate::storage::engine) fn get_col_widths_batch_chars(
    engine: &ComputeEngine,
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
    engine: &ComputeEngine,
) -> Vec<crate::engine_types::queries::DefinedNameWire> {
    services::queries::get_all_named_ranges_wire(&engine.stores)
        .into_iter()
        .filter_map(|dn| {
            // Broken visible names remain preserved for export but are not usable API names.
            if dn.visible
                && dn.raw_refers_to.as_deref().is_some_and(|raw| {
                    matches!(
                        compute_parser::ParsedExpr::classify(raw),
                        compute_parser::ParsedExpr::BrokenRef { .. }
                            | compute_parser::ParsedExpr::Empty
                    )
                })
            {
                return None;
            }
            let scope = dn
                .scope
                .as_deref()
                .and_then(|scope| SheetId::from_uuid_str(scope).ok())
                .map_or(formula_types::Scope::Workbook, formula_types::Scope::Sheet);
            Some(crate::engine_types::queries::DefinedNameWire {
                id: dn.id,
                name: dn.name,
                refers_to: dn.refers_to,
                scope,
                comment: dn.comment,
                visible: dn.visible,
            })
        })
        .collect()
}

pub(in crate::storage::engine) fn get_dependents(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<CellPositionResult> {
    let pos = SheetPos::new(row, col);
    let cell_id = match engine.cell_store.resolve_cell_id(sheet_id, pos) {
        Some(id) => id,
        None => return Vec::new(),
    };
    engine
        .stores
        .compute
        .get_dependents(&cell_id)
        .into_iter()
        .filter_map(|dep_id| {
            let dep_sheet = engine.cell_store.sheet_for_cell(&dep_id)?;
            let dep_pos = engine.cell_store.resolve_position(&dep_id)?;
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
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<CellPositionResult> {
    let pos = SheetPos::new(row, col);
    let cell_id = match engine.cell_store.resolve_cell_id(sheet_id, pos) {
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
            let dep_sheet = engine.cell_store.sheet_for_cell(&target_id)?;
            let dep_pos = engine.cell_store.resolve_position(&target_id)?;
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
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    services::queries::get_merge_at_cell_query(
        &engine.stores,
        &engine.cell_store,
        sheet_id,
        row,
        col,
    )
}

pub(in crate::storage::engine) fn get_all_merges_in_sheet(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<ResolvedMergedRegion> {
    services::queries::get_all_merges_in_sheet(&engine.stores, &engine.cell_store, sheet_id)
}

pub(in crate::storage::engine) fn get_cell_id_at(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    services::queries::get_cell_id_at(&engine.cell_store, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_cell_position(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<CellPositionResult> {
    if let Some(mut result) =
        services::queries::get_cell_position(&engine.cell_store, sheet_id, cell_id_hex)
    {
        if let Ok(sid) = SheetId::from_uuid_str(&result.sheet_id) {
            result.sheet_name =
                services::queries::get_sheet_name(&engine.stores, &sid).unwrap_or_default();
        }
        return Some(result);
    }
    None
}

pub(in crate::storage::engine) fn resolve_cell_positions(
    engine: &ComputeEngine,
    cell_id_hexes: Vec<String>,
) -> Vec<Option<CellPositionResult>> {
    services::queries::resolve_cell_positions(&engine.cell_store, &cell_id_hexes)
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
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    services::queries::is_projection_source(&engine.cell_store, sheet_id, row, col)
}

pub(in crate::storage::engine) fn is_projected_position(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    services::queries::is_projected_position(&engine.cell_store, sheet_id, row, col)
}
