use domain_types::domain::custom_table_style::CustomTableStyleConfig;
use ooxml_types::styles::TableStyleDef;

pub(super) fn hydrate_custom_table_styles_from_ooxml(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    table_styles: &[TableStyleDef],
    workbook_stylesheet: &Option<domain_types::WorkbookStylesheet>,
    theme: &Option<domain_types::domain::theme::ThemeData>,
) {
    metadata.custom_table_styles.clear();
    merge_custom_table_styles_from_ooxml(metadata, table_styles, workbook_stylesheet, theme);
}

/// Merge imported custom styles, renaming conflicting definitions for sheet imports.
pub(crate) fn merge_custom_table_styles_from_ooxml(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    table_styles: &[TableStyleDef],
    workbook_stylesheet: &Option<domain_types::WorkbookStylesheet>,
    theme: &Option<domain_types::domain::theme::ThemeData>,
) -> std::collections::HashMap<String, String> {
    let mut renamed = std::collections::HashMap::new();
    let mut reserved: std::collections::HashSet<String> = metadata
        .custom_table_styles
        .keys()
        .chain(table_styles.iter().map(|style| &style.name))
        .map(|name| name.to_ascii_lowercase())
        .collect();
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

    for style in table_styles {
        if should_skip_public_custom_style(style) {
            continue;
        }
        let mut public_style = CustomTableStyleConfig::from_ooxml_table_style(
            style,
            &stylesheet.dxf_registry,
            &theme_colors,
        );
        if let Some(existing) = metadata
            .custom_table_styles
            .iter()
            .find_map(|(name, existing)| name.eq_ignore_ascii_case(&style.name).then_some(existing))
        {
            if existing == &public_style {
                continue;
            }
            let mut suffix = 2u32;
            let unique_name = loop {
                let candidate = format!("{}_{suffix}", style.name);
                if reserved.insert(candidate.to_ascii_lowercase()) {
                    break candidate;
                }
                suffix += 1;
            };
            renamed.insert(style.name.to_ascii_lowercase(), unique_name.clone());
            public_style.name = unique_name.clone();
            public_style.id = unique_name;
        }
        metadata
            .custom_table_styles
            .insert(public_style.name.clone(), public_style);
    }
    renamed
}

fn should_skip_public_custom_style(style: &TableStyleDef) -> bool {
    style.name.trim().is_empty()
        || style.table == Some(false)
        || compute_table::styles::get_built_in_style(&style.name).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::WorkbookStorage;
    use crate::storage::infra::hydration::DefaultIdAllocator;
    use ooxml_types::styles::{FillDef, PatternType, TableStyleElementDef, TableStyleType};

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

        let mut storage = WorkbookStorage::new();
        let mut allocator = DefaultIdAllocator::new();
        storage
            .hydrate_from_parse_output(&output, &mut allocator)
            .expect("hydrate_from_parse_output");

        let style = storage
            .metadata
            .custom_table_styles
            .get("MogBrandExportStyle")
            .expect("native custom style");
        assert_eq!(style.header_row.fill.as_deref(), Some("#1F4E78"));
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

        let mut storage = WorkbookStorage::new();
        let mut allocator = DefaultIdAllocator::new();
        storage
            .hydrate_from_parse_output(&output, &mut allocator)
            .expect("hydrate_from_parse_output");

        let style = storage
            .metadata
            .custom_table_styles
            .get("MogEmptyCustomStyle")
            .expect("native custom style");
        assert_eq!(style.name, "MogEmptyCustomStyle");
        assert_eq!(style.whole_table, Default::default());
    }
}
