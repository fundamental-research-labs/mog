use crate::cf::types::CfRenderStyle;
use domain_types::domain::conditional_format as cf;

/// Convert domain CFStyle (string colors, bool underline) to compute-cf CfRenderStyle
/// (Color values, CFUnderlineType).
pub(super) fn convert_style(style: &cf::CFStyle) -> CfRenderStyle {
    use crate::cf::types::{CFBorderStyle, CFUnderlineType};
    use value_types::Color;

    use ooxml_types::styles::{BorderStyle as OoxmlBorderStyle, UnderlineStyle};

    // Resolve underline: prefer typed underline_type; fall back to legacy bool.
    let underline_type = if let Some(ut) = style.underline_type {
        Some(match ut {
            UnderlineStyle::Single => CFUnderlineType::Single,
            UnderlineStyle::Double => CFUnderlineType::Double,
            UnderlineStyle::SingleAccounting => CFUnderlineType::SingleAccounting,
            UnderlineStyle::DoubleAccounting => CFUnderlineType::DoubleAccounting,
            UnderlineStyle::None => CFUnderlineType::None,
        })
    } else {
        style.underline_legacy.map(|u| {
            if u {
                CFUnderlineType::Single
            } else {
                CFUnderlineType::None
            }
        })
    };

    // Domain BorderStyle -> compute-cf CFBorderStyle. The typed border_style
    // comes from domain-types as an ooxml enum; map exhaustively here.
    fn map_border_style(s: OoxmlBorderStyle) -> CFBorderStyle {
        match s {
            OoxmlBorderStyle::None => CFBorderStyle::None,
            OoxmlBorderStyle::Thin => CFBorderStyle::Thin,
            OoxmlBorderStyle::Medium => CFBorderStyle::Medium,
            OoxmlBorderStyle::Thick => CFBorderStyle::Thick,
            OoxmlBorderStyle::Dashed => CFBorderStyle::Dashed,
            OoxmlBorderStyle::Dotted => CFBorderStyle::Dotted,
            OoxmlBorderStyle::Double => CFBorderStyle::Double,
            OoxmlBorderStyle::Hair => CFBorderStyle::Hair,
            OoxmlBorderStyle::MediumDashed => CFBorderStyle::MediumDashed,
            OoxmlBorderStyle::DashDot => CFBorderStyle::DashDot,
            OoxmlBorderStyle::MediumDashDot => CFBorderStyle::MediumDashDot,
            OoxmlBorderStyle::DashDotDot => CFBorderStyle::DashDotDot,
            OoxmlBorderStyle::MediumDashDotDot => CFBorderStyle::MediumDashDotDot,
            OoxmlBorderStyle::SlantDashDot => CFBorderStyle::SlantDashDot,
        }
    }

    // Per-side border styles on CFStyle are still Option<String> (they belong
    // to the W-cond-format scope of round-D, not W-styles). Keep the string
    // matcher for those fields.
    fn parse_border_style(s: &str) -> CFBorderStyle {
        match s {
            "none" => CFBorderStyle::None,
            "thin" => CFBorderStyle::Thin,
            "medium" => CFBorderStyle::Medium,
            "thick" => CFBorderStyle::Thick,
            "dashed" => CFBorderStyle::Dashed,
            "dotted" => CFBorderStyle::Dotted,
            "double" => CFBorderStyle::Double,
            "hair" => CFBorderStyle::Hair,
            "mediumDashed" => CFBorderStyle::MediumDashed,
            "dashDot" => CFBorderStyle::DashDot,
            "mediumDashDot" => CFBorderStyle::MediumDashDot,
            "dashDotDot" => CFBorderStyle::DashDotDot,
            "mediumDashDotDot" => CFBorderStyle::MediumDashDotDot,
            "slantDashDot" => CFBorderStyle::SlantDashDot,
            _ => CFBorderStyle::Thin,
        }
    }

    CfRenderStyle {
        background_color: style
            .background_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        font_color: style
            .font_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        bold: style.bold,
        italic: style.italic,
        underline_type,
        strikethrough: style.strikethrough,
        border_color: style
            .border_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        // Unified border_style is the typed enum; per-side border styles are
        // still strings (W-cond-format scope).
        border_style: style.border_style.map(map_border_style),
        border_top_color: style
            .border_top_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        border_top_style: style.border_top_style.as_deref().map(parse_border_style),
        border_bottom_color: style
            .border_bottom_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        border_bottom_style: style.border_bottom_style.as_deref().map(parse_border_style),
        border_left_color: style
            .border_left_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        border_left_style: style.border_left_style.as_deref().map(parse_border_style),
        border_right_color: style
            .border_right_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        border_right_style: style.border_right_style.as_deref().map(parse_border_style),
        number_format: style.number_format.clone(),
    }
}
