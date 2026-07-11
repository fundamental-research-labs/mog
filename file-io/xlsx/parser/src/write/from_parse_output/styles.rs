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
/// Each `DocumentFormat` in the palette becomes a cellXf entry. Palette entry
/// 0 is the workbook Normal style and is emitted as cellXfs[0], so cells with
/// no explicit `s` attribute still inherit imported workbook defaults.
///
/// The caller uses `style_id` values from `CellData` as indices into this
/// generated palette. Sheet writing uses the same indices in the emitted
/// `cellXfs` table.
pub(super) fn build_styles(palette: &[DocumentFormat]) -> StylesWriter {
    let mut writer = StylesWriter::with_defaults();

    let Some((normal_fmt, remaining_palette)) = palette.split_first() else {
        return writer;
    };

    let normal_components = add_style_components(&mut writer, normal_fmt);
    writer.cell_style_xfs[0] = cell_xf_from_components(normal_fmt, &normal_components, None, false);
    writer.cell_xfs[0] = cell_xf_from_components(normal_fmt, &normal_components, Some(0), true);

    for doc_fmt in remaining_palette {
        append_generated_cell_xf(&mut writer, doc_fmt);
    }

    writer
}

/// Append a live/generated cell XF without disturbing any imported style-table
/// indices already present in `writer`.
pub(super) fn append_generated_cell_xf(writer: &mut StylesWriter, doc_fmt: &DocumentFormat) -> u32 {
    let components = add_style_components(writer, doc_fmt);
    writer.add_cell_xf(cell_xf_from_components(doc_fmt, &components, Some(0), true))
}

#[derive(Clone)]
struct StyleComponentIds {
    font_id: u32,
    fill_id: u32,
    border_id: u32,
    num_fmt_id: u32,
    alignment: Option<AlignmentDef>,
    protection: Option<ProtectionDef>,
}

fn cell_xf_from_components(
    doc_fmt: &DocumentFormat,
    components: &StyleComponentIds,
    xf_id: Option<u32>,
    include_apply_flags: bool,
) -> CellXfDef {
    // Component IDs are table positions, not authored-intent flags. A live
    // format may intentionally apply the Normal font, explicit no-fill, or an
    // empty border and deduplicate to slot 0; its apply flag must still be set.
    let has_font = doc_fmt.font.is_some();
    let has_fill = doc_fmt.fill.is_some();
    let has_border = doc_fmt.border.is_some();
    let has_num_fmt = doc_fmt.number_format.is_some();
    let has_alignment = components.alignment.is_some();
    let has_protection = components.protection.is_some();

    CellXfDef {
        num_fmt_id: Some(components.num_fmt_id),
        font_id: Some(components.font_id),
        fill_id: Some(components.fill_id),
        border_id: Some(components.border_id),
        xf_id,
        alignment: components.alignment.clone(),
        protection: components.protection.clone(),
        apply_number_format: if include_apply_flags && has_num_fmt {
            Some(true)
        } else {
            None
        },
        apply_font: if include_apply_flags && has_font {
            Some(true)
        } else {
            None
        },
        apply_fill: if include_apply_flags && has_fill {
            Some(true)
        } else {
            None
        },
        apply_border: if include_apply_flags && has_border {
            Some(true)
        } else {
            None
        },
        apply_alignment: if include_apply_flags && has_alignment {
            Some(true)
        } else {
            None
        },
        apply_protection: if include_apply_flags && has_protection {
            Some(true)
        } else {
            None
        },
        pivot_button: doc_fmt.pivot_button.unwrap_or(false),
        quote_prefix: doc_fmt.quote_prefix.unwrap_or(false),
        ext_lst: None,
    }
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
            .map(|c| semantic_color_to_def(c, font.color_tint)),
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
                    color: semantic_color_to_def(&stop.color, None),
                })
                .collect(),
            left: gradient.center.as_ref().map(|c| c.left),
            right: None,
            top: gradient.center.as_ref().map(|c| c.top),
            bottom: None,
        };
    }

    let background_color = fill
        .background_color
        .as_deref()
        .map(|color| semantic_color_to_def(color, fill.background_color_tint));
    let pattern_foreground_color = fill
        .pattern_foreground_color
        .as_deref()
        .map(|color| semantic_color_to_def(color, fill.pattern_foreground_color_tint));

    let Some(pattern_token) = fill.pattern_type.as_deref() else {
        // `backgroundColor` is also the public shorthand for a solid cell
        // fill. Infer solid only when the caller did not provide an explicit
        // pattern token; malformed explicit tokens must not become solid.
        return match background_color {
            Some(fg_color) => FillDef::Solid { fg_color },
            None if pattern_foreground_color.is_some() => FillDef::Pattern {
                pattern_type: None,
                fg_color: pattern_foreground_color,
                bg_color: None,
            },
            None => FillDef::None,
        };
    };

    let Some(pattern_type) = PatternType::from_ooxml_token(pattern_token) else {
        tracing::warn!(
            token = %pattern_token,
            "unknown PatternType on FillFormat → FillDef conversion; omitting patternType"
        );
        return FillDef::Pattern {
            pattern_type: None,
            fg_color: pattern_foreground_color,
            bg_color: background_color,
        };
    };

    match pattern_type {
        // An explicit no-fill marker must win over any stale color fields.
        PatternType::None => FillDef::None,
        // DocumentFormat uses `backgroundColor` for a cell's visible solid
        // color. OOXML stores that same color in patternFill/fgColor.
        PatternType::Solid => match background_color {
            Some(fg_color) => FillDef::Solid { fg_color },
            None => FillDef::Pattern {
                pattern_type: Some(PatternType::Solid),
                fg_color: None,
                bg_color: None,
            },
        },
        // For real patterns the two domain color roles map directly to the
        // OOXML foreground/background children.
        pattern_type => FillDef::Pattern {
            pattern_type: Some(pattern_type),
            fg_color: pattern_foreground_color,
            bg_color: background_color,
        },
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
                .map(|color| semantic_color_to_def(color, s.color_tint));
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

/// Convert a semantic cell-format color to its OOXML representation.
///
/// In addition to RGB/ARGB strings, the cell-format domain carries symbolic
/// theme colors as `theme:<slot-or-index>[:tint]`. Keeping those symbolic on
/// export is what lets a workbook continue to follow its theme after a
/// save/reload cycle.
pub(super) fn hex_to_color_def(color: &str) -> ColorDef {
    semantic_color_to_def(color, None)
}

/// Lower one semantic color. A separate typed tint is authoritative when it
/// is present (including `0.0`, which explicitly removes an inline tint);
/// otherwise a tint embedded in the theme reference is used.
fn semantic_color_to_def(color: &str, explicit_tint: Option<f64>) -> ColorDef {
    if let Some((id, inline_tint)) = parse_theme_color_ref(color) {
        return ColorDef::Theme {
            id,
            tint: serialize_tint(explicit_tint.or(inline_tint)),
        };
    }

    let argb = if let Some(stripped) = color.strip_prefix('#') {
        format!("FF{}", stripped.to_uppercase())
    } else {
        color.to_uppercase()
    };
    ColorDef::Rgb {
        val: argb,
        tint: serialize_tint(explicit_tint),
    }
}

fn serialize_tint(tint: Option<f64>) -> Option<String> {
    tint.filter(|t| t.is_finite() && *t != 0.0)
        .map(|t| t.to_string())
}

/// Parse the public symbolic theme-color vocabulary into the numeric indices
/// used by `<color theme="…">` (§18.8.3). The first four indices deliberately
/// follow the OOXML color-reference order (light1, dark1, light2, dark2), not
/// the `<a:clrScheme>` child order.
fn parse_theme_color_ref(color: &str) -> Option<(u32, Option<f64>)> {
    let mut parts = color.strip_prefix("theme:")?.split(':');
    let theme = theme_slot_to_index(parts.next()?)?;
    let tint = match parts.next() {
        Some(raw) if !raw.is_empty() => {
            let tint = raw.parse::<f64>().ok()?;
            (tint.is_finite() && (-1.0..=1.0).contains(&tint)).then_some(tint)?
        }
        Some(_) => return None,
        None => return Some((theme, None)),
    };
    parts.next().is_none().then_some((theme, Some(tint)))
}

fn theme_slot_to_index(slot: &str) -> Option<u32> {
    if let Ok(index) = slot.parse::<u32>() {
        return (index <= 11).then_some(index);
    }

    match slot.to_ascii_lowercase().as_str() {
        "light1" | "lt1" => Some(0),
        "dark1" | "dk1" => Some(1),
        "light2" | "lt2" => Some(2),
        "dark2" | "dk2" => Some(3),
        "accent1" => Some(4),
        "accent2" => Some(5),
        "accent3" => Some(6),
        "accent4" => Some(7),
        "accent5" => Some(8),
        "accent6" => Some(9),
        "hyperlink" | "hlink" => Some(10),
        "followedhyperlink" | "folhlink" | "fol_hlink" => Some(11),
        _ => None,
    }
}
