#![allow(unused_imports, unused_variables)]
use super::helpers::cell_value_to_type_string;
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
use formula_types::WorkbookLookup;
use value_types::CellValue;
use value_types::ComputeError;

pub(in crate::storage::engine) fn get_cell_id_at_yrs(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    services::queries::get_cell_id_at_yrs(&engine.stores, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_cells_in_range(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<String> {
    services::queries::get_cells_in_range(
        &engine.stores,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    )
}

pub(in crate::storage::engine) fn get_all_cells_yrs(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> serde_json::Value {
    services::queries::get_all_cells_yrs(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_cells_in_range_yrs(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> serde_json::Value {
    services::queries::get_cells_in_range_yrs(
        &engine.stores,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    )
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn get_data_bounds_for_range(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    is_full_column: bool,
    is_full_row: bool,
) -> Option<RectBounds> {
    services::queries::get_data_bounds_for_range(
        &engine.stores,
        &engine.mirror,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        is_full_column,
        is_full_row,
    )
}

pub(in crate::storage::engine) fn parse_range_ref(
    engine: &YrsComputeEngine,
    range_str: &str,
) -> Option<A1RangeRef> {
    services::queries::parse_range_ref(range_str)
}

pub(in crate::storage::engine) fn stringify_range_ref(
    engine: &YrsComputeEngine,
    range: A1RangeRef,
) -> Option<String> {
    services::queries::stringify_range_ref(&range)
}

pub(in crate::storage::engine) fn parse_cell_ref(
    engine: &YrsComputeEngine,
    cell_str: &str,
) -> Option<A1CellRef> {
    services::queries::parse_cell_ref(cell_str)
}

pub(in crate::storage::engine) fn stringify_cell_ref(
    engine: &YrsComputeEngine,
    cell: A1CellRef,
) -> Option<String> {
    services::queries::stringify_cell_ref(&cell)
}

pub(in crate::storage::engine) fn get_merges_in_viewport_spatial(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<MergeRegion> {
    services::queries::get_merges_in_viewport_spatial(
        &engine.stores,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    )
}

pub(in crate::storage::engine) fn get_merge_at_cell_spatial(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    services::queries::get_merge_at_cell_spatial(&engine.stores, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_named_range_display_value(
    engine: &YrsComputeEngine,
    name: &str,
    current_sheet: Option<String>,
) -> Option<String> {
    let scope_chain = engine.build_scope_chain(current_sheet.as_deref());
    let def = engine.mirror.resolve_variable(name, &scope_chain)?;
    let formula = &def.refers_to;

    if formula.refs.len() == 1
        && let formula_types::IdentityFormulaRef::Cell(cell_ref) = &formula.refs[0]
    {
        let lookup = MirrorPositionLookup::new(&engine.mirror, SheetId::from_raw(0));
        if let Some((sheet_id, row, col)) = lookup.cell_position(&cell_ref.id) {
            return Some(engine.format_cell_display(&sheet_id, row, col));
        }
    }

    if !formula.refs.is_empty() {
        let a1 = engine.stores.compute.to_a1_display_qualified(
            &engine.mirror,
            &SheetId::from_raw(0),
            formula,
        );
        let a1 = a1.strip_prefix('=').unwrap_or(&a1);
        if !a1.is_empty() {
            return Some(a1.to_string());
        }
    }

    def.raw_expression.clone().or_else(|| {
        if formula.template.is_empty() {
            None
        } else {
            Some(formula.template.clone())
        }
    })
}

pub(in crate::storage::engine) fn get_named_range_typed_value(
    engine: &YrsComputeEngine,
    name: &str,
    current_sheet: Option<String>,
) -> Option<CellValue> {
    let scope_chain = engine.build_scope_chain(current_sheet.as_deref());
    let def = engine.mirror.resolve_variable(name, &scope_chain)?;
    let formula = &def.refers_to;

    if formula.refs.len() == 1
        && let formula_types::IdentityFormulaRef::Cell(cell_ref) = &formula.refs[0]
    {
        let lookup = MirrorPositionLookup::new(&engine.mirror, SheetId::from_raw(0));
        if let Some((sheet_id, row, col)) = lookup.cell_position(&cell_ref.id) {
            return cell_values::get_effective_value(&engine.mirror, &sheet_id, row, col);
        }
    }

    if !formula.refs.is_empty() {
        let arr = engine.get_named_range_array_values(name, current_sheet)?;
        return arr.into_iter().next()?.into_iter().next();
    }

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

pub(in crate::storage::engine) fn get_named_range_type(
    engine: &YrsComputeEngine,
    name: &str,
    current_sheet: Option<String>,
) -> Option<String> {
    let scope_chain = engine.build_scope_chain(current_sheet.as_deref());
    let def = engine.mirror.resolve_variable(name, &scope_chain)?;
    let formula = &def.refers_to;

    if formula.refs.is_empty() {
        return Some("String".to_string());
    }

    if formula.refs.len() == 1 {
        match &formula.refs[0] {
            formula_types::IdentityFormulaRef::Cell(cell_ref) => {
                let lookup = MirrorPositionLookup::new(&engine.mirror, SheetId::from_raw(0));
                if let Some((sid, row, col)) = lookup.cell_position(&cell_ref.id) {
                    let value = cell_values::get_effective_value(&engine.mirror, &sid, row, col);
                    return Some(cell_value_to_type_string(value.as_ref()).to_string());
                }
            }
            _ => {
                return Some("Range".to_string());
            }
        }
    }

    Some("Range".to_string())
}

pub(in crate::storage::engine) fn get_named_range_array_values(
    engine: &YrsComputeEngine,
    name: &str,
    current_sheet: Option<String>,
) -> Option<Vec<Vec<CellValue>>> {
    let scope_chain = engine.build_scope_chain(current_sheet.as_deref());
    let def = engine.mirror.resolve_variable(name, &scope_chain)?;
    let formula = &def.refers_to;

    let a1 = if !formula.refs.is_empty() {
        let display = engine.stores.compute.to_a1_display_qualified(
            &engine.mirror,
            &SheetId::from_raw(0),
            formula,
        );
        let display = display.strip_prefix('=').unwrap_or(&display);
        display.to_string()
    } else {
        return None; // No refs → can't be a range
    };

    let range = range_manager::parse_range(&a1)?;
    let sid = engine.resolve_sheet_from_range(&range)?;

    let total_cells = (range.end.row as u64 - range.start.row as u64 + 1)
        * (range.end.col as u64 - range.start.col as u64 + 1);
    if total_cells > 10_000_000 {
        return None;
    }

    let mut rows = Vec::with_capacity((range.end.row - range.start.row + 1) as usize);
    for row in range.start.row..=range.end.row {
        let mut row_values = Vec::with_capacity((range.end.col - range.start.col + 1) as usize);
        for col in range.start.col..=range.end.col {
            let value = cell_values::get_effective_value(&engine.mirror, &sid, row, col)
                .unwrap_or_default();
            row_values.push(value);
        }
        rows.push(row_values);
    }

    Some(rows)
}

pub(in crate::storage::engine) fn format_cell_value_for_display(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> String {
    engine.format_cell_display(sheet_id, row, col)
}
