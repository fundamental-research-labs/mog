use crate::domain::comments::types::CommentShape;
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_string_attr_verbatim};

/// Parse VML shapes for comment positioning.
pub fn parse_vml_shapes(xml: &[u8]) -> Vec<CommentShape> {
    let mut shapes = Vec::new();
    let mut pos = 0;

    while let Some(shape_start) = find_tag_simd(xml, b"v:shape", pos) {
        let shape_end = find_closing_tag(xml, b"v:shape", shape_start).unwrap_or(xml.len());

        if find_tag_simd(&xml[shape_start..shape_end], b"x:ClientData", 0).is_some() {
            if let Some(shape) = parse_vml_shape(&xml[shape_start..shape_end]) {
                shapes.push(shape);
            }
        }

        pos = shape_end + 1;
    }

    shapes
}

fn parse_vml_shape(xml: &[u8]) -> Option<CommentShape> {
    let mut shape = CommentShape::default();

    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..tag_end + 1];
    shape.id = parse_string_attr_verbatim(tag, b"id=\"").unwrap_or_default();

    if let Some(style) = parse_string_attr(tag, b"style=\"") {
        shape.visible = !style.contains("visibility:hidden");
        shape.note_width = parse_pt_value(&style, "width:");
        shape.note_height = parse_pt_value(&style, "height:");
    }

    if let Some(cd_start) = find_tag_simd(xml, b"x:ClientData", 0) {
        let cd_end = find_closing_tag(xml, b"x:ClientData", cd_start).unwrap_or(xml.len());
        let cd_xml = &xml[cd_start..cd_end];

        if let Some(anchor_start) = find_tag_simd(cd_xml, b"x:Anchor", 0) {
            let content_start = find_gt_simd(cd_xml, anchor_start)
                .map(|p| p + 1)
                .unwrap_or(cd_xml.len());
            let anchor_end =
                find_closing_tag(cd_xml, b"x:Anchor", anchor_start).unwrap_or(cd_xml.len());

            if content_start < anchor_end {
                parse_anchor_values(&cd_xml[content_start..anchor_end], &mut shape);
            }
        }

        if let Some(row_start) = find_tag_simd(cd_xml, b"x:Row", 0) {
            let content_start = find_gt_simd(cd_xml, row_start)
                .map(|p| p + 1)
                .unwrap_or(cd_xml.len());
            let row_end = find_closing_tag(cd_xml, b"x:Row", row_start).unwrap_or(cd_xml.len());

            if content_start < row_end {
                if let Some(row) = parse_u32_content(&cd_xml[content_start..row_end]) {
                    if let Some(col_start) = find_tag_simd(cd_xml, b"x:Column", 0) {
                        let col_content_start = find_gt_simd(cd_xml, col_start)
                            .map(|p| p + 1)
                            .unwrap_or(cd_xml.len());
                        let col_end = find_closing_tag(cd_xml, b"x:Column", col_start)
                            .unwrap_or(cd_xml.len());

                        if col_content_start < col_end {
                            if let Some(col) =
                                parse_u32_content(&cd_xml[col_content_start..col_end])
                            {
                                shape.cell_ref = Some(column_to_ref(col, row));
                            }
                        }
                    }
                }
            }
        }
    }

    Some(shape)
}

fn parse_anchor_values(anchor: &[u8], shape: &mut CommentShape) {
    let text = std::str::from_utf8(anchor).unwrap_or("");
    let parts: Vec<&str> = text.split(',').map(|s| s.trim()).collect();

    if parts.len() >= 8 {
        shape.left_column = parts[0].parse().unwrap_or(0);
        shape.left_offset = parts[1].parse().unwrap_or(0);
        shape.top_row = parts[2].parse().unwrap_or(0);
        shape.top_offset = parts[3].parse().unwrap_or(0);
        shape.right_column = parts[4].parse().unwrap_or(0);
        shape.right_offset = parts[5].parse().unwrap_or(0);
        shape.bottom_row = parts[6].parse().unwrap_or(0);
        shape.bottom_offset = parts[7].parse().unwrap_or(0);
    }
}

fn column_to_ref(col: u32, row: u32) -> String {
    let mut col_str = String::new();
    let mut c = col;

    loop {
        col_str.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }

    format!("{}{}", col_str, row + 1)
}

#[allow(clippy::string_slice)]
fn parse_pt_value(style: &str, key: &str) -> Option<f64> {
    let start = style.find(key)?;
    let after_key = &style[start + key.len()..];
    let end = after_key.find("pt")?;
    after_key[..end].trim().parse::<f64>().ok()
}

fn parse_u32_content(xml: &[u8]) -> Option<u32> {
    let s = std::str::from_utf8(xml).ok()?.trim();
    s.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_vml_shapes_empty() {
        let xml = b"<?xml version=\"1.0\"?><xml></xml>";
        let shapes = parse_vml_shapes(xml);
        assert!(shapes.is_empty());
    }

    #[test]
    fn test_parse_vml_shape_basic() {
        let xml = br#"<?xml version="1.0"?>
<xml>
    <v:shape id="_x0000_s1025" style="position:absolute">
        <x:ClientData ObjectType="Note">
            <x:Anchor>1, 15, 0, 2, 3, 15, 5, 14</x:Anchor>
            <x:Row>0</x:Row>
            <x:Column>0</x:Column>
        </x:ClientData>
    </v:shape>
</xml>"#;

        let shapes = parse_vml_shapes(xml);
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].id, "_x0000_s1025");
        assert_eq!(shapes[0].left_column, 1);
        assert_eq!(shapes[0].left_offset, 15);
        assert_eq!(shapes[0].top_row, 0);
        assert_eq!(shapes[0].cell_ref, Some("A1".to_string()));
    }

    #[test]
    fn test_parse_vml_shape_hidden() {
        let xml = br#"<?xml version="1.0"?>
<xml>
    <v:shape id="s1" style="visibility:hidden">
        <x:ClientData ObjectType="Note">
            <x:Row>0</x:Row>
            <x:Column>0</x:Column>
        </x:ClientData>
    </v:shape>
</xml>"#;

        let shapes = parse_vml_shapes(xml);
        assert!(!shapes[0].visible);
    }

    #[test]
    fn test_column_to_ref() {
        assert_eq!(column_to_ref(0, 0), "A1");
        assert_eq!(column_to_ref(1, 0), "B1");
        assert_eq!(column_to_ref(25, 0), "Z1");
        assert_eq!(column_to_ref(26, 0), "AA1");
        assert_eq!(column_to_ref(27, 0), "AB1");
        assert_eq!(column_to_ref(0, 99), "A100");
    }

    #[test]
    fn test_parse_anchor_values() {
        let mut shape = CommentShape::default();
        parse_anchor_values(b"1, 15, 2, 10, 4, 20, 6, 30", &mut shape);

        assert_eq!(shape.left_column, 1);
        assert_eq!(shape.left_offset, 15);
        assert_eq!(shape.top_row, 2);
        assert_eq!(shape.top_offset, 10);
        assert_eq!(shape.right_column, 4);
        assert_eq!(shape.right_offset, 20);
        assert_eq!(shape.bottom_row, 6);
        assert_eq!(shape.bottom_offset, 30);
    }
}
