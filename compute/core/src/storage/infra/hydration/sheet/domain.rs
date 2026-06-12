use std::sync::Arc;

use domain_types::{SheetData, WorksheetSemanticContainers};
use yrs::{Any, Map, MapRef};

pub(crate) fn hydrate_worksheet_semantic_containers(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    containers: &WorksheetSemanticContainers,
) {
    if containers.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(containers) {
        meta_map.insert(
            txn,
            "worksheetSemanticContainers",
            Any::String(Arc::from(json.as_str())),
        );
    }
}

pub(crate) fn hydrate_worksheet_import_xml_metadata(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    sheet: &SheetData,
) {
    if !sheet.worksheet_root_namespaces.is_empty()
        && let Ok(json) = serde_json::to_string(&sheet.worksheet_root_namespaces)
    {
        meta_map.insert(
            txn,
            "worksheetRootNamespaces",
            Any::String(Arc::from(json.as_str())),
        );
    }
    if let Some(xml) = sheet
        .worksheet_ext_lst_xml
        .as_deref()
        .filter(|xml| !xml.is_empty())
        .and_then(
            xlsx_parser::write::from_parse_output::strip_modeled_x14_data_validations_from_ext_lst,
        )
        .filter(|xml| !xml.is_empty())
    {
        meta_map.insert(
            txn,
            "worksheetExtLstXml",
            Any::String(Arc::from(xml.as_str())),
        );
    }
    if let Some(dimension_ref) = sheet
        .worksheet_dimension_ref
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        meta_map.insert(
            txn,
            "worksheetDimensionRef",
            Any::String(Arc::from(dimension_ref)),
        );
    }
    if let Some(sheet_calc_pr) = &sheet.sheet_calc_pr
        && let Ok(json) = serde_json::to_string(sheet_calc_pr)
    {
        meta_map.insert(txn, "sheetCalcPr", Any::String(Arc::from(json.as_str())));
    }
}
