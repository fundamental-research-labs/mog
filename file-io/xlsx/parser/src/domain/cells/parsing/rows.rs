use super::super::adapters::{find_byte, find_sequence};
use super::super::types::ParseExtras;
use super::row_attrs::RowAttrs;
use super::row_attrs::parse_row_attrs;
use ooxml_types::worksheet::RowHeight;

pub(super) struct AppliedRowAttrs {
    pub(super) row_style: Option<u32>,
}

pub(super) fn apply_fast_row_attrs(
    tag_bytes: &[u8],
    current_row: u32,
    is_self_closing: bool,
    row_heights: &mut Vec<RowHeight>,
    extras: Option<&mut ParseExtras>,
) -> AppliedRowAttrs {
    let attrs = parse_row_attrs(tag_bytes);
    push_row_height_attrs(current_row, &attrs, row_heights, true);
    apply_row_style(current_row, attrs.style, attrs.custom_format, row_heights);
    apply_row_extras(current_row, is_self_closing, &attrs, extras);

    AppliedRowAttrs {
        row_style: attrs.style,
    }
}

pub(super) fn apply_recovery_row_attrs(
    tag_bytes: &[u8],
    current_row: u32,
    row_heights: &mut Vec<RowHeight>,
) {
    let (height, height_str) = match find_sequence(tag_bytes, b" ht=\"", 0) {
        Some(ht_pos) => {
            let vs = ht_pos + 5;
            match find_byte(tag_bytes, b'"', vs) {
                Some(qe) => {
                    let raw = std::str::from_utf8(&tag_bytes[vs..qe]).ok();
                    let val = raw.and_then(|s| s.parse::<f64>().ok());
                    (val, raw.map(|s| s.to_string()))
                }
                None => (None, None),
            }
        }
        None => (None, None),
    };
    let has_custom = find_sequence(tag_bytes, b"customHeight=\"1\"", 0).is_some();
    let hidden_val: Option<bool> = find_sequence(tag_bytes, b"hidden=\"", 0).and_then(|hp| {
        let vs = hp + 8;
        find_byte(tag_bytes, b'"', vs).and_then(|qe| match &tag_bytes[vs..qe] {
            b"1" | b"true" => Some(true),
            b"0" | b"false" => Some(false),
            _ => None,
        })
    });
    let collapsed_val: Option<bool> =
        find_sequence(tag_bytes, b" collapsed=\"", 0).and_then(|cp| {
            let vs = cp + 12;
            find_byte(tag_bytes, b'"', vs).and_then(|qe| match &tag_bytes[vs..qe] {
                b"1" | b"true" => Some(true),
                b"0" | b"false" => Some(false),
                _ => None,
            })
        });
    let has_thick_top = find_sequence(tag_bytes, b"thickTop=\"1\"", 0).is_some();
    let has_thick_bot = find_sequence(tag_bytes, b"thickBot=\"1\"", 0).is_some();
    let outline_lvl = find_sequence(tag_bytes, b"outlineLevel=\"", 0).and_then(|ol_pos| {
        let vs = ol_pos + 14;
        find_byte(tag_bytes, b'"', vs).and_then(|qe| {
            std::str::from_utf8(&tag_bytes[vs..qe])
                .ok()?
                .parse::<u8>()
                .ok()
        })
    });

    let has_attrs = height.is_some()
        || has_custom
        || hidden_val.is_some()
        || collapsed_val.is_some()
        || has_thick_top
        || has_thick_bot
        || outline_lvl.is_some();
    if has_attrs {
        let mut rh = RowHeight::new(current_row, height.unwrap_or(0.0));
        rh.height_str = height_str;
        rh.custom_height = has_custom;
        rh.hidden = hidden_val;
        rh.collapsed = collapsed_val;
        rh.thick_top = has_thick_top;
        rh.thick_bot = has_thick_bot;
        rh.outline_level = outline_lvl;
        row_heights.push(rh);
    }

    let mut row_style: Option<u32> = None;
    let has_custom_format = find_sequence(tag_bytes, b"customFormat=\"1\"", 0).is_some();
    if has_custom_format {
        if let Some(s_pos) = find_sequence(tag_bytes, b" s=\"", 0) {
            let val_start = s_pos + 4;
            if let Some(quote_end) = find_byte(tag_bytes, b'"', val_start) {
                if let Ok(s_str) = std::str::from_utf8(&tag_bytes[val_start..quote_end]) {
                    if let Ok(style) = s_str.parse::<u32>() {
                        row_style = Some(style);
                    }
                }
            }
        }
    }
    apply_row_style(current_row, row_style, has_custom_format, row_heights);
}

fn push_row_height_attrs(
    current_row: u32,
    attrs: &RowAttrs<'_>,
    row_heights: &mut Vec<RowHeight>,
    include_fast_only_fields: bool,
) {
    let has_attrs = attrs.height.is_some()
        || attrs.custom_height
        || attrs.hidden.is_some()
        || attrs.collapsed.is_some()
        || attrs.thick_top
        || attrs.thick_bot
        || (include_fast_only_fields && attrs.ph)
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
        if include_fast_only_fields {
            rh.ph = attrs.ph;
            rh.spans = attrs
                .spans
                .and_then(|b| std::str::from_utf8(b).ok())
                .map(|s| s.to_string());
        }
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
