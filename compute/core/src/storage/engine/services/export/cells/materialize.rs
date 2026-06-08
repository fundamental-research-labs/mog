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
    // Export explicit cells from their stored value, not the effective value.
    // Effective reads fall back to range/projection col_data for Null ghost
    // cells; that is correct for formulas and viewport reads, but it would turn
    // authored blank/style-only cells into real XLSX value cells on save.
    let value = mirror
        .get_cell_value_raw(cell_id)
        .map(export_scalar_value)
        .unwrap_or_else(|| {
            mirror
                .get_cell_value_in_sheet(sheet_id, cell_id)
                .map(export_scalar_value)
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

    let cell_metadata_index = cell_props.and_then(|props| props.cell_metadata_index);
    let vm = cell_props.and_then(|props| props.vm);
    let formula_result_type = cell_props.and_then(|props| props.formula_result_type);
    let has_empty_cached_value = cell_props
        .map(|props| props.has_empty_cached_value)
        .unwrap_or(false);
    let formula_cache_provenance = cell_props
        .map(|props| props.formula_cache_provenance.clone())
        .unwrap_or_default();
    let original_sst_index = cell_props.and_then(|props| props.original_sst_index);
    let original_value = cell_props
        .and_then(|props| props.original_value.as_ref())
        .cloned();
    let phonetic = cell_props.map(|props| props.phonetic).unwrap_or(false);
    let date_lexical_value = cell_props
        .and_then(|props| props.date_lexical_value.as_ref())
        .cloned();

    let rich_string = rich_strings.get(cell_id).cloned();
    let is_empty = value.is_null() && formula.is_none() && rich_string.is_none();
    if is_empty
        && style_id.is_none()
        && cell_metadata_index.is_none()
        && vm.is_none()
        && formula_result_type.is_none()
        && !has_empty_cached_value
        && formula_cache_provenance.is_absent_or_unknown()
        && original_sst_index.is_none()
        && original_value.is_none()
        && !phonetic
        && date_lexical_value.is_none()
        && !preserve_blank
    {
        return None;
    }
    if is_empty
        && is_imported_style_only_blank(
            style_id,
            cell_props,
            cell_metadata_index,
            vm,
            formula_result_type,
            has_empty_cached_value,
            &formula_cache_provenance,
            original_sst_index,
            original_value.as_ref(),
            phonetic,
            date_lexical_value.as_ref(),
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
        cell_metadata_index,
        formula_result_type,
        has_empty_cached_value,
        formula_cache_provenance,
        vm,
        phonetic,
        date_lexical_value,
        original_sst_index,
        original_value,
        projection_role: ImportedCellProjectionRole::Normal,
    })
}

fn export_scalar_value(value: &CellValue) -> CellValue {
    match value {
        CellValue::Array(array) => array.get(0, 0).cloned().unwrap_or(CellValue::Null),
        value => value.clone(),
    }
}

fn is_imported_style_only_blank(
    style_id: Option<u32>,
    cell_props: Option<&CellProperties>,
    cell_metadata_index: Option<u32>,
    vm: Option<u32>,
    formula_result_type: Option<u8>,
    has_empty_cached_value: bool,
    formula_cache_provenance: &domain_types::FormulaCacheProvenance,
    original_sst_index: Option<u32>,
    original_value: Option<&String>,
    phonetic: bool,
    date_lexical_value: Option<&String>,
) -> bool {
    style_id.is_some()
        && cell_props.is_some_and(|props| props.format.is_none() && props.style_id.is_some())
        && cell_metadata_index.is_none()
        && vm.is_none()
        && formula_result_type.is_none()
        && !has_empty_cached_value
        && formula_cache_provenance.is_absent_or_unknown()
        && original_sst_index.is_none()
        && original_value.is_none_or(|value| value.is_empty())
        && !phonetic
        && date_lexical_value.is_none()
}

fn cell_style_id(cell_props: Option<&CellProperties>, palette: &impl PaletteOps) -> Option<u32> {
    cell_props.and_then(|props| {
        if let Some(cell_fmt) = props.format.as_ref() {
            let doc_fmt = cell_format_to_document_format(cell_fmt);
            if doc_fmt != DocumentFormat::default() {
                return Some(palette.get_or_insert(doc_fmt));
            }
        }
        props.style_id
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
        cell_metadata_index: None,
        formula_result_type: None,
        has_empty_cached_value: false,
        formula_cache_provenance: Default::default(),
        vm: None,
        phonetic: false,
        date_lexical_value: None,
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
        && cell.cell_metadata_index.is_none()
        && cell.formula_result_type.is_none()
        && !cell.has_empty_cached_value
        && cell.formula_cache_provenance.is_absent_or_unknown()
        && cell.vm.is_none()
        && !cell.phonetic
        && cell.date_lexical_value.is_none()
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
        && cell.cell_metadata_index.is_none()
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
