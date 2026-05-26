//! Priority resolution and style merging for conditional formatting.
//!
//! Ported from TypeScript `mergeResults` and `mergeStyles` in
//! `spreadsheet-model/src/conditional-format/rule-evaluator.ts` (lines 705-739).
//!
//! Priority semantics:
//! - Rules are sorted by priority (lower number = higher priority = evaluated first).
//! - Higher priority results take precedence for exclusive properties (dataBar, colorScale, icon).
//! - Style properties are merged per-field: higher priority wins per-property.

use crate::types::{CFMatchResult, CfRenderStyle};

// =============================================================================
// merge_styles
// =============================================================================

/// Merge two CfRenderStyles. Properties from `higher` take precedence over `lower`.
///
/// Port of TypeScript `mergeStyles(base, override)`:
/// ```typescript
/// return { ...base, ...override };
/// ```
/// In the TS call site: `mergeStyles(override.style, base.style)` where `base` is higher priority.
/// So `override` (second param) wins. In our Rust API, `higher` wins.
///
/// Takes owned values so `Option<String>` fields are moved rather than cloned.
pub fn merge_styles(lower: CfRenderStyle, higher: CfRenderStyle) -> CfRenderStyle {
    CfRenderStyle {
        background_color: higher.background_color.or(lower.background_color),
        font_color: higher.font_color.or(lower.font_color),
        bold: higher.bold.or(lower.bold),
        italic: higher.italic.or(lower.italic),
        underline_type: higher.underline_type.or(lower.underline_type),
        strikethrough: higher.strikethrough.or(lower.strikethrough),
        border_color: higher.border_color.or(lower.border_color),
        border_style: higher.border_style.or(lower.border_style),
        border_top_color: higher.border_top_color.or(lower.border_top_color),
        border_top_style: higher.border_top_style.or(lower.border_top_style),
        border_bottom_color: higher.border_bottom_color.or(lower.border_bottom_color),
        border_bottom_style: higher.border_bottom_style.or(lower.border_bottom_style),
        border_left_color: higher.border_left_color.or(lower.border_left_color),
        border_left_style: higher.border_left_style.or(lower.border_left_style),
        border_right_color: higher.border_right_color.or(lower.border_right_color),
        border_right_style: higher.border_right_style.or(lower.border_right_style),
        number_format: higher.number_format.or(lower.number_format),
    }
}

// =============================================================================
// merge_results
// =============================================================================

/// Merge two CFMatchResults. Higher priority results take precedence.
///
/// Port of TypeScript `mergeResults(base, override)`:
/// - `base` = accumulated result (higher priority, evaluated earlier)
/// - `override` = new result (lower priority, evaluated later)
/// - Style: merge per-field (higher priority wins per-property)
/// - DataBar, ColorScale, Icon: exclusive (higher priority wins entirely)
///
/// In our Rust API:
/// - `higher` = higher priority (the accumulated/base result)
/// - `lower` = lower priority (the new/override result)
pub fn merge_results(higher: CFMatchResult, lower: CFMatchResult) -> CFMatchResult {
    let style = match (higher.style, lower.style) {
        (Some(h), Some(l)) => Some(merge_styles(l, h)),
        (h @ Some(_), None) => h,
        (None, l @ Some(_)) => l,
        (None, None) => None,
    };

    CFMatchResult {
        style,
        data_bar: higher.data_bar.or(lower.data_bar),
        color_scale: higher.color_scale.or(lower.color_scale),
        icon: higher.icon.or(lower.icon),
    }
}

#[cfg(test)]
#[path = "priority_tests.rs"]
mod tests;
