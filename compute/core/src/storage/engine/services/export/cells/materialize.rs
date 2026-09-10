use cell_types::{CellId, SheetId};
use domain_types::{CellData, DocumentFormat, ImportedCellProjectionRole};
use rustc_hash::FxHashMap;
use value_types::CellValue;

use crate::cells::{CellStore, cell_metadata::FormulaResultMode};
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties::CellProperties;

use super::super::super::super::export::cell_format_to_document_format;
use super::super::PaletteOps;

#[allow(clippy::too_many_arguments)]
pub(super) fn build_cell_data_for_cell_id(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    cell_id: &CellId,
    row: u32,
    col: u32,
    all_props: &FxHashMap<CellId, CellProperties>,
    array_refs: &FxHashMap<CellId, String>,
    formula_metadata: &FxHashMap<CellId, crate::storage::FormulaMetadata>,
    rich_strings: &FxHashMap<CellId, domain_types::RichSharedString>,
    palette: &impl PaletteOps,
    preserve_blank: bool,
) -> Option<CellData> {
    // Export explicit cells from their stored value, not the effective value.
    // Effective reads fall back to imported range or projected values for Null ghost
    // cells; that is correct for formulas and viewport reads, but it would turn
    // authored blank/style-only cells into real XLSX value cells on save.
    let value = cell_store
        .get_cell_value_raw(cell_id)
        .map(export_scalar_value)
        .unwrap_or_else(|| {
            cell_store
                .get_cell_value_in_sheet(sheet_id, cell_id)
                .map(export_scalar_value)
                .unwrap_or(CellValue::Null)
        });

    let formula = stores
        .compute
        .get_formula(cell_id)
        .map(|s| s.to_string())
        .or_else(|| {
            cell_store
                .get_formula(cell_id)
                .map(|f| format!("={}", f.template))
        });

    let cell_props = all_props.get(cell_id);
    let style_id = cell_style_id(stores, cell_store, sheet_id, row, col, cell_props, palette);

    let cell_metadata_index = cell_props.and_then(|props| props.cell_metadata_index);
    let mut vm = cell_props.and_then(|props| props.vm);
    let imported_rich_error = cell_props
        .and_then(|props| props.imported_rich_error)
        .filter(|imported| {
            let current = vm == Some(imported.vm)
                && matches!(&value, CellValue::Error(error, _) if *error == imported.semantic);
            if !current {
                vm = None;
            }
            current
        });
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
    // An authored empty `<f>` has no executable formula text, but its typed
    // CellFormula metadata must keep the cell alive through Yrs/export.
    let has_formula_metadata = formula_metadata.contains_key(cell_id);
    let is_empty =
        value.is_null() && formula.is_none() && rich_string.is_none() && !has_formula_metadata;
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
        && !preserve_blank
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

    let dynamic = formula.is_some()
        && match cell_store.formula_result_mode(cell_id) {
            Some(FormulaResultMode::Dynamic) => true,
            Some(FormulaResultMode::Cse | FormulaResultMode::LegacyScalar) => false,
            None => {
                stores.compute.is_dynamic_array(cell_id).unwrap_or(false)
                    || (cell_store.projection_registry.get(cell_id).is_some()
                        && !cell_store.is_cse_anchor(cell_id))
            }
        };
    let array_ref = if dynamic {
        let origin = cell_types::SheetPos::new(row, col).to_string();
        Some(
            if let Some(projection) = cell_store.projection_registry.get(cell_id) {
                let end =
                    cell_types::SheetPos::new(row + projection.rows - 1, col + projection.cols - 1);
                if projection.rows == 1 && projection.cols == 1 {
                    origin
                } else {
                    format!("{origin}:{end}")
                }
            } else if matches!(value, CellValue::Error(value_types::CellError::Spill, _)) {
                origin
            } else {
                array_refs.get(cell_id).cloned().unwrap_or(origin)
            },
        )
    } else {
        array_refs.get(cell_id).cloned()
    };
    // Authored CSE declarations store the native range without an imported
    // OOXML formula record. Reconstruct the array element for both CSE and
    // dynamic sources so saving preserves their result mode and extent.
    let cell_formula = if dynamic || array_ref.is_some() {
        let mut metadata = formula_metadata
            .get(cell_id)
            .map(|metadata| metadata.to_ooxml(formula.as_deref().unwrap_or("")))
            .unwrap_or_default();
        metadata.text = formula
            .as_deref()
            .unwrap_or_default()
            .trim_start_matches('=')
            .to_string();
        metadata.t = ooxml_types::worksheet::CellFormulaType::Array;
        metadata.si = None;
        metadata.r#ref = array_ref.clone();
        Some(metadata)
    } else {
        formula_metadata
            .get(cell_id)
            .map(|metadata| metadata.to_ooxml(formula.as_deref().unwrap_or("")))
    };

    Some(CellData {
        row,
        col,
        value,
        rich_string,
        formula: formula
            .as_deref()
            .map(|f| f.strip_prefix('=').unwrap_or(f).to_string()),
        array_ref,
        style_id,
        cell_formula,
        cell_metadata_index,
        formula_result_type,
        has_empty_cached_value,
        formula_cache_provenance,
        vm,
        imported_rich_error,
        phonetic,
        date_lexical_value,
        original_sst_index,
        original_value,
        projection_role: if dynamic {
            ImportedCellProjectionRole::DynamicArraySource
        } else {
            ImportedCellProjectionRole::Normal
        },
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

#[allow(clippy::too_many_arguments)]
fn cell_style_id(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    cell_props: Option<&CellProperties>,
    palette: &impl PaletteOps,
) -> Option<u32> {
    let props = cell_props?;

    // A compact imported property keeps its original cellXf index. Preserve
    // that lineage verbatim; only edited/inline formats (whose mutators clear
    // `style_id`) belong in the generated palette tail.
    if let Some(style_id) = props.style_id {
        return Some(style_id);
    }

    let direct_format = props.format.as_ref()?;
    if cell_format_to_document_format(direct_format) == DocumentFormat::default() {
        return None;
    }

    // An XLSX cellXf is a complete style at the cell layer; it does not retain
    // Mog's property-level inheritance from row, column, authored range, or
    // structured/table layers. Generated XFs must therefore snapshot the full
    // authored cascade. Conditional formatting is deliberately excluded: it is
    // exported independently and must remain dynamic.
    let table_format = crate::storage::engine::services::resolve_structured_format_at_cell(
        cell_store, sheet_id, row, col,
    );
    let effective = crate::storage::properties::get_effective_format_preloaded(
        &stores.storage,
        sheet_id,
        row,
        col,
        table_format.as_ref(),
        Some(props),
        stores.grid_indexes.get(sheet_id),
        cell_store.get_sheet(sheet_id),
    );
    let doc_fmt = cell_format_to_document_format(&effective);
    Some(palette.get_or_insert(doc_fmt))
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
        imported_rich_error: None,
        phonetic: false,
        date_lexical_value: None,
        original_sst_index: None,
        original_value: None,
        projection_role: ImportedCellProjectionRole::Normal,
    }
}
