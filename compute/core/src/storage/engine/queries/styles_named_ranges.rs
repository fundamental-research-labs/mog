#![allow(unused_imports, unused_variables)]
use super::helpers::diff_top_level_keys;
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
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::history::metadata::{capture_workbook_entry, capture_workbook_field};
use crate::storage::engine::query_serialization::{cell_value_to_json, region_json};
use crate::storage::engine::{data_table_formula, services};
use crate::storage::sheet::{hyperlinks, merges, properties as sheets};
use crate::storage::workbook::settings as workbook;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use domain_types::{DefinedName, NameValidationResult};
use formula_types::WorkbookLookup;
use value_types::CellValue;
use value_types::ComputeError;

pub(in crate::storage::engine) fn get_slicer_style_count(engine: &ComputeEngine) -> u32 {
    services::queries::get_named_slicer_style_count(&engine.stores)
}

pub(in crate::storage::engine) fn get_slicer_style(
    engine: &ComputeEngine,
    name: &str,
) -> Option<NamedSlicerStyle> {
    services::queries::get_named_slicer_style(&engine.stores, name)
}

pub(in crate::storage::engine) fn list_slicer_styles(
    engine: &ComputeEngine,
) -> Vec<NamedSlicerStyle> {
    services::queries::list_named_slicer_styles(&engine.stores)
}

pub(in crate::storage::engine) fn add_slicer_style(
    engine: &mut ComputeEngine,
    name: &str,
    style: SlicerCustomStyle,
    make_unique_name: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let captured_name = if make_unique_name {
        workbook::unique_style_name(&engine.stores.storage.metadata, name)
    } else {
        name.to_owned()
    };
    capture_workbook_entry!(engine.stores.storage, named_slicer_styles, captured_name);
    let final_name = workbook::add_named_slicer_style(
        &mut engine.stores.storage.metadata,
        name,
        style,
        make_unique_name,
    )?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&final_name)?,
    ))
}

pub(in crate::storage::engine) fn delete_slicer_style(
    engine: &mut ComputeEngine,
    name: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    capture_workbook_entry!(engine.stores.storage, named_slicer_styles, name);
    workbook::delete_named_slicer_style(&mut engine.stores.storage.metadata, name)?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn duplicate_slicer_style(
    engine: &mut ComputeEngine,
    name: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let captured_name =
        workbook::unique_style_name(&engine.stores.storage.metadata, &format!("{name} Copy"));
    capture_workbook_entry!(engine.stores.storage, named_slicer_styles, captured_name);
    let new_name =
        workbook::duplicate_named_slicer_style(&mut engine.stores.storage.metadata, name)?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&new_name)?,
    ))
}

pub(in crate::storage::engine) fn set_default_pivot_table_style(
    engine: &mut ComputeEngine,
    style_id: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    capture_workbook_field!(engine.stores.storage, default_pivot_table_style);
    workbook::set_default_pivot_table_style(
        &mut engine.stores.storage.metadata,
        style_id.as_deref(),
    );
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn get_default_pivot_table_style(
    engine: &ComputeEngine,
) -> Option<String> {
    services::queries::get_default_pivot_table_style(&engine.stores)
}

pub(in crate::storage::engine) fn get_custom_setting(
    engine: &ComputeEngine,
    key: &str,
) -> Option<String> {
    services::queries::get_custom_setting(&engine.stores, key)
}

pub(in crate::storage::engine) fn set_custom_setting(
    engine: &mut ComputeEngine,
    key: &str,
    value: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let pre = workbook::get_settings(&engine.stores.storage.metadata);
    let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");

    workbook::set_custom_setting(&mut engine.stores.storage.metadata, key, value.as_deref());

    let post = workbook::get_settings(&engine.stores.storage.metadata);
    let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
    let changed_keys = diff_top_level_keys(&pre_json, &post_json);
    if changed_keys.is_empty() {
        return Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ));
    }

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

pub(in crate::storage::engine) fn list_custom_settings(
    engine: &ComputeEngine,
) -> Vec<(String, String)> {
    services::queries::list_custom_settings(&engine.stores)
}

pub(in crate::storage::engine) fn get_named_range_by_id(
    engine: &ComputeEngine,
    id: &str,
) -> Option<DefinedName> {
    services::queries::get_named_range_by_id(&engine.stores, id)
}

pub(in crate::storage::engine) fn get_named_range_by_name(
    engine: &ComputeEngine,
    name: &str,
    scope: Option<String>,
) -> Option<DefinedName> {
    services::queries::get_named_range_by_name(&engine.stores, name, scope.as_deref())
}

pub(in crate::storage::engine) fn get_named_ranges_by_scope(
    engine: &ComputeEngine,
    scope: Option<String>,
) -> Vec<DefinedName> {
    services::queries::get_named_ranges_by_scope(&engine.stores, scope.as_deref())
}

pub(in crate::storage::engine) fn get_visible_named_ranges(
    engine: &ComputeEngine,
) -> Vec<DefinedName> {
    services::queries::get_visible_named_ranges(&engine.stores)
}

pub(in crate::storage::engine) fn named_range_exists(
    engine: &ComputeEngine,
    name: &str,
    scope: Option<String>,
) -> bool {
    services::queries::named_range_exists(&engine.stores, name, scope.as_deref())
}

pub(in crate::storage::engine) fn named_range_count(engine: &ComputeEngine) -> usize {
    services::queries::named_range_count(&engine.stores)
}

pub(in crate::storage::engine) fn validate_named_range_name(
    engine: &ComputeEngine,
    name: &str,
    scope: Option<String>,
    exclude_id: Option<String>,
) -> NameValidationResult {
    services::queries::validate_named_range_name(
        &engine.stores,
        name,
        scope.as_deref(),
        exclude_id.as_deref(),
    )
}

pub(in crate::storage::engine) fn resolve_named_range(
    engine: &ComputeEngine,
    name: &str,
    current_sheet: Option<String>,
) -> Option<DefinedName> {
    services::queries::resolve_named_range(&engine.stores, name, current_sheet.as_deref())
}

pub(in crate::storage::engine) fn get_visible_sheet_ids(engine: &ComputeEngine) -> Vec<String> {
    services::queries::get_visible_sheet_ids(&engine.stores)
}

pub(in crate::storage::engine) fn get_hidden_sheet_ids(engine: &ComputeEngine) -> Vec<String> {
    services::queries::get_hidden_sheet_ids(&engine.stores)
}

pub(in crate::storage::engine) fn count_visible_sheets(engine: &ComputeEngine) -> u32 {
    services::queries::count_visible_sheets(&engine.stores)
}

pub(in crate::storage::engine) fn get_sheet_order(engine: &ComputeEngine) -> Vec<String> {
    services::queries::get_sheet_order(&engine.stores)
}

pub(in crate::storage::engine) fn get_first_sheet_id(engine: &ComputeEngine) -> Option<String> {
    services::queries::get_first_sheet_id(&engine.stores)
}

pub(in crate::storage::engine) fn get_print_settings(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> domain_types::domain::print::PrintSettings {
    services::queries::get_print_settings(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_hf_images(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
    services::queries::get_hf_images(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_sheet_meta(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Option<SheetMeta> {
    services::queries::get_sheet_meta(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn has_sheet_protection_password(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> bool {
    services::queries::has_sheet_protection_password(&engine.stores, sheet_id)
}
