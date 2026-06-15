//! Style conversion: DocumentFormat → StylesWriter.

use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, DocumentFormat, FillFormat, FontFormat, ParseOutput,
    ProtectionFormat,
};

use crate::domain::styles::types::{
    AlignmentDef, BorderDef, BorderSideDef, BorderStyle, CellXfDef, ColorDef, FillDef, FontDef,
    FontScheme, GradientStop, GradientType, HorizontalAlign, PatternType, ProtectionDef,
    UnderlineStyle, VerticalAlign, VerticalAlignRun,
};
use crate::domain::styles::write::StylesWriter;

/// Build a `StylesWriter` from the modeled `DocumentFormat` export palette.
///
/// Each `DocumentFormat` in the palette becomes a cellXf entry. The returned
/// writer's cellXfs[0] is always the default style (empty `DocumentFormat`);
/// cellXfs[N] for N >= 1 corresponds to `palette[N-1]`.
///
/// The caller uses `style_id` values from `CellData` as indices into this
/// generated palette. Sheet writing offsets those ids by +1 because
/// `cellXfs[0]` is the default.
pub(super) fn build_styles(palette: &[DocumentFormat]) -> StylesWriter {
    let mut writer = StylesWriter::with_defaults();

    // The default style is already at cellXfs[0] from with_defaults().
    // Now add one cellXf per palette entry.
    for doc_fmt in palette {
        let components = add_style_components(&mut writer, doc_fmt);

        let has_font = components.font_id != 0;
        let has_fill = components.fill_id != 0;
        let has_border = components.border_id != 0;
        let has_num_fmt = components.num_fmt_id != 0;
        let has_alignment = components.alignment.is_some();
        let has_protection = components.protection.is_some();

        let xf = CellXfDef {
            num_fmt_id: Some(components.num_fmt_id),
            font_id: Some(components.font_id),
            fill_id: Some(components.fill_id),
            border_id: Some(components.border_id),
            xf_id: Some(0),
            alignment: components.alignment,
            protection: components.protection,
            apply_number_format: if has_num_fmt { Some(true) } else { None },
            apply_font: if has_font { Some(true) } else { None },
            apply_fill: if has_fill { Some(true) } else { None },
            apply_border: if has_border { Some(true) } else { None },
            apply_alignment: if has_alignment { Some(true) } else { None },
            apply_protection: if has_protection { Some(true) } else { None },
            pivot_button: doc_fmt.pivot_button.unwrap_or(false),
            quote_prefix: doc_fmt.quote_prefix.unwrap_or(false),
            ext_lst: None,
        };

        writer.add_cell_xf(xf);
    }

    writer
}

struct StyleComponentIds {
    font_id: u32,
    fill_id: u32,
    border_id: u32,
    num_fmt_id: u32,
    alignment: Option<AlignmentDef>,
    protection: Option<ProtectionDef>,
}

fn add_style_components(writer: &mut StylesWriter, doc_fmt: &DocumentFormat) -> StyleComponentIds {
    let font_id = doc_fmt
        .font
        .as_ref()
        .map(|f| writer.add_font(convert_font(f)))
        .unwrap_or(0);

    let fill_id = doc_fmt
        .fill
        .as_ref()
        .map(|f| writer.add_fill(convert_fill(f)))
        .unwrap_or(0);

    let border_id = doc_fmt
        .border
        .as_ref()
        .map(|b| writer.add_border(convert_border(b)))
        .unwrap_or(0);

    let num_fmt_id = doc_fmt
        .number_format
        .as_ref()
        .map(|nf| writer.add_num_fmt(nf))
        .unwrap_or(0);

    StyleComponentIds {
        font_id,
        fill_id,
        border_id,
        num_fmt_id,
        alignment: doc_fmt.alignment.as_ref().map(convert_alignment),
        protection: doc_fmt.protection.as_ref().map(convert_protection),
    }
}

/// Whether the current modeled workbook references any style IDs.
///
/// If all style references disappeared, emitting the modeled palette would keep
/// stale style facts alive after deletion.
pub(super) fn output_references_style_ids(output: &ParseOutput) -> bool {
    output.sheets.iter().any(|sheet| {
        sheet.cells.iter().any(|cell| cell.style_id.is_some())
            || !sheet.authored_style_runs.is_empty()
            || !sheet.row_styles.is_empty()
            || !sheet.col_styles.is_empty()
            || !sheet.col_style_ranges.is_empty()
            || sheet
                .dimensions
                .trailing_col_ranges
                .iter()
                .any(|range| range.style_id.is_some())
            || sheet_uses_dxf_or_table_style(sheet)
    })
}

fn sheet_uses_dxf_or_table_style(sheet: &domain_types::SheetData) -> bool {
    sheet
        .conditional_formats
        .iter()
        .any(conditional_format_uses_dxf)
        || sheet.auto_filter.as_ref().is_some_and(auto_filter_uses_dxf)
        || sheet.sort_state.as_ref().is_some_and(sort_state_uses_dxf)
        || sheet.tables.iter().any(table_uses_dxf_or_table_style)
}

fn conditional_format_uses_dxf(cf: &domain_types::ConditionalFormat) -> bool {
    cf.rules
        .iter()
        .filter_map(conditional_format_rule_style)
        .any(|style| style.dxf_id.is_some())
}

fn conditional_format_rule_style(rule: &domain_types::CFRule) -> Option<&domain_types::CFStyle> {
    match rule {
        domain_types::CFRule::CellValue { style, .. }
        | domain_types::CFRule::Formula { style, .. }
        | domain_types::CFRule::Top10 { style, .. }
        | domain_types::CFRule::AboveAverage { style, .. }
        | domain_types::CFRule::DuplicateValues { style, .. }
        | domain_types::CFRule::ContainsText { style, .. }
        | domain_types::CFRule::ContainsBlanks { style, .. }
        | domain_types::CFRule::ContainsErrors { style, .. }
        | domain_types::CFRule::TimePeriod { style, .. } => Some(style),
        domain_types::CFRule::ColorScale { .. }
        | domain_types::CFRule::DataBar { .. }
        | domain_types::CFRule::IconSet { .. } => None,
    }
}

fn auto_filter_uses_dxf(auto_filter: &domain_types::AutoFilter) -> bool {
    auto_filter.columns.iter().any(filter_column_uses_dxf)
        || auto_filter.sort.as_ref().is_some_and(sort_state_uses_dxf)
}

fn filter_column_uses_dxf(column: &domain_types::FilterColumn) -> bool {
    matches!(
        column.filter_type,
        Some(domain_types::OoxmlFilterType::Color {
            dxf_id: Some(_),
            ..
        })
    )
}

fn sort_state_uses_dxf(sort_state: &domain_types::SortState) -> bool {
    sort_state
        .conditions
        .iter()
        .any(|condition| condition.dxf_id.is_some())
}

fn table_uses_dxf_or_table_style(table: &domain_types::TableSpec) -> bool {
    table.style_name.is_some()
        || table.header_row_dxf_id.is_some()
        || table.data_dxf_id.is_some()
        || table.totals_row_dxf_id.is_some()
        || table.header_row_border_dxf_id.is_some()
        || table.table_border_dxf_id.is_some()
        || table.totals_row_border_dxf_id.is_some()
        || table.header_row_cell_style.is_some()
        || table.data_cell_style.is_some()
        || table.totals_row_cell_style.is_some()
        || table.columns.iter().any(|column| {
            column.header_row_dxf_id.is_some()
                || column.data_dxf_id.is_some()
                || column.totals_row_dxf_id.is_some()
                || column.header_row_cell_style.is_some()
                || column.data_cell_style.is_some()
                || column.totals_row_cell_style.is_some()
        })
        || table.filter_columns.iter().any(|column| {
            matches!(
                column.filter,
                domain_types::FilterSpec::Color {
                    dxf_id: Some(_),
                    ..
                }
            )
        })
}

/// Convert a `FontFormat` to a `FontDef`.
fn convert_font(font: &FontFormat) -> FontDef {
    FontDef {
        name: font.name.clone(),
        // DocumentFormat stores size in millipoints (11pt = 11_000); FontDef uses points.
        size: font.size.map(|mp| mp as f64 / 1000.0),
        bold: font.bold,
        italic: font.italic,
        underline: font.underline.as_deref().map(convert_underline),
        strikethrough: font.strikethrough,
        color: font
            .color
            .as_deref()
            .map(|c| hex_to_color_def_with_tint(c, font.color_tint)),
        family: font.family,
        charset: font.charset,
        scheme: font.scheme.as_deref().map(|s| match s {
            "major" => FontScheme::Major,
            "minor" => FontScheme::Minor,
            _ => FontScheme::None,
        }),
        condense: font.condense,
        extend: font.extend,
        outline: font.outline,
        shadow: font.shadow,
        vert_align: font
            .vertical_align
            .as_deref()
            .and_then(|s| match s {
                "baseline" => Some(VerticalAlignRun::Baseline),
                "superscript" => Some(VerticalAlignRun::Superscript),
                "subscript" => Some(VerticalAlignRun::Subscript),
                _ => None,
            })
            .or_else(|| {
                font.superscript
                    .and_then(|v| v.then_some(VerticalAlignRun::Superscript))
                    .or_else(|| {
                        font.subscript
                            .and_then(|v| v.then_some(VerticalAlignRun::Subscript))
                    })
            }),
    }
}

/// Convert a `FillFormat` to a `FillDef`.
fn convert_fill(fill: &FillFormat) -> FillDef {
    let pattern_type = fill
        .pattern_type
        .as_deref()
        .map(|s| match s {
            "solid" => PatternType::Solid,
            "gray125" => PatternType::Gray125,
            "darkGray" => PatternType::DarkGray,
            "mediumGray" => PatternType::MediumGray,
            "lightGray" => PatternType::LightGray,
            "gray0625" => PatternType::Gray0625,
            "darkHorizontal" => PatternType::DarkHorizontal,
            "darkVertical" => PatternType::DarkVertical,
            "darkDown" => PatternType::DarkDown,
            "darkUp" => PatternType::DarkUp,
            "darkGrid" => PatternType::DarkGrid,
            "darkTrellis" => PatternType::DarkTrellis,
            "lightHorizontal" => PatternType::LightHorizontal,
            "lightVertical" => PatternType::LightVertical,
            "lightDown" => PatternType::LightDown,
            "lightUp" => PatternType::LightUp,
            "lightGrid" => PatternType::LightGrid,
            "lightTrellis" => PatternType::LightTrellis,
            _ => PatternType::Solid,
        })
        .unwrap_or(PatternType::Solid);

    let fg_color = if let Some(ref pfg) = fill.pattern_foreground_color {
        Some(hex_to_color_def_with_tint(
            pfg,
            fill.pattern_foreground_color_tint,
        ))
    } else {
        fill.background_color
            .as_ref()
            .map(|bg| hex_to_color_def_with_tint(bg, fill.background_color_tint))
    };
    let bg_color = fill
        .background_color
        .as_deref()
        .map(|c| hex_to_color_def_with_tint(c, fill.background_color_tint));

    if let Some(gradient) = &fill.gradient_fill {
        return FillDef::Gradient {
            gradient_type: match gradient.gradient_type.as_str() {
                "path" => GradientType::Path,
                _ => GradientType::Linear,
            },
            degree: gradient.degree,
            stops: gradient
                .stops
                .iter()
                .map(|stop| GradientStop {
                    position: stop.position,
                    color: hex_to_color_def(&stop.color),
                })
                .collect(),
            left: gradient.center.as_ref().map(|c| c.left),
            right: None,
            top: gradient.center.as_ref().map(|c| c.top),
            bottom: None,
        };
    }

    FillDef::Pattern {
        pattern_type: Some(pattern_type),
        fg_color,
        bg_color,
    }
}

/// Convert a `BorderFormat` to a `BorderDef`.
fn convert_border(border: &BorderFormat) -> BorderDef {
    let convert_side = |side: &Option<BorderSide>| -> Option<BorderSideDef> {
        side.as_ref().map(|s| {
            let style = BorderStyle::from_ooxml_token(&s.style).unwrap_or_else(|| {
                tracing::warn!(token = %s.style, "unknown BorderStyle on BorderSide → BorderSideDef conversion; using None");
                BorderStyle::None
            });
            let color = s
                .color
                .as_deref()
                .map(|color| hex_to_color_def_with_tint(color, s.color_tint));
            BorderSideDef { style, color }
        })
    };

    // Pass diagonalUp/diagonalDown flags through verbatim — `None` stays absent
    // on the OOXML element, `Some(bool)` emits the explicit attribute value.
    BorderDef {
        left: convert_side(&border.left),
        right: convert_side(&border.right),
        top: convert_side(&border.top),
        bottom: convert_side(&border.bottom),
        diagonal: convert_side(&border.diagonal),
        diagonal_up: border.diagonal_up,
        diagonal_down: border.diagonal_down,
        start: None,
        end: None,
        vertical: None,
        horizontal: None,
        outline: None,
    }
}

/// Convert an `AlignmentFormat` to an `AlignmentDef`.
fn convert_alignment(alignment: &AlignmentFormat) -> AlignmentDef {
    // Map the AlignmentFormat reading-order token ("context" / "ltr" / "rtl" /
    // internal "middle" — ignored here) back to the ECMA-376 integer encoding.
    let reading_order = alignment.reading_order.as_deref().and_then(|s| match s {
        "context" => Some(0u32),
        "ltr" => Some(1),
        "rtl" => Some(2),
        _ => None,
    });

    AlignmentDef {
        horizontal: alignment.horizontal.as_deref().and_then(|s| match s {
            "left" => Some(HorizontalAlign::Left),
            "center" => Some(HorizontalAlign::Center),
            "right" => Some(HorizontalAlign::Right),
            "fill" => Some(HorizontalAlign::Fill),
            "justify" => Some(HorizontalAlign::Justify),
            "centerContinuous" => Some(HorizontalAlign::CenterContinuous),
            "distributed" => Some(HorizontalAlign::Distributed),
            "general" => Some(HorizontalAlign::General),
            _ => None,
        }),
        vertical: alignment.vertical.as_deref().and_then(|s| match s {
            "top" => Some(VerticalAlign::Top),
            "middle" => Some(VerticalAlign::Center),
            "bottom" => Some(VerticalAlign::Bottom),
            "justify" => Some(VerticalAlign::Justify),
            "distributed" => Some(VerticalAlign::Distributed),
            _ => None,
        }),
        wrap_text: alignment.wrap_text,
        // `rotation = 255` (stacked/vertical text, ECMA-376 §18.8.1) fits
        // cleanly in u32 and is passed through. Callers constructing negative
        // rotation values from UI input are expected to normalize to 0-180
        // before reaching this path.
        text_rotation: alignment.rotation.map(|r| r as u32),
        indent: alignment.indent,
        shrink_to_fit: alignment.shrink_to_fit,
        reading_order,
        relative_indent: alignment.relative_indent,
        justify_last_line: alignment.justify_last_line,
        auto_indent: alignment.auto_indent,
    }
}

/// Convert a `ProtectionFormat` to a `ProtectionDef`.
fn convert_protection(protection: &ProtectionFormat) -> ProtectionDef {
    ProtectionDef {
        locked: protection.locked,
        hidden: protection.hidden,
    }
}

/// Convert an underline string to `UnderlineStyle`.
fn convert_underline(s: &str) -> UnderlineStyle {
    match s {
        "single" => UnderlineStyle::Single,
        "double" => UnderlineStyle::Double,
        "singleAccounting" => UnderlineStyle::SingleAccounting,
        "doubleAccounting" => UnderlineStyle::DoubleAccounting,
        _ => UnderlineStyle::None,
    }
}

/// Convert a "#RRGGBB" hex string to a `ColorDef`.
///
/// If the string starts with '#', strips it and prepends "FF" for full alpha.
/// Otherwise passes it through as-is (assumes "AARRGGBB" format).
pub(super) fn hex_to_color_def(hex: &str) -> ColorDef {
    hex_to_color_def_with_tint(hex, None)
}

/// Convert a "#RRGGBB" hex string to a `ColorDef`, optionally attaching a tint.
fn hex_to_color_def_with_tint(hex: &str, tint: Option<f64>) -> ColorDef {
    let argb = if let Some(stripped) = hex.strip_prefix('#') {
        format!("FF{}", stripped.to_uppercase())
    } else {
        hex.to_uppercase()
    };
    let tint_str = tint.filter(|&t| t != 0.0).map(|t| t.to_string());
    ColorDef::Rgb {
        val: argb,
        tint: tint_str,
    }
}
