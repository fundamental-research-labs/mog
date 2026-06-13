use super::{CustomTableStyleConfig, StripePattern, TableElementStyle};
use crate::DxfDef as WorkbookDxfDef;
use crate::theme_color::apply_tint;
use ooxml_types::styles::{
    BorderDef, BorderSideDef, BorderStyle, ColorDef, FillDef, FontDef, PatternType, TableStyleDef,
    TableStyleElementDef, TableStyleType,
};

/// Result of converting a canonical custom table style into OOXML table style
/// metadata plus workbook DXF registry entries.
#[derive(Debug, Clone, PartialEq)]
pub struct CustomTableStyleOoxmlExport {
    pub style: TableStyleDef,
    pub dxfs: Vec<WorkbookDxfDef>,
}

impl CustomTableStyleConfig {
    /// Convert canonical custom table style data into the OOXML representation
    /// used in `xl/styles.xml`.
    ///
    /// `next_dxf_id` is the workbook-scoped DXF identity allocator. The caller
    /// owns seeding it from the existing workbook DXF registry.
    #[must_use]
    pub fn to_ooxml_table_style(&self, next_dxf_id: &mut u32) -> CustomTableStyleOoxmlExport {
        TableStyleExporter::new(next_dxf_id).export(self)
    }

    /// Convert parsed OOXML table style data into the canonical public custom
    /// table style shape used by SDK authoring/editing and engine storage.
    #[must_use]
    pub fn from_ooxml_table_style(
        style: &TableStyleDef,
        dxfs: &[WorkbookDxfDef],
        theme_colors: &[String],
    ) -> Self {
        TableStyleImporter::new(dxfs, theme_colors).import(style)
    }
}

struct TableStyleExporter<'a> {
    next_dxf_id: &'a mut u32,
    elements: Vec<TableStyleElementDef>,
    dxfs: Vec<WorkbookDxfDef>,
}

impl<'a> TableStyleExporter<'a> {
    fn new(next_dxf_id: &'a mut u32) -> Self {
        Self {
            next_dxf_id,
            elements: Vec::new(),
            dxfs: Vec::new(),
        }
    }

    fn export(mut self, style: &CustomTableStyleConfig) -> CustomTableStyleOoxmlExport {
        for (style_type, element_style) in direct_element_styles(style) {
            self.add_element(style_type, element_style, None);
        }
        self.add_stripe_pattern(
            &style.row_stripes,
            StripeTargets {
                first: TableStyleType::FirstRowStripe,
                second: TableStyleType::SecondRowStripe,
            },
        );
        self.add_stripe_pattern(
            &style.column_stripes,
            StripeTargets {
                first: TableStyleType::FirstColumnStripe,
                second: TableStyleType::SecondColumnStripe,
            },
        );

        CustomTableStyleOoxmlExport {
            style: TableStyleDef {
                name: style.name.clone(),
                pivot: Some(false),
                table: Some(true),
                count: Some(self.elements.len() as u32),
                elements: self.elements,
                xr_uid: None,
            },
            dxfs: self.dxfs,
        }
    }

    fn add_stripe_pattern(&mut self, stripe: &StripePattern, targets: StripeTargets) {
        let size = Some(stripe.stripe_size as u32);
        if let Some(fill) = stripe.stripe1_fill.as_deref() {
            self.add_fill_element(targets.first, fill, size);
        }
        if let Some(fill) = stripe.stripe2_fill.as_deref() {
            self.add_fill_element(targets.second, fill, size);
        }
    }

    fn add_fill_element(&mut self, style_type: TableStyleType, fill: &str, size: Option<u32>) {
        self.add_element(
            style_type,
            &TableElementStyle {
                fill: Some(fill.to_string()),
                ..Default::default()
            },
            size,
        );
    }

    fn add_element(
        &mut self,
        style_type: TableStyleType,
        style: &TableElementStyle,
        size: Option<u32>,
    ) {
        let dxf_id = *self.next_dxf_id;
        let Some(dxf) = workbook_dxf_for_element(dxf_id, style) else {
            return;
        };

        *self.next_dxf_id = (*self.next_dxf_id).saturating_add(1);
        self.dxfs.push(dxf);
        self.elements.push(TableStyleElementDef {
            style_type,
            dxf_id: Some(dxf_id),
            size,
        });
    }
}

#[derive(Debug, Clone, Copy)]
struct StripeTargets {
    first: TableStyleType,
    second: TableStyleType,
}

fn direct_element_styles(
    style: &CustomTableStyleConfig,
) -> [(TableStyleType, &TableElementStyle); 5] {
    [
        (TableStyleType::WholeTable, &style.whole_table),
        (TableStyleType::HeaderRow, &style.header_row),
        (TableStyleType::TotalRow, &style.total_row),
        (TableStyleType::FirstColumn, &style.first_column),
        (TableStyleType::LastColumn, &style.last_column),
    ]
}

fn workbook_dxf_for_element(id: u32, style: &TableElementStyle) -> Option<WorkbookDxfDef> {
    let font_color = style.font_color.as_deref().and_then(color_def_from_hex);
    let font = if font_color.is_some() || style.font_bold.is_some() {
        Some(FontDef {
            color: font_color,
            bold: style.font_bold,
            ..Default::default()
        })
    } else {
        None
    };

    let fill_color = style.fill.as_deref().and_then(color_def_from_hex);
    let fill = fill_color.clone().map(|color| FillDef::Pattern {
        pattern_type: Some(PatternType::Solid),
        fg_color: Some(color.clone()),
        bg_color: Some(color),
    });

    let border = border_from_element_style(style);
    if font.is_none() && fill.is_none() && border.is_none() {
        return None;
    }

    Some(WorkbookDxfDef {
        id,
        owners: Vec::new(),
        font,
        fill,
        border,
        number_format: None,
        alignment: None,
        protection: None,
        extension_metadata: None,
    })
}

fn border_from_element_style(style: &TableElementStyle) -> Option<BorderDef> {
    let top = style.border_top.as_deref().and_then(border_side_from_hex);
    let bottom = style
        .border_bottom
        .as_deref()
        .and_then(border_side_from_hex);
    let left = style.border_left.as_deref().and_then(border_side_from_hex);
    let right = style.border_right.as_deref().and_then(border_side_from_hex);

    if top.is_none() && bottom.is_none() && left.is_none() && right.is_none() {
        return None;
    }

    Some(BorderDef {
        top,
        bottom,
        left,
        right,
        ..Default::default()
    })
}

fn border_side_from_hex(color: &str) -> Option<BorderSideDef> {
    Some(BorderSideDef {
        style: BorderStyle::Thin,
        color: Some(color_def_from_hex(color)?),
    })
}

fn color_def_from_hex(color: &str) -> Option<ColorDef> {
    Some(ColorDef::Rgb {
        val: argb_hex_from_color_string(color)?,
        tint: None,
    })
}

fn argb_hex_from_color_string(color: &str) -> Option<String> {
    let hex = color.trim().trim_start_matches('#');
    if !hex.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    match hex.len() {
        6 => Some(format!("FF{}", hex.to_ascii_uppercase())),
        8 => Some(hex.to_ascii_uppercase()),
        _ => None,
    }
}

struct TableStyleImporter<'a> {
    dxfs: &'a [WorkbookDxfDef],
    color_resolver: ColorResolver<'a>,
}

impl<'a> TableStyleImporter<'a> {
    fn new(dxfs: &'a [WorkbookDxfDef], theme_colors: &'a [String]) -> Self {
        Self {
            dxfs,
            color_resolver: ColorResolver { theme_colors },
        }
    }

    fn import(&self, style: &TableStyleDef) -> CustomTableStyleConfig {
        let mut config = empty_config_for_style(style);
        for element in &style.elements {
            self.apply_element(&mut config, element);
        }
        config
    }

    fn apply_element(&self, config: &mut CustomTableStyleConfig, element: &TableStyleElementDef) {
        let element_style = self.element_style(element.dxf_id);
        match element.style_type {
            TableStyleType::WholeTable => config.whole_table = element_style,
            TableStyleType::HeaderRow => config.header_row = element_style,
            TableStyleType::TotalRow => config.total_row = element_style,
            TableStyleType::FirstColumn => config.first_column = element_style,
            TableStyleType::LastColumn => config.last_column = element_style,
            TableStyleType::FirstRowStripe => {
                config.row_stripes.stripe_size = element.size.unwrap_or(1) as u8;
                config.row_stripes.stripe1_fill = element_style.fill;
            }
            TableStyleType::SecondRowStripe => {
                config.row_stripes.stripe_size = element.size.unwrap_or(1) as u8;
                config.row_stripes.stripe2_fill = element_style.fill;
            }
            TableStyleType::FirstColumnStripe => {
                config.column_stripes.stripe_size = element.size.unwrap_or(1) as u8;
                config.column_stripes.stripe1_fill = element_style.fill;
            }
            TableStyleType::SecondColumnStripe => {
                config.column_stripes.stripe_size = element.size.unwrap_or(1) as u8;
                config.column_stripes.stripe2_fill = element_style.fill;
            }
            _ => {}
        }
    }

    fn element_style(&self, dxf_id: Option<u32>) -> TableElementStyle {
        let Some(dxf_id) = dxf_id else {
            return TableElementStyle::default();
        };
        let Some(dxf) = self.dxfs.iter().find(|dxf| dxf.id == dxf_id) else {
            return TableElementStyle::default();
        };

        let border = dxf.border.as_ref();
        TableElementStyle {
            fill: self.fill_color(dxf.fill.as_ref()),
            font_color: dxf
                .font
                .as_ref()
                .and_then(|font| font.color.as_ref())
                .and_then(|color| self.color_resolver.resolve(color)),
            font_bold: dxf.font.as_ref().and_then(|font| font.bold),
            border_top: self.border_side_color(border.and_then(|border| border.top.as_ref())),
            border_bottom: self.border_side_color(border.and_then(|border| border.bottom.as_ref())),
            border_left: self.border_side_color(border.and_then(|border| border.left.as_ref())),
            border_right: self.border_side_color(border.and_then(|border| border.right.as_ref())),
        }
    }

    fn fill_color(&self, fill: Option<&FillDef>) -> Option<String> {
        match fill? {
            FillDef::Solid { fg_color } => self.color_resolver.resolve(fg_color),
            FillDef::Pattern {
                fg_color, bg_color, ..
            } => fg_color
                .as_ref()
                .and_then(|color| self.color_resolver.resolve(color))
                .or_else(|| {
                    bg_color
                        .as_ref()
                        .and_then(|color| self.color_resolver.resolve(color))
                }),
            _ => None,
        }
    }

    fn border_side_color(&self, side: Option<&BorderSideDef>) -> Option<String> {
        side.and_then(|side| {
            side.color
                .as_ref()
                .and_then(|color| self.color_resolver.resolve(color))
        })
    }
}

fn empty_config_for_style(style: &TableStyleDef) -> CustomTableStyleConfig {
    CustomTableStyleConfig {
        id: style.name.clone(),
        name: style.name.clone(),
        created_at: 0.0,
        updated_at: 0.0,
        header_row: TableElementStyle::default(),
        total_row: TableElementStyle::default(),
        first_column: TableElementStyle::default(),
        last_column: TableElementStyle::default(),
        row_stripes: StripePattern::default(),
        column_stripes: StripePattern::default(),
        whole_table: TableElementStyle::default(),
    }
}

struct ColorResolver<'a> {
    theme_colors: &'a [String],
}

impl ColorResolver<'_> {
    fn resolve(&self, color: &ColorDef) -> Option<String> {
        let base = match color {
            ColorDef::Theme { id, .. } => self.theme_color(*id),
            ColorDef::Rgb { val, .. } => rgb_hex_from_color_string(val),
            ColorDef::Indexed { .. } | ColorDef::Auto { .. } => color
                .to_argb()
                .as_deref()
                .and_then(rgb_hex_from_color_string),
        }?;

        match color.tint().and_then(|tint| tint.parse::<f64>().ok()) {
            Some(tint) => Some(apply_tint(&base, tint)),
            None => Some(base),
        }
    }

    fn theme_color(&self, id: u32) -> Option<String> {
        let palette_index = match id {
            0 => 1,
            1 => 0,
            2 => 3,
            3 => 2,
            4..=11 => id as usize,
            _ => return None,
        };
        self.theme_colors
            .get(palette_index)
            .and_then(|color| rgb_hex_from_color_string(color))
    }
}

fn rgb_hex_from_color_string(value: &str) -> Option<String> {
    let hex = value.trim().trim_start_matches('#');
    if !hex.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    let rgb = match hex.len() {
        6 => hex,
        8 => hex.get(2..)?,
        _ => return None,
    };
    Some(format!("#{}", rgb.to_ascii_uppercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_table_style_exports_all_public_regions_as_ooxml_dxfs() {
        let style = CustomTableStyleConfig {
            id: "style-1".to_string(),
            name: "MogBrandExportStyle".to_string(),
            created_at: 1.0,
            updated_at: 2.0,
            whole_table: TableElementStyle {
                font_color: Some("#111111".to_string()),
                ..Default::default()
            },
            header_row: TableElementStyle {
                fill: Some("#1F4E78".to_string()),
                font_color: Some("#FFFFFF".to_string()),
                font_bold: Some(true),
                border_bottom: Some("#17365D".to_string()),
                ..Default::default()
            },
            total_row: TableElementStyle {
                fill: Some("#D9EAF7".to_string()),
                font_bold: Some(true),
                ..Default::default()
            },
            first_column: TableElementStyle {
                font_bold: Some(true),
                ..Default::default()
            },
            last_column: TableElementStyle {
                fill: Some("#E2F0D9".to_string()),
                ..Default::default()
            },
            row_stripes: StripePattern {
                stripe_size: 2,
                stripe1_fill: Some("#FFFFFF".to_string()),
                stripe2_fill: Some("#EAF3F8".to_string()),
            },
            column_stripes: StripePattern {
                stripe_size: 3,
                stripe1_fill: Some("#FCE4D6".to_string()),
                stripe2_fill: Some("#F4CCCC".to_string()),
            },
        };

        let mut next_dxf_id = 4;
        let exported = style.to_ooxml_table_style(&mut next_dxf_id);

        assert_eq!(exported.style.name, "MogBrandExportStyle");
        assert_eq!(exported.style.count, Some(9));
        assert_eq!(exported.dxfs.len(), 9);
        assert_eq!(exported.dxfs.first().map(|dxf| dxf.id), Some(4));
        assert_eq!(exported.dxfs.last().map(|dxf| dxf.id), Some(12));
        assert_eq!(next_dxf_id, 13);
        assert!(exported.style.elements.iter().any(|element| {
            element.style_type == TableStyleType::HeaderRow && element.dxf_id.is_some()
        }));
        assert!(exported.style.elements.iter().any(|element| {
            element.style_type == TableStyleType::FirstRowStripe && element.size == Some(2)
        }));
        assert!(exported.style.elements.iter().any(|element| {
            element.style_type == TableStyleType::FirstColumnStripe && element.size == Some(3)
        }));
    }

    #[test]
    fn invalid_export_colors_are_omitted_not_substituted_with_black() {
        let style = CustomTableStyleConfig {
            id: "style-1".to_string(),
            name: "InvalidColorStyle".to_string(),
            created_at: 1.0,
            updated_at: 2.0,
            header_row: TableElementStyle {
                fill: Some("not-a-color".to_string()),
                font_color: Some("#12345Z".to_string()),
                font_bold: Some(true),
                border_bottom: Some("invalid".to_string()),
                ..Default::default()
            },
            total_row: TableElementStyle::default(),
            first_column: TableElementStyle::default(),
            last_column: TableElementStyle::default(),
            row_stripes: StripePattern::default(),
            column_stripes: StripePattern::default(),
            whole_table: TableElementStyle::default(),
        };

        let mut next_dxf_id = 0;
        let exported = style.to_ooxml_table_style(&mut next_dxf_id);

        assert_eq!(exported.dxfs.len(), 1);
        let dxf = &exported.dxfs[0];
        assert!(dxf.fill.is_none());
        assert!(dxf.border.is_none());
        assert_eq!(dxf.font.as_ref().and_then(|font| font.bold), Some(true));
        assert!(
            dxf.font
                .as_ref()
                .and_then(|font| font.color.as_ref())
                .is_none()
        );
    }

    #[test]
    fn ooxml_table_style_materializes_canonical_custom_style_config() {
        let style = TableStyleDef {
            name: "MogBrandExportStyle".to_string(),
            pivot: Some(false),
            table: Some(true),
            count: Some(3),
            elements: vec![
                TableStyleElementDef {
                    style_type: TableStyleType::HeaderRow,
                    dxf_id: Some(0),
                    size: None,
                },
                TableStyleElementDef {
                    style_type: TableStyleType::FirstRowStripe,
                    dxf_id: Some(1),
                    size: Some(2),
                },
                TableStyleElementDef {
                    style_type: TableStyleType::WholeTable,
                    dxf_id: Some(2),
                    size: None,
                },
            ],
            xr_uid: None,
        };
        let dxfs = vec![
            WorkbookDxfDef::from_ooxml(
                0,
                ooxml_types::styles::DxfDef {
                    font: Some(FontDef {
                        bold: Some(true),
                        color: Some(ColorDef::Rgb {
                            val: "FFFFFFFF".to_string(),
                            tint: None,
                        }),
                        ..Default::default()
                    }),
                    fill: Some(FillDef::Pattern {
                        pattern_type: Some(PatternType::Solid),
                        fg_color: Some(ColorDef::Rgb {
                            val: "FF1F4E78".to_string(),
                            tint: None,
                        }),
                        bg_color: None,
                    }),
                    border: Some(BorderDef {
                        bottom: Some(BorderSideDef {
                            style: BorderStyle::Thin,
                            color: Some(ColorDef::Rgb {
                                val: "FF17365D".to_string(),
                                tint: None,
                            }),
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
            WorkbookDxfDef::from_ooxml(
                1,
                ooxml_types::styles::DxfDef {
                    fill: Some(FillDef::Pattern {
                        pattern_type: Some(PatternType::Solid),
                        fg_color: Some(ColorDef::Rgb {
                            val: "FFEAF3F8".to_string(),
                            tint: None,
                        }),
                        bg_color: None,
                    }),
                    ..Default::default()
                },
            ),
            WorkbookDxfDef::from_ooxml(
                2,
                ooxml_types::styles::DxfDef {
                    font: Some(FontDef {
                        color: Some(ColorDef::Rgb {
                            val: "FF111111".to_string(),
                            tint: None,
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
        ];

        let config = CustomTableStyleConfig::from_ooxml_table_style(&style, &dxfs, &[]);

        assert_eq!(config.id, "MogBrandExportStyle");
        assert_eq!(config.header_row.fill.as_deref(), Some("#1F4E78"));
        assert_eq!(config.header_row.font_color.as_deref(), Some("#FFFFFF"));
        assert_eq!(config.header_row.font_bold, Some(true));
        assert_eq!(config.header_row.border_bottom.as_deref(), Some("#17365D"));
        assert_eq!(config.row_stripes.stripe_size, 2);
        assert_eq!(config.row_stripes.stripe1_fill.as_deref(), Some("#EAF3F8"));
        assert_eq!(config.whole_table.font_color.as_deref(), Some("#111111"));
    }

    #[test]
    fn ooxml_table_style_import_applies_color_tint() {
        let style = TableStyleDef {
            name: "TintedStyle".to_string(),
            table: Some(true),
            elements: vec![TableStyleElementDef {
                style_type: TableStyleType::HeaderRow,
                dxf_id: Some(0),
                size: None,
            }],
            ..Default::default()
        };
        let dxfs = vec![WorkbookDxfDef::from_ooxml(
            0,
            ooxml_types::styles::DxfDef {
                fill: Some(FillDef::Pattern {
                    pattern_type: Some(PatternType::Solid),
                    fg_color: Some(ColorDef::Theme {
                        id: 4,
                        tint: Some("0.5".to_string()),
                    }),
                    bg_color: None,
                }),
                ..Default::default()
            },
        )];
        let theme_colors = vec![
            "#000000".to_string(),
            "#FFFFFF".to_string(),
            "#EEECE1".to_string(),
            "#1F497D".to_string(),
            "#4472C4".to_string(),
        ];

        let config = CustomTableStyleConfig::from_ooxml_table_style(&style, &dxfs, &theme_colors);

        assert_eq!(
            config.header_row.fill.as_deref(),
            Some(apply_tint("#4472C4", 0.5).as_str())
        );
    }
}
