use std::collections::HashMap;

use crate::cf::types::{CFColorPointWire, CFColorScaleWire, CFValueType, CfValue};
use domain_types::domain::conditional_format as cf;

/// Resolve the authored OOXML color metadata on a CF point to the concrete
/// color required by compute-cf.
///
/// The domain point intentionally retains theme/indexed/tint metadata for
/// round-trip fidelity. compute-cf intentionally does not: evaluation and
/// interpolation operate on concrete colors. This is the single boundary
/// between those two contracts.
pub(super) fn resolve_color_point_color(
    pt: &cf::CFColorPoint,
    theme_palette: &HashMap<String, String>,
) -> Option<String> {
    resolve_cf_color(
        &cf::CFColor {
            rgb: Some(pt.color.clone()),
            theme: pt.color_theme,
            tint: pt.color_tint,
            indexed: pt.color_indexed,
            auto: pt.color_auto == Some(true),
        },
        theme_palette,
    )
}

pub(super) fn resolve_cf_color(
    color: &cf::CFColor,
    theme_palette: &HashMap<String, String>,
) -> Option<String> {
    // OOXML color attributes are mutually exclusive, but malformed producers
    // occasionally emit more than one. Use the established color-scale
    // precedence (theme > indexed > auto > RGB) before handing the selected
    // representation to the centralized style color resolver.
    let has_authored_metadata = color.theme.is_some() || color.indexed.is_some() || color.auto;
    let color_input = domain_types::style_resolver::ColorInput {
        rgb: color
            .rgb
            .as_ref()
            .filter(|rgb| !has_authored_metadata && !rgb.trim().is_empty())
            .cloned(),
        theme: color.theme,
        // Apply tint once, after every color kind has become concrete. Static
        // style resolution keeps some tints parallel, while compute-cf cannot.
        tint: None,
        indexed: color.indexed,
        auto: color.auto,
    };

    // An empty theme vec deliberately asks the resolver for its canonical
    // `theme:<slot>` form. The workbook map resolver then handles semantic and
    // OOXML palette aliases uniformly.
    let authored = domain_types::style_resolver::resolve_color(&color_input, &[])?;
    let from_workbook = domain_types::theme_color::resolve_theme_color(&authored, theme_palette);
    let concrete = if from_workbook.starts_with("theme:") {
        // OOXML packages may omit theme1.xml. Excel uses the Office theme in
        // that case; doing the same keeps a theme-only CF rule evaluable rather
        // than silently dropping the whole rule as an invalid empty color.
        let defaults = ooxml_types::themes::ColorScheme::office_default();
        let default_colors: Vec<String> = (0..12)
            .map(|index| {
                defaults
                    .resolve_hex(index)
                    .map(|hex| format!("#{hex}"))
                    .expect("the Office theme defines every standard color slot")
            })
            .collect();
        domain_types::style_resolver::resolve_color(&color_input, &default_colors)?
    } else {
        from_workbook
    };

    match color.tint {
        Some(tint) if tint != 0.0 => Some(domain_types::theme_color::apply_tint(&concrete, tint)),
        _ => Some(concrete),
    }
}

pub(super) fn convert_color_point_to_wire(
    pt: &cf::CFColorPoint,
    theme_palette: &HashMap<String, String>,
) -> CFColorPointWire {
    // Typed OOXML preservation: collapsed `value_type: CfvoType` + `value: Option<Value>`
    // into a single typed `CFValueRef` enum. Lower each variant to the
    // compute-cf wire pair. The two Excel-2010+ extension variants
    // (`AutoMin`/`AutoMax`) don't have wire equivalents; fall back to
    // their natural base value (Min/Max) with a warn so the drift is
    // visible.
    let (value_type, value) = match &pt.value {
        cf::CFValueRef::Number { value } => {
            (CFValueType::Number, Some(CfValue::Number { value: *value }))
        }
        cf::CFValueRef::Percent { value } => (
            CFValueType::Percent,
            Some(CfValue::Number { value: *value }),
        ),
        cf::CFValueRef::Percentile { value } => (
            CFValueType::Percentile,
            Some(CfValue::Number { value: *value }),
        ),
        cf::CFValueRef::Formula { source } => (
            CFValueType::Formula,
            Some(CfValue::Formula {
                source: source.clone(),
            }),
        ),
        cf::CFValueRef::Min => (CFValueType::Min, None),
        cf::CFValueRef::Max => (CFValueType::Max, None),
        cf::CFValueRef::AutoMin => {
            tracing::warn!("CFColorPoint value=AutoMin not representable in wire, treating as Min");
            (CFValueType::Min, None)
        }
        cf::CFValueRef::AutoMax => {
            tracing::warn!("CFColorPoint value=AutoMax not representable in wire, treating as Max");
            (CFValueType::Max, None)
        }
    };
    CFColorPointWire {
        value_type,
        value,
        color: resolve_color_point_color(pt, theme_palette).unwrap_or_else(|| pt.color.clone()),
    }
}

pub(super) fn convert_color_scale_to_wire(
    cs: &cf::CFColorScale,
    theme_palette: &HashMap<String, String>,
) -> CFColorScaleWire {
    CFColorScaleWire {
        min_point: convert_color_point_to_wire(&cs.min_point, theme_palette),
        mid_point: cs
            .mid_point
            .as_ref()
            .map(|point| convert_color_point_to_wire(point, theme_palette)),
        max_point: convert_color_point_to_wire(&cs.max_point, theme_palette),
    }
}
