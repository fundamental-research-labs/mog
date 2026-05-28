//! Differential format reconstruction for modeled conditional formats.

use domain_types::{CFRule, CFStyle, ParseOutput};

use crate::domain::styles::types::{
    BorderDef, BorderSideDef, BorderStyle, ColorDef, DxfDef, FillDef, FontDef, NumberFormatDef,
    PatternType, UnderlineStyle,
};

use super::styles::hex_to_color_def;

pub(super) fn collect(output: &ParseOutput) -> Vec<DxfDef> {
    let max_dxf_id = output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.conditional_formats.iter())
        .flat_map(|cf| cf.rules.iter())
        .filter_map(rule_style)
        .filter_map(|style| style.dxf_id)
        .max();

    let Some(max_dxf_id) = max_dxf_id else {
        return Vec::new();
    };

    let mut dxfs = vec![DxfDef::default(); max_dxf_id as usize + 1];
    let mut populated = vec![false; max_dxf_id as usize + 1];

    for style in output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.conditional_formats.iter())
        .flat_map(|cf| cf.rules.iter())
        .filter_map(rule_style)
    {
        let Some(dxf_id) = style.dxf_id else {
            continue;
        };
        let idx = dxf_id as usize;
        if populated[idx] {
            continue;
        }
        dxfs[idx] = cf_style_to_dxf(style);
        populated[idx] = true;
    }

    dxfs
}

fn rule_style(rule: &CFRule) -> Option<&CFStyle> {
    match rule {
        CFRule::CellValue { style, .. }
        | CFRule::Formula { style, .. }
        | CFRule::Top10 { style, .. }
        | CFRule::AboveAverage { style, .. }
        | CFRule::DuplicateValues { style, .. }
        | CFRule::ContainsText { style, .. }
        | CFRule::ContainsBlanks { style, .. }
        | CFRule::ContainsErrors { style, .. }
        | CFRule::TimePeriod { style, .. } => Some(style),
        CFRule::ColorScale { .. } | CFRule::DataBar { .. } | CFRule::IconSet { .. } => None,
    }
}

fn cf_style_to_dxf(style: &CFStyle) -> DxfDef {
    DxfDef {
        font: font(style),
        num_fmt: style
            .number_format
            .as_ref()
            .map(|format_code| NumberFormatDef {
                id: 0,
                format_code: format_code.clone(),
            }),
        fill: style
            .background_color
            .as_ref()
            .map(|color| FillDef::Pattern {
                pattern_type: Some(PatternType::Solid),
                fg_color: Some(hex_to_color_def(color)),
                bg_color: Some(hex_to_color_def(color)),
            }),
        border: border(style),
        alignment: None,
        protection: None,
        ..Default::default()
    }
}

fn font(style: &CFStyle) -> Option<FontDef> {
    if style.font_color.is_none()
        && style.bold.is_none()
        && style.italic.is_none()
        && style.underline_type.is_none()
        && style.underline_legacy.is_none()
        && style.strikethrough.is_none()
    {
        return None;
    }

    Some(FontDef {
        color: style.font_color.as_deref().map(hex_to_color_def),
        bold: style.bold,
        italic: style.italic,
        underline: style.underline_type.or_else(|| {
            style
                .underline_legacy
                .and_then(|v| v.then_some(UnderlineStyle::Single))
        }),
        strikethrough: style.strikethrough,
        ..Default::default()
    })
}

fn border(style: &CFStyle) -> Option<BorderDef> {
    let unified_style = style
        .border_style
        .or_else(|| style.border_color.as_ref().map(|_| BorderStyle::Thin));
    let unified_color = style.border_color.as_deref().map(hex_to_color_def);

    let left = border_side(
        style.border_left_style.as_deref(),
        style.border_left_color.as_deref(),
        unified_style,
        unified_color.as_ref(),
    );
    let right = border_side(
        style.border_right_style.as_deref(),
        style.border_right_color.as_deref(),
        unified_style,
        unified_color.as_ref(),
    );
    let top = border_side(
        style.border_top_style.as_deref(),
        style.border_top_color.as_deref(),
        unified_style,
        unified_color.as_ref(),
    );
    let bottom = border_side(
        style.border_bottom_style.as_deref(),
        style.border_bottom_color.as_deref(),
        unified_style,
        unified_color.as_ref(),
    );

    if left.is_none() && right.is_none() && top.is_none() && bottom.is_none() {
        return None;
    }

    Some(BorderDef {
        left,
        right,
        top,
        bottom,
        ..Default::default()
    })
}

fn border_side(
    side_style: Option<&str>,
    side_color: Option<&str>,
    unified_style: Option<BorderStyle>,
    unified_color: Option<&ColorDef>,
) -> Option<BorderSideDef> {
    let style = side_style
        .and_then(BorderStyle::from_ooxml_token)
        .or(unified_style);
    let color = side_color
        .map(hex_to_color_def)
        .or_else(|| unified_color.cloned());

    if style.is_none() && color.is_none() {
        return None;
    }

    Some(BorderSideDef {
        style: style.unwrap_or(BorderStyle::Thin),
        color,
    })
}
