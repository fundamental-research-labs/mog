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
use formula_types::WorkbookLookup;
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

pub(in crate::storage::engine) fn query_range(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> RangeQueryResult {
    let mut cells = Vec::new();
    let grid_index = engine.stores.grid_indexes.get(sheet_id);

    services::queries::for_each_cell_in_range(
        engine,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        true, // include format-only cells
        &mut |visit| {
            let cell_id_str = if let Some(cid) = visit.cell_id {
                cid.to_uuid_string()
            } else if visit.is_projection {
                engine
                    .mirror
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
                        engine.stores.storage.doc(),
                        engine.stores.storage.sheets(),
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

    let merges_result: Vec<ViewportMerge> = match grid_index {
        Some(grid) => merges::get_merges_in_viewport(
            engine.stores.storage.doc(),
            engine.stores.storage.sheets(),
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

pub(in crate::storage::engine) fn get_range_with_identity(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<IdentityCell> {
    let mut cells = Vec::new();

    services::queries::for_each_cell_in_range(
        engine,
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
                engine
                    .mirror
                    .projection_registry
                    .resolve(sheet_id, visit.row, visit.col)
                    .map(|(src, _, _)| src.to_uuid_string())
                    .unwrap_or_default()
            } else {
                String::new()
            };

            let value = match &visit.value {
                value_types::CellValue::Error(err, _) => {
                    value_types::CellValue::Text(err.as_str().into())
                }
                other => other.clone(),
            };

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
                    value_types::CellValue::Image(image) => image.fallback_text().to_string(),
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

pub(in crate::storage::engine) fn query_ranges(
    engine: &YrsComputeEngine,
    requests: Vec<BatchRangeRequest>,
) -> BatchRangeResponse {
    let entries = requests
        .into_iter()
        .map(|req| {
            let sheet_id = match engine.mirror.sheet_by_name(&req.sheet_name) {
                Some(id) => id,
                None => {
                    return BatchRangeEntry::Err {
                        message: format!("Sheet not found: {}", req.sheet_name),
                    };
                }
            };

            let (start_row, start_col, end_row, end_col) =
                match (req.start_row, req.start_col, req.end_row, req.end_col) {
                    (Some(sr), Some(sc), Some(er), Some(ec)) => (sr, sc, er, ec),
                    _ => {
                        match services::queries::get_data_bounds(
                            &engine.stores,
                            &engine.mirror,
                            &sheet_id,
                        ) {
                            Some(bounds) => (
                                bounds.min_row,
                                bounds.min_col,
                                bounds.max_row,
                                bounds.max_col,
                            ),
                            None => {
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

            let result = engine.query_range(&sheet_id, start_row, start_col, end_row, end_col);

            let sheet_name_resolved = services::queries::get_sheet_name(&engine.stores, &sheet_id)
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

pub(in crate::storage::engine) fn regex_search(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    options: RegexSearchOptions,
) -> RegexSearchResult {
    services::queries::regex_search(engine, sheet_id, options)
}

pub(in crate::storage::engine) fn find_in_range(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: crate::engine_types::queries::FindInRangeOptions,
) -> Option<crate::engine_types::queries::FindInRangeResult> {
    services::queries::find_in_range(
        &engine.stores,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        options,
    )
}

pub(in crate::storage::engine) fn find_all_in_range(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: crate::engine_types::queries::FindInRangeOptions,
) -> Vec<crate::engine_types::queries::FindInRangeResult> {
    services::queries::find_all_in_range(
        &engine.stores,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        options,
    )
}

pub(in crate::storage::engine) fn regex_search_all_sheets(
    engine: &YrsComputeEngine,
    options: RegexSearchOptions,
) -> WorkbookSearchResult {
    services::queries::regex_search_all_sheets(engine, options)
}

pub(in crate::storage::engine) fn sign_check(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: SignCheckOptions,
) -> SignCheckResult {
    services::queries::sign_check(
        engine, sheet_id, start_row, start_col, end_row, end_col, options,
    )
}

pub(in crate::storage::engine) fn validate_formula_syntax(
    engine: &YrsComputeEngine,
    _sheet_id: &SheetId,
    formula: &str,
) -> Option<(String, Option<u32>)> {
    compute_parser::parse_formula(formula, None)
        .err()
        .map(|err| (err.message(), u32::try_from(err.position()).ok()))
}

pub(in crate::storage::engine) fn validate_formula_circular_reference(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    formula: &str,
) -> Option<crate::engine_types::FormulaCircularReferenceValidation> {
    engine.stores.compute.validate_formula_circular_reference(
        &engine.mirror,
        sheet_id,
        row,
        col,
        formula,
    )
}

pub(in crate::storage::engine) fn evaluate_expression(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    expression: &str,
) -> Result<CellValue, ComputeError> {
    let formula_str = if expression.trim_start().starts_with('=') {
        expression.to_string()
    } else {
        format!("={}", expression)
    };

    let ast = compute_parser::parse_formula(&formula_str, None)
        .map_err(|e| ComputeError::Eval {
            message: format!("Failed to parse expression: {}", e),
        })?
        .into_inner();

    let cell_id = engine
        .mirror
        .resolve_cell_id(sheet_id, SheetPos::new(0, 0))
        .unwrap_or(CellId::from_raw(0));
    let ctx = MirrorContext::new(&engine.mirror, cell_id, *sheet_id);

    let value =
        sync_block_on(Evaluator::evaluate(&ast, &ctx, &ctx)).map_err(|e| ComputeError::Eval {
            message: format!("Expression evaluation failed: {}", e),
        })?;

    if matches!(value, CellValue::Null) {
        return Ok(CellValue::number(0.0));
    }

    if let CellValue::Array(ref arr) = value {
        return Ok(arr.get(0, 0).cloned().unwrap_or(CellValue::number(0.0)));
    }

    Ok(value)
}
