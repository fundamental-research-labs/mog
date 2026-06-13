use std::sync::Arc;

use domain_types::domain::custom_table_style::CustomTableStyleConfig;
use ooxml_types::styles::TableStyleDef;
use yrs::{Any, Map, MapRef};

use compute_document::schema::KEY_CUSTOM_TABLE_STYLES;

pub(super) fn hydrate_custom_table_styles_from_ooxml(
    workbook: &MapRef,
    table_styles: &[TableStyleDef],
    workbook_stylesheet: &Option<domain_types::WorkbookStylesheet>,
    theme: &Option<domain_types::domain::theme::ThemeData>,
    txn: &mut yrs::TransactionMut,
) {
    if table_styles.is_empty() {
        return;
    }

    let stylesheet = workbook_stylesheet
        .as_ref()
        .map(domain_types::WorkbookStylesheet::normalized)
        .unwrap_or_default();

    let theme_colors: Vec<String> = theme
        .as_ref()
        .map(|theme| {
            theme
                .colors
                .iter()
                .map(|color| color.color.clone())
                .collect()
        })
        .unwrap_or_default();

    let styles_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_CUSTOM_TABLE_STYLES);
    for style in table_styles {
        if should_skip_public_custom_style(style) {
            continue;
        }
        let public_style = CustomTableStyleConfig::from_ooxml_table_style(
            style,
            &stylesheet.dxf_registry,
            &theme_colors,
        );
        let Ok(json) = serde_json::to_string(&public_style) else {
            continue;
        };
        styles_map.insert(
            txn,
            style.name.as_str(),
            Any::String(Arc::from(json.as_str())),
        );
    }
}

fn should_skip_public_custom_style(style: &TableStyleDef) -> bool {
    style.name.trim().is_empty()
        || style.table == Some(false)
        || compute_table::styles::get_built_in_style(&style.name).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use crate::storage::infra::hydration::DefaultIdAllocator;
    use ooxml_types::styles::{FillDef, PatternType, TableStyleElementDef, TableStyleType};
    use yrs::{Out, Transact};

    #[test]
    fn imported_ooxml_table_styles_hydrate_only_canonical_custom_styles() {
        let output = domain_types::ParseOutput {
            custom_table_styles: vec![TableStyleDef {
                name: "MogBrandExportStyle".to_string(),
                pivot: Some(false),
                table: Some(true),
                count: Some(1),
                elements: vec![TableStyleElementDef {
                    style_type: TableStyleType::HeaderRow,
                    dxf_id: Some(0),
                    size: None,
                }],
                xr_uid: None,
            }],
            default_table_style: Some("MogBrandExportStyle".to_string()),
            workbook_stylesheet: Some(domain_types::WorkbookStylesheet {
                dxf_registry: vec![domain_types::DxfDef::from_ooxml(
                    0,
                    ooxml_types::styles::DxfDef {
                        fill: Some(FillDef::Pattern {
                            pattern_type: Some(PatternType::Solid),
                            fg_color: Some(ooxml_types::styles::ColorDef::Rgb {
                                val: "FF1F4E78".to_string(),
                                tint: None,
                            }),
                            bg_color: None,
                        }),
                        ..Default::default()
                    },
                )],
                ..Default::default()
            }),
            ..Default::default()
        };

        let mut storage = YrsStorage::new();
        let mut allocator = DefaultIdAllocator::new();
        storage
            .hydrate_from_parse_output(&output, &mut allocator)
            .expect("hydrate_from_parse_output");

        let txn = storage.doc().transact();
        let workbook = storage.workbook_map();
        let styles_map = match workbook.get(&txn, KEY_CUSTOM_TABLE_STYLES) {
            Some(Out::YMap(map)) => map,
            _ => panic!("canonical custom table style map should exist"),
        };
        let style_json = match styles_map.get(&txn, "MogBrandExportStyle") {
            Some(Out::Any(Any::String(json))) => json,
            _ => panic!("canonical custom table style should be persisted"),
        };
        let style: CustomTableStyleConfig =
            serde_json::from_str(&style_json).expect("canonical style json");
        assert_eq!(style.header_row.fill.as_deref(), Some("#1F4E78"));

        if let Some(Out::YMap(raw_table_styles)) =
            workbook.get(&txn, compute_document::schema::KEY_XLSX_TABLE_STYLES)
        {
            assert!(
                raw_table_styles.get(&txn, "styles").is_none(),
                "import must not persist raw OOXML table styles as a second export path"
            );
        }
    }

    #[test]
    fn imported_ooxml_table_style_without_dxfs_still_hydrates_canonical_style() {
        let output = domain_types::ParseOutput {
            custom_table_styles: vec![TableStyleDef {
                name: "MogEmptyCustomStyle".to_string(),
                pivot: Some(false),
                table: Some(true),
                count: Some(0),
                elements: Vec::new(),
                xr_uid: None,
            }],
            default_table_style: Some("MogEmptyCustomStyle".to_string()),
            workbook_stylesheet: None,
            ..Default::default()
        };

        let mut storage = YrsStorage::new();
        let mut allocator = DefaultIdAllocator::new();
        storage
            .hydrate_from_parse_output(&output, &mut allocator)
            .expect("hydrate_from_parse_output");

        let txn = storage.doc().transact();
        let workbook = storage.workbook_map();
        let styles_map = match workbook.get(&txn, KEY_CUSTOM_TABLE_STYLES) {
            Some(Out::YMap(map)) => map,
            _ => panic!("canonical custom table style map should exist"),
        };
        let style_json = match styles_map.get(&txn, "MogEmptyCustomStyle") {
            Some(Out::Any(Any::String(json))) => json,
            _ => panic!("canonical custom table style should be persisted"),
        };
        let style: CustomTableStyleConfig =
            serde_json::from_str(&style_json).expect("canonical style json");
        assert_eq!(style.name, "MogEmptyCustomStyle");
        assert_eq!(style.whole_table, Default::default());
    }
}
