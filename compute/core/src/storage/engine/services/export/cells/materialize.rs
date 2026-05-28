use cell_types::{CellId, SheetId};
use domain_types::{CellData, DocumentFormat, ImportedCellProjectionRole};
use rustc_hash::FxHashMap;
use value_types::CellValue;

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties::CellProperties;

use super::super::super::super::export::cell_format_to_document_format;
use super::super::PaletteOps;

#[allow(clippy::too_many_arguments)]
pub(super) fn build_cell_data_for_cell_id(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id: &CellId,
    row: u32,
    col: u32,
    all_props: &FxHashMap<CellId, CellProperties>,
    array_refs: &FxHashMap<CellId, String>,
    formula_metadata: &FxHashMap<CellId, ooxml_types::worksheet::CellFormula>,
    rich_strings: &FxHashMap<CellId, domain_types::RichSharedString>,
    palette: &impl PaletteOps,
    preserve_blank: bool,
) -> Option<CellData> {
    // Get value: ComputeCore first, then mirror fallback.
    let value = stores
        .compute
        .get_cell_value(mirror, cell_id)
        .cloned()
        .unwrap_or_else(|| {
            mirror
                .get_cell_value_in_sheet(sheet_id, cell_id)
                .cloned()
                .unwrap_or(CellValue::Null)
        });

    let formula = stores
        .compute
        .get_formula(cell_id)
        .map(|s| s.to_string())
        .or_else(|| {
            mirror
                .get_formula(cell_id)
                .map(|f| format!("={}", f.template))
        });

    let cell_props = all_props.get(cell_id);
    let style_id = cell_style_id(cell_props, palette);

    let cm = cell_props.map(|props| props.cm).unwrap_or(false);
    let vm = cell_props.and_then(|props| props.vm);
    let formula_result_type = cell_props.and_then(|props| props.formula_result_type);
    let has_empty_cached_value = cell_props
        .map(|props| props.has_empty_cached_value)
        .unwrap_or(false);
    let original_sst_index = cell_props.and_then(|props| props.original_sst_index);
    let original_value = cell_props
        .and_then(|props| props.original_value.as_ref())
        .cloned();

    let rich_string = rich_strings.get(cell_id).cloned();
    let is_empty = value.is_null() && formula.is_none() && rich_string.is_none();
    if is_empty
        && style_id.is_none()
        && !cm
        && vm.is_none()
        && formula_result_type.is_none()
        && !has_empty_cached_value
        && original_sst_index.is_none()
        && original_value.is_none()
        && !preserve_blank
    {
        return None;
    }
    if is_empty
        && is_imported_style_only_blank(
            style_id,
            cell_props,
            cm,
            vm,
            formula_result_type,
            has_empty_cached_value,
            original_sst_index,
            original_value.as_ref(),
        )
    {
        return None;
    }

    Some(CellData {
        row,
        col,
        value,
        rich_string,
        formula: formula
            .as_deref()
            .map(|f| f.strip_prefix('=').unwrap_or(f).to_string()),
        array_ref: array_refs.get(cell_id).cloned(),
        style_id,
        cell_formula: formula_metadata.get(cell_id).cloned(),
        cm,
        formula_result_type,
        has_empty_cached_value,
        vm,
        original_sst_index,
        original_value,
        projection_role: ImportedCellProjectionRole::Normal,
    })
}

fn is_imported_style_only_blank(
    style_id: Option<u32>,
    cell_props: Option<&CellProperties>,
    cm: bool,
    vm: Option<u32>,
    formula_result_type: Option<u8>,
    has_empty_cached_value: bool,
    original_sst_index: Option<u32>,
    original_value: Option<&String>,
) -> bool {
    style_id.is_some()
        && cell_props.is_some_and(|props| props.format.is_none() && props.style_id.is_some())
        && !cm
        && vm.is_none()
        && formula_result_type.is_none()
        && !has_empty_cached_value
        && original_sst_index.is_none()
        && original_value.is_none_or(|value| value.is_empty())
}

fn cell_style_id(cell_props: Option<&CellProperties>, palette: &impl PaletteOps) -> Option<u32> {
    cell_props.and_then(|props| {
        let cell_fmt = props.format.as_ref()?;
        let doc_fmt = cell_format_to_document_format(cell_fmt);
        if doc_fmt == DocumentFormat::default() {
            return None;
        }
        Some(palette.get_or_insert(doc_fmt))
    })
}

pub(super) fn range_payload_cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        row,
        col,
        value,
        rich_string: None,
        formula: None,
        array_ref: None,
        style_id: None,
        cell_formula: None,
        cm: false,
        formula_result_type: None,
        has_empty_cached_value: false,
        vm: None,
        original_sst_index: None,
        original_value: None,
        projection_role: ImportedCellProjectionRole::Normal,
    }
}

pub(super) fn is_plain_blank_cell(cell: &CellData) -> bool {
    cell.value.is_null()
        && cell.formula.is_none()
        && cell.rich_string.is_none()
        && cell.style_id.is_none()
        && cell.cell_formula.is_none()
        && !cell.cm
        && cell.formula_result_type.is_none()
        && !cell.has_empty_cached_value
        && cell.vm.is_none()
        && cell.original_sst_index.is_none()
        && cell
            .original_value
            .as_ref()
            .is_none_or(|value| value.is_empty())
}

pub(super) fn is_imported_style_only_blank_cell(cell: &CellData) -> bool {
    cell.value.is_null()
        && cell.formula.is_none()
        && cell.rich_string.is_none()
        && cell.style_id.is_some()
        && cell.cell_formula.is_none()
        && !cell.cm
        && cell.formula_result_type.is_none()
        && !cell.has_empty_cached_value
        && cell.vm.is_none()
        && cell.original_sst_index.is_none()
        && cell
            .original_value
            .as_ref()
            .is_none_or(|value| value.is_empty())
}

pub(super) fn explicit_blank_cell(row: u32, col: u32) -> CellData {
    range_payload_cell(row, col, CellValue::Null)
}
