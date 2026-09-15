use super::super::types::ParseExtras;
use super::row_attrs::RowAttrs;
use super::row_attrs::parse_row_attrs;
use ooxml_types::worksheet::RowHeight;

pub(crate) struct AppliedRowAttrs {
    pub(crate) row_style: Option<u32>,
}

pub(crate) fn apply_fast_row_attrs(
    tag_bytes: &[u8],
    current_row: u32,
    is_self_closing: bool,
    row_heights: &mut Vec<RowHeight>,
    extras: Option<&mut ParseExtras>,
) -> AppliedRowAttrs {
    let attrs = parse_row_attrs(tag_bytes);
    push_row_height_attrs(current_row, &attrs, row_heights);
    apply_row_style(current_row, attrs.style, attrs.custom_format, row_heights);
    apply_row_extras(current_row, is_self_closing, &attrs, extras);

    AppliedRowAttrs {
        row_style: attrs.style,
    }
}

fn push_row_height_attrs(current_row: u32, attrs: &RowAttrs<'_>, row_heights: &mut Vec<RowHeight>) {
    let has_attrs = attrs.height.is_some()
        || attrs.custom_height
        || attrs.hidden.is_some()
        || attrs.collapsed.is_some()
        || attrs.thick_top
        || attrs.thick_bot
        || attrs.ph
        || attrs.outline_level.is_some();

    if has_attrs {
        let mut rh = RowHeight::new(current_row, attrs.height.unwrap_or(0.0));
        rh.height_str = attrs
            .height_str
            .and_then(|b| std::str::from_utf8(b).ok())
            .map(|s| s.to_string());
        rh.custom_height = attrs.custom_height;
        rh.hidden = attrs.hidden;
        rh.collapsed = attrs.collapsed;
        rh.thick_top = attrs.thick_top;
        rh.thick_bot = attrs.thick_bot;
        rh.ph = attrs.ph;
        rh.spans = attrs
            .spans
            .and_then(|b| std::str::from_utf8(b).ok())
            .map(|s| s.to_string());
        rh.outline_level = attrs.outline_level;
        row_heights.push(rh);
    }
}

fn apply_row_style(
    current_row: u32,
    row_style: Option<u32>,
    has_custom_format: bool,
    row_heights: &mut Vec<RowHeight>,
) {
    if row_style.is_some() || has_custom_format {
        if let Some(last_rh) = row_heights.last_mut() {
            if last_rh.row == current_row {
                if let Some(style) = row_style {
                    last_rh.style = Some(style);
                }
                last_rh.custom_format = has_custom_format;
            } else {
                push_style_row_height(current_row, row_style, has_custom_format, row_heights);
            }
        } else {
            push_style_row_height(current_row, row_style, has_custom_format, row_heights);
        }
    }
}

fn push_style_row_height(
    current_row: u32,
    row_style: Option<u32>,
    has_custom_format: bool,
    row_heights: &mut Vec<RowHeight>,
) {
    let mut rh = RowHeight::new(current_row, 0.0);
    rh.custom_format = has_custom_format;
    if let Some(style) = row_style {
        rh.style = Some(style);
    }
    row_heights.push(rh);
}

fn apply_row_extras(
    current_row: u32,
    is_self_closing: bool,
    attrs: &RowAttrs<'_>,
    extras: Option<&mut ParseExtras>,
) {
    let Some(ext) = extras else {
        return;
    };

    if let Some(descent) = attrs.dy_descent {
        ext.row_descents.push((current_row, descent));
    }

    let has_spans = if let Some(spans_bytes) = attrs.spans {
        if let Ok(sp_str) = std::str::from_utf8(spans_bytes) {
            ext.row_spans.push((current_row, sp_str.to_string()));
            true
        } else {
            false
        }
    } else {
        false
    };

    if is_self_closing
        && attrs.style.is_none()
        && !has_spans
        && attrs.dy_descent.is_none()
        && attrs.height.is_none()
        && attrs.hidden.is_none()
        && attrs.collapsed.is_none()
        && attrs.outline_level.is_none()
        && !attrs.thick_top
        && !attrs.thick_bot
        && !attrs.ph
        && !attrs.custom_format
    {
        ext.bare_empty_rows.push(current_row);
    }
}
