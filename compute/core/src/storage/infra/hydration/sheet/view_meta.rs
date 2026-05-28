use std::sync::Arc;

use domain_types::SheetData;
use domain_types::yrs_schema;
use yrs::{Any, Map, MapRef};

use crate::storage::infra::hydration::view::{
    hydrate_frozen_pane, hydrate_hf_images, hydrate_page_breaks, hydrate_print_settings,
    hydrate_sheet_protection, hydrate_view_options,
};

pub(crate) fn sheet_color_to_hex(color: &ooxml_types::styles::ColorDef) -> Option<String> {
    match color {
        ooxml_types::styles::ColorDef::Rgb { val, .. } => {
            let rgb = val.strip_prefix("FF").unwrap_or(val);
            Some(format!("#{rgb}"))
        }
        ooxml_types::styles::ColorDef::Indexed { .. }
        | ooxml_types::styles::ColorDef::Theme { .. }
        | ooxml_types::styles::ColorDef::Auto { .. } => None,
    }
}

pub(crate) fn hydrate_sheet_view_metadata(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    sheet: &SheetData,
    write_sheet_properties: bool,
) {
    hydrate_frozen_pane(txn, meta_map, &sheet.frozen_pane);
    hydrate_view_options(txn, meta_map, &sheet.view);
    hydrate_sheet_protection(txn, meta_map, &sheet.protection);
    hydrate_print_settings(txn, meta_map, &sheet.print_settings);
    hydrate_hf_images(txn, meta_map, &sheet.hf_images);
    hydrate_page_breaks(txn, meta_map, &sheet.page_breaks);

    yrs_schema::helpers::write_json_vec(meta_map, txn, "extraSheetViews", &sheet.extra_sheet_views);
    if let Some(xml) = sheet
        .sheet_views_ext_lst_xml
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        meta_map.insert(txn, "sheetViewsExtLstXml", Any::String(Arc::from(xml)));
    }

    if let Some(ref uid) = sheet.uid {
        meta_map.insert(txn, "sheetUid", Any::String(Arc::from(uid.as_str())));
    }
    if write_sheet_properties && let Some(properties) = &sheet.sheet_properties {
        yrs_schema::sheet_properties::insert(txn, meta_map, properties);
        if let Some(color) = properties.tab_color.as_ref().and_then(sheet_color_to_hex) {
            meta_map.insert(txn, "tabColor", Any::String(Arc::from(color.as_str())));
        }
    }
}
