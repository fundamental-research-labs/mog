//! Style conversion: DocumentFormat / Stylesheet → StylesWriter.

use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, DocumentFormat, FillFormat, FontFormat,
    ProtectionFormat,
};

use crate::domain::styles::write::{
    AlignmentDef, BorderDef, BorderSideDef, BorderStyle, CellXfDef, ColorDef, FillDef, FontDef,
    FontScheme, HorizontalAlign, PatternType, ProtectionDef, StylesWriter, UnderlineStyle,
    VerticalAlign,
};

/// Build a `StylesWriter` from a palette of `DocumentFormat` entries.
///
/// Build a `StylesWriter` directly from a parsed OOXML `Stylesheet`.
///
/// This is the **lossless** path: every style component (fonts, fills, borders,
/// cellXfs, cellStyleXfs, cellStyles, dxfs, numFmts, colors, tableStyles) is
/// transferred directly — no theme color resolution, no flattening, no
/// information loss. The types are identical (`ooxml_types::styles::*`).
///
/// Used when `RoundTripContext.parsed_stylesheet` is available (i.e., the file
/// was parsed from an XLSX and we have the original style hierarchy).
pub(super) fn build_styles_from_stylesheet(
    stylesheet: &ooxml_types::styles::Stylesheet,
    ext_lst_raw: Option<&[u8]>,
    namespace_attrs: &[(String, String)],
) -> StylesWriter {
    let mut writer = StylesWriter::new();

    // Transfer all style components directly — same ooxml_types, zero conversion.
    writer.num_fmts = stylesheet.num_fmts.clone();
    writer.fonts = stylesheet.fonts.clone();
    writer.fills = stylesheet.fills.clone();
    writer.borders = stylesheet.borders.clone();
    writer.cell_xfs = stylesheet.cell_xfs.clone();
    writer.cell_style_xfs = stylesheet.cell_style_xfs.clone();
    writer.cell_styles = stylesheet.cell_styles.clone();
    writer.dxfs = stylesheet.dxfs.clone();
    writer.colors = stylesheet.colors.clone();
    writer.table_styles = stylesheet.table_styles.clone();
    writer.default_table_style = stylesheet.default_table_style.clone();
    writer.default_pivot_style = stylesheet.default_pivot_style.clone();
    writer.known_fonts = stylesheet.known_fonts;
    writer.ext_lst_raw = ext_lst_raw.map(|b| b.to_vec());

    // Reconstruct namespace map from preserved (prefix, uri) pairs.
    if !namespace_attrs.is_empty() {
        use crate::roundtrip::namespaces::NamespaceMap;
        let mut ns_map = NamespaceMap::new();
        for (prefix, uri) in namespace_attrs {
            if prefix.is_empty() {
                ns_map.set_default(uri);
            } else {
                ns_map.add_prefixed(prefix, uri);
            }
        }
        writer.preserved_namespaces = Some(ns_map);
    }

    writer
}

/// Build a `StylesWriter` from a flat `DocumentFormat` palette (lossy fallback).
///
/// Each `DocumentFormat` in the palette becomes a cellXf entry. The returned
/// writer's cellXfs[0] is always the default style (empty `DocumentFormat`);
/// cellXfs[N] for N >= 1 corresponds to `palette[N-1]`.
///
/// The caller can use `style_id` values from `CellData` directly as indices
/// into the palette — they get offset by +1 when building `CellData` for the
/// writer (because cellXfs[0] is the default).
pub(super) fn build_styles(palette: &[DocumentFormat]) -> StylesWriter {
    let mut writer = StylesWriter::with_defaults();

    // The default style is already at cellXfs[0] from with_defaults().
    // Now add one cellXf per palette entry.
    for doc_fmt in palette {
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

        let alignment = doc_fmt.alignment.as_ref().map(convert_alignment);
        let protection = doc_fmt.protection.as_ref().map(convert_protection);

        let has_font = font_id != 0;
        let has_fill = fill_id != 0;
        let has_border = border_id != 0;
        let has_num_fmt = num_fmt_id != 0;
        let has_alignment = alignment.is_some();
        let has_protection = protection.is_some();

        let xf = CellXfDef {
            num_fmt_id: Some(num_fmt_id),
            font_id: Some(font_id),
            fill_id: Some(fill_id),
            border_id: Some(border_id),
            xf_id: Some(0),
            alignment,
            protection,
            apply_number_format: if has_num_fmt { Some(true) } else { None },
            apply_font: if has_font { Some(true) } else { None },
            apply_fill: if has_fill { Some(true) } else { None },
            apply_border: if has_border { Some(true) } else { None },
            apply_alignment: if has_alignment { Some(true) } else { None },
            apply_protection: if has_protection { Some(true) } else { None },
            pivot_button: false,
            quote_prefix: false,
            ext_lst: None,
        };

        writer.add_cell_xf(xf);
    }

    writer
}

/// Append `DocumentFormat` palette entries to a lossless `StylesWriter`.
///
/// When format mutations occur on XLSX-imported cells, the export clears
/// their `xlsxStyleId` and adds the new format to `style_palette`. This
/// function converts those palette entries and appends them as new cellXf
/// entries after the original stylesheet entries, so cells referencing
/// `original_cellxfs_count + palette_idx` resolve correctly.
pub(super) fn append_palette_to_lossless_styles(
    writer: &mut StylesWriter,
    palette: &[DocumentFormat],
) {
    for doc_fmt in palette {
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

        let alignment = doc_fmt.alignment.as_ref().map(convert_alignment);
        let protection = doc_fmt.protection.as_ref().map(convert_protection);

        let has_font = font_id != 0;
        let has_fill = fill_id != 0;
        let has_border = border_id != 0;
        let has_num_fmt = num_fmt_id != 0;
        let has_alignment = alignment.is_some();
        let has_protection = protection.is_some();

        let xf = CellXfDef {
            num_fmt_id: Some(num_fmt_id),
            font_id: Some(font_id),
            fill_id: Some(fill_id),
            border_id: Some(border_id),
            xf_id: Some(0),
            alignment,
            protection,
            apply_number_format: if has_num_fmt { Some(true) } else { None },
            apply_font: if has_font { Some(true) } else { None },
            apply_fill: if has_fill { Some(true) } else { None },
            apply_border: if has_border { Some(true) } else { None },
            apply_alignment: if has_alignment { Some(true) } else { None },
            apply_protection: if has_protection { Some(true) } else { None },
            pivot_button: false,
            quote_prefix: false,
            ext_lst: None,
        };

        writer.add_cell_xf(xf);
    }
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
        condense: None,
        extend: None,
        outline: None,
        shadow: None,
        vert_align: None,
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
            let color = s.color.as_deref().map(hex_to_color_def);
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
