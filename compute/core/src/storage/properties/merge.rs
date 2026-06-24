use domain_types::{CellBorderSide, CellBorders, CellFormat};
use ooxml_types::styles::PatternType;

/// Merge two `CellFormat` objects with property-level precedence.
/// For each field: if `higher` has `Some`, use it; otherwise keep `lower`.
pub(crate) fn merge_formats(lower: &CellFormat, higher: &CellFormat) -> CellFormat {
    let higher = normalize_format_patch(higher);
    let mut merged = CellFormat {
        font_family: higher.font_family.clone().or(lower.font_family.clone()),
        font_size: higher.font_size.or(lower.font_size),
        font_color: higher.font_color.clone().or(lower.font_color.clone()),
        font_color_tint: higher.font_color_tint.or(lower.font_color_tint),
        bold: higher.bold.or(lower.bold),
        italic: higher.italic.or(lower.italic),
        underline_type: higher.underline_type.or(lower.underline_type),
        strikethrough: higher.strikethrough.or(lower.strikethrough),
        superscript: higher.superscript.or(lower.superscript),
        subscript: higher.subscript.or(lower.subscript),
        font_outline: higher.font_outline.or(lower.font_outline),
        font_shadow: higher.font_shadow.or(lower.font_shadow),
        font_theme: higher.font_theme.clone().or(lower.font_theme.clone()),
        font_charset: higher.font_charset.or(lower.font_charset),
        font_family_type: higher.font_family_type.or(lower.font_family_type),
        horizontal_align: higher.horizontal_align.or(lower.horizontal_align),
        vertical_align: higher.vertical_align.or(lower.vertical_align),
        wrap_text: higher.wrap_text.or(lower.wrap_text),
        indent: higher.indent.or(lower.indent),
        text_rotation: higher.text_rotation.or(lower.text_rotation),
        shrink_to_fit: higher.shrink_to_fit.or(lower.shrink_to_fit),
        reading_order: higher.reading_order.clone().or(lower.reading_order.clone()),
        auto_indent: higher.auto_indent.or(lower.auto_indent),
        number_format: higher.number_format.clone().or(lower.number_format.clone()),
        background_color: higher
            .background_color
            .clone()
            .or(lower.background_color.clone()),
        background_color_tint: higher.background_color_tint.or(lower.background_color_tint),
        pattern_type: higher.pattern_type.or(lower.pattern_type),
        pattern_foreground_color: higher
            .pattern_foreground_color
            .clone()
            .or(lower.pattern_foreground_color.clone()),
        pattern_foreground_color_tint: higher
            .pattern_foreground_color_tint
            .or(lower.pattern_foreground_color_tint),
        gradient_fill: higher.gradient_fill.clone().or(lower.gradient_fill.clone()),
        borders: merge_borders(lower.borders.as_ref(), higher.borders.as_ref()),
        locked: higher.locked.or(lower.locked),
        hidden: higher.hidden.or(lower.hidden),
        quote_prefix: higher.quote_prefix.or(lower.quote_prefix),
        pivot_button: higher.pivot_button.or(lower.pivot_button),
    };

    // Clean up any invalid legacy lower layer that already carries both flags.
    enforce_wrap_shrink_exclusive(&mut merged);
    clear_fill_fields_for_no_fill(&mut merged);
    merged
}

fn merge_borders(lower: Option<&CellBorders>, higher: Option<&CellBorders>) -> Option<CellBorders> {
    let Some(higher) = higher else {
        return lower.cloned();
    };

    if is_empty_borders(higher) {
        return Some(CellBorders::default());
    }

    let lower = lower.cloned().unwrap_or_default();
    Some(CellBorders {
        top: merge_border_side(lower.top.as_ref(), higher.top.as_ref()),
        right: merge_border_side(lower.right.as_ref(), higher.right.as_ref()),
        bottom: merge_border_side(lower.bottom.as_ref(), higher.bottom.as_ref()),
        left: merge_border_side(lower.left.as_ref(), higher.left.as_ref()),
        diagonal: merge_border_side(lower.diagonal.as_ref(), higher.diagonal.as_ref()),
        diagonal_up: higher.diagonal_up.or(lower.diagonal_up),
        diagonal_down: higher.diagonal_down.or(lower.diagonal_down),
        vertical: merge_border_side(lower.vertical.as_ref(), higher.vertical.as_ref()),
        horizontal: merge_border_side(lower.horizontal.as_ref(), higher.horizontal.as_ref()),
        outline: higher.outline.or(lower.outline),
    })
}

fn merge_border_side(
    lower: Option<&CellBorderSide>,
    higher: Option<&CellBorderSide>,
) -> Option<CellBorderSide> {
    let Some(higher) = higher else {
        return lower.cloned();
    };

    if is_empty_border_side(higher) {
        return Some(CellBorderSide::default());
    }

    let lower = lower.cloned().unwrap_or_default();
    Some(CellBorderSide {
        style: higher.style.or(lower.style),
        color: higher.color.clone().or(lower.color),
        color_tint: higher.color_tint.or(lower.color_tint),
    })
}

fn is_empty_borders(borders: &CellBorders) -> bool {
    borders.top.is_none()
        && borders.right.is_none()
        && borders.bottom.is_none()
        && borders.left.is_none()
        && borders.diagonal.is_none()
        && borders.diagonal_up.is_none()
        && borders.diagonal_down.is_none()
        && borders.vertical.is_none()
        && borders.horizontal.is_none()
        && borders.outline.is_none()
}

fn is_empty_border_side(side: &CellBorderSide) -> bool {
    side.style.is_none() && side.color.is_none() && side.color_tint.is_none()
}

pub(crate) fn normalize_format_patch(format: &CellFormat) -> CellFormat {
    let mut normalized = format.clone();
    match (normalized.wrap_text, normalized.shrink_to_fit) {
        // Same-patch conflicts are unordered in the struct representation.
        // Canonicalize to wrapText, matching the default dialog precedence.
        (Some(true), Some(true)) => normalized.shrink_to_fit = Some(false),
        (Some(true), _) => normalized.shrink_to_fit = Some(false),
        (_, Some(true)) => normalized.wrap_text = Some(false),
        _ => {}
    }
    clear_fill_fields_for_no_fill(&mut normalized);
    normalized
}

fn enforce_wrap_shrink_exclusive(format: &mut CellFormat) {
    if format.wrap_text == Some(true) && format.shrink_to_fit == Some(true) {
        format.shrink_to_fit = Some(false);
    }
}

fn clear_fill_fields_for_no_fill(format: &mut CellFormat) {
    if format.pattern_type == Some(PatternType::None) {
        format.background_color = None;
        format.background_color_tint = None;
        format.pattern_foreground_color = None;
        format.pattern_foreground_color_tint = None;
        format.gradient_fill = None;
    }
}
