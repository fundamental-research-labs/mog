use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};
use crate::output::results::{ColWidth, RowHeight};

use super::read_support::{attr_bool, attr_parse, attr_str, section_slice};

/// Parse column widths from the `<cols>` section of worksheet XML.
pub fn parse_col_widths(xml: &[u8]) -> Vec<ColWidth> {
    parse_cols(xml)
}

/// Parse column widths and row heights from worksheet XML.
pub fn parse_dimensions(xml: &[u8]) -> (Vec<ColWidth>, Vec<RowHeight>) {
    (parse_cols(xml), parse_rows(xml))
}

fn parse_cols(xml: &[u8]) -> Vec<ColWidth> {
    let Some(cols_section) = section_slice(xml, b"cols") else {
        return Vec::new();
    };

    let mut col_widths = Vec::new();
    let mut pos = 0;
    while let Some(col_start) = find_tag_simd(cols_section, b"col", pos) {
        let col_end = find_gt_simd(cols_section, col_start)
            .map(|p| p + 1)
            .unwrap_or(cols_section.len());
        col_widths.push(parse_col_element(&cols_section[col_start..col_end]));
        pos = col_end;
    }
    col_widths
}

fn parse_col_element(col_elem: &[u8]) -> ColWidth {
    let min = attr_parse::<u32>(col_elem, b"min=\"").unwrap_or(1);
    let max = attr_parse::<u32>(col_elem, b"max=\"").unwrap_or(min);
    let width = attr_parse::<f64>(col_elem, b"width=\"").unwrap_or(8.43);
    let style = attr_parse::<u32>(col_elem, b"style=\"");
    let hidden = attr_bool(col_elem, b"hidden=\"").unwrap_or(false);
    let custom_width = attr_bool(col_elem, b"customWidth=\"").unwrap_or(false);
    let best_fit = attr_bool(col_elem, b"bestFit=\"").unwrap_or(false);
    let outline_level = attr_parse::<u8>(col_elem, b"outlineLevel=\"");
    let collapsed = attr_bool(col_elem, b"collapsed=\"").unwrap_or(false);

    let mut cw = ColWidth::range(min, max, width);
    if let Some(s) = style {
        cw = cw.with_style(s);
    }
    if hidden {
        cw = cw.with_hidden(true);
    }
    if custom_width {
        cw.custom_width = true;
    }
    if best_fit {
        cw.best_fit = true;
    }
    cw.outline_level = outline_level;
    cw.collapsed = collapsed;
    cw
}

fn parse_rows(xml: &[u8]) -> Vec<RowHeight> {
    let mut row_heights = Vec::new();
    let mut pos = 0;
    while let Some(row_start) = find_tag_simd(xml, b"row", pos) {
        let row_end = find_gt_simd(xml, row_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        if let Some(row_height) = parse_row_element(&xml[row_start..row_end]) {
            row_heights.push(row_height);
        }
        pos = row_end;
    }
    row_heights
}

fn parse_row_element(row_elem: &[u8]) -> Option<RowHeight> {
    let row_num = attr_parse::<u32>(row_elem, b"r=\"")?;
    let (height, height_str) = parse_height(row_elem);
    let has_custom_height = find_attr_simd(row_elem, b"customHeight=\"1\"", 0).is_some();
    let hidden_val = attr_bool(row_elem, b"hidden=\"");
    let has_thick_top = find_attr_simd(row_elem, b"thickTop=\"1\"", 0).is_some();
    let has_thick_bot = find_attr_simd(row_elem, b"thickBot=\"1\"", 0).is_some();
    let has_ph = find_attr_simd(row_elem, b"ph=\"1\"", 0).is_some();
    let collapsed_val = attr_bool(row_elem, b"collapsed=\"");
    let outline_level = attr_parse::<u8>(row_elem, b"outlineLevel=\"");
    let has_custom_format = find_attr_simd(row_elem, b"customFormat=\"1\"", 0).is_some();
    let spans = attr_str(row_elem, b"spans=\"");
    let style = if has_custom_format {
        attr_parse::<u32>(row_elem, b"s=\"")
    } else {
        None
    };

    let has_attrs = height.is_some()
        || has_custom_height
        || hidden_val.is_some()
        || collapsed_val.is_some()
        || has_thick_top
        || has_thick_bot
        || has_ph
        || outline_level.is_some()
        || spans.is_some()
        || style.is_some()
        || has_custom_format;

    if !has_attrs {
        return None;
    }

    let mut rh = RowHeight::new(row_num - 1, height.unwrap_or(0.0));
    rh.height_str = height_str;
    rh.custom_height = has_custom_height;
    rh.hidden = hidden_val;
    rh.thick_top = has_thick_top;
    rh.thick_bot = has_thick_bot;
    rh.ph = has_ph;
    rh.collapsed = collapsed_val;
    rh.outline_level = outline_level;
    rh.spans = spans;
    rh.custom_format = has_custom_format;
    rh.style = style;
    Some(rh)
}

fn parse_height(row_elem: &[u8]) -> (Option<f64>, Option<String>) {
    let Some(p) = find_attr_simd(row_elem, b"ht=\"", 0) else {
        return (None, None);
    };
    let Some((s, e)) = extract_quoted_value(row_elem, p + b"ht=\"".len()) else {
        return (None, None);
    };
    let raw = std::str::from_utf8(&row_elem[s..e]).ok();
    (
        raw.and_then(|r| r.parse::<f64>().ok()),
        raw.map(|r| r.to_string()),
    )
}
